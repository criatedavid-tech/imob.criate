# ImobiFlow — Continuação de projeto (handoff)

Você é um agente de engenharia trabalhando no projeto **ImobiFlow**. Antes de agir, leia:
- `C:\Users\Criate\imob.criate\server.ts` (backend principal)
- A memória do projeto (já carregada): `project_imobiflow_notes.md`, `project_imobiflow.md`, `project_imobiflow_pending.md`
- `.env` (na pasta do projeto) para variáveis; segredos como ZPRO_JWT_SECRET estão no `.env` da Fly e nas notas de memória.

## 1. O que é o ImobiFlow
SaaS para corretores de imóveis. Esteira automática: pagamento no **Asaas** → provisiona automaticamente um atendimento WhatsApp isolado no **Z-PRO** (fork whaticket, backend em `https://appback.criate.online`, painel em `https://app.criate.online`) usando a **UAZAPI** (`https://criate.uazapi.com`) como provedor de WhatsApp.

## 2. Stack / Infra
- Backend: Node + Express + TypeScript, rodado com `tsx server.ts` (porta 3000). Em prod serve `dist/`.
- Frontend: Vite/React (build `npm run build`).
- Banco/Auth: **Supabase** (project_id `umvbrahsqvqeondwtikm`), tabela `brokers`.
- Deploy: **Fly.io**, app `imobiflow` (`imobiflow.fly.dev`). Deploy: `fly deploy` (PowerShell, a partir de `C:\Users\Criate\imob.criate`).
- Pagamentos: Asaas (assinatura recorrente via `POST /subscriptions`).
- IMPORTANTE rodar local: `tsx server.ts` precisa `--max-old-space-size=1024` (OOM com base64). O `.env` LOCAL **não tem** ZPRO_JWT_SECRET — para scripts de diagnóstico, setar inline (valor nas notas de memória).

## 3. Esteira de provisionamento (8 passos, em server.ts)
1. `POST /tenants` (super admin) → cria tenant isolado.
2. `POST /userTenants` (super admin) → cria user (`status:'active'`, `restrictedUser:false`).
3. `POST /auth/login` → token de tenant (userId real). Fallback: `forgeTenantJwt(tenant, userIdReal, email)`.
4. `POST /whatsappTenants` (super admin) → cria canal uazapi (status DISCONNECTED, `isActive:true`, `uazapiHost`+`uazapiToken`).
4b. **UAZAPI**: `POST /instance/create` (header `admintoken`, body `{name}`) → `{token, instance:{id,token}}`.
   - `PUT /whatsapp/:id {tokenAPI: instanceToken}` → grava "API Token" (retorna 500 mas persiste).
   - `PUT /whatsapp/:id {wabaId: instanceId}` → grava **"Number ID (Instance ID)"** (ver §4).
   - `POST /webhook` (header `token`=instanceToken) → registra webhook (ver §4).
   - **NÃO** chamar `POST /whatsappSession/:id` no provisionamento (causa auto-connect indesejado).
5. `POST /api-config` (tenant) → cria API externa; guarda uuid+plainToken.
6. `PUT /settings/n8n` e `/settings/n8nAllTickets` (tenant, com tenantId no body) → ativa Bots IA.
7. `PUT /whatsapp/:id` (body mínimo, tenant token) → seta n8nUrl + habilita IA no canal.
8. Webhook de provisionamento entrega credenciais ao corretor.

## 4. DESCOBERTAS CRÍTICAS Z-PRO/UAZAPI (custaram muitas tentativas — NÃO reaprender)
- **Mapeamento de campos do painel "UaZapi"**:
  - "API Token" = coluna `tokenAPI` = `instance.token` da UAZAPI.
  - **"Number ID (Instance ID)" = coluna `wabaId`** = `instance.id` da UAZAPI. (NÃO é `wppUser` — esse foi o bug que demorou pra achar; confirmado via diff do PUT real do painel.)
- **Ativação ("Não ativado")**: o flag é `plugged` (não settável via PUT — gerenciado pelo Z-PRO). O Z-PRO só seta `plugged`/CONNECTED quando **recebe o evento de conexão da UAZAPI pelo webhook**, e **casa o evento ao canal pela coluna `wabaId`**. Comprovado: com `wabaId` nulo o Z-PRO ignora os eventos; com `wabaId` correto ele reage na hora.
- **Webhook UAZAPI→Z-PRO**: `POST {UAZAPI_HOST}/webhook` (header `token`=instanceToken) com `{url, enabled:true, events:[...], excludeMessages:[], addUrlEvents:false, addUrlTypesMessages:false}`. URL = `${ZPRO_ADMIN_URL}/uazapi-webhook/${instanceId}`. O webhook PRECISA existir ANTES do WhatsApp conectar (senão o evento se perde e o canal nunca ativa). `events`: `["messages","connection","wasSentByApi","messages_update","call","contacts","groups","history"]`.
- `PUT /whatsapp/:id` retorna 500 mas PERSISTE; sempre verificar via GET. Enviar campos em PUTs SEPARADOS (combinado é não-confiável).
- `GET /whatsapp/:id` com super admin → 500 p/ canal de outro tenant; com `forgeTenantJwt(t,0,email)` → 403 ERR_AUTH_USER_NOT_FOUND. SÓ funciona com token de **login** real do tenant (email+senha do broker no Supabase).
- Forja JWT: `forgeSuperAdminJwt()` (typo "usarname", tenantId:1) e `forgeTenantJwt(tenantId, userId, email)`. Secret nas notas/.env.

## 5. O que foi feito nesta sessão
- Identifiquei e corrigi a causa raiz do "Number ID vazio" + "Não ativado":
  - `createUazapiInstanceForChannel` agora grava **`wabaId`** (não só `wppUser`) com o `instance.id`, com verificação e fallback super admin.
  - Adicionado `setUazapiWebhook()` chamado no provisionamento (e no relink), antes de conectar.
  - Endpoint `POST /api/admin/brokers/:id/relink-uazapi` reescrito: faz login do tenant, garante `wabaId` + webhook em canais já provisionados.
- Tudo deployado na Fly (`fly deploy`).
- Notas de memória atualizadas com tudo acima.

## 6. Estado atual / pendência de validação
- Canal de teste do corretor **Hunter** (Supabase broker id `dfb28d7b-e7ca-4116-9e95-3172357a558b`, tenant 207, canal **#398**, email `criate.david@outlook.com`): `wabaId` setado, webhook ativo. Foi **desconectado** num teste — precisa **reconectar lendo o QR no painel** para validar a ativação.
- VALIDAÇÃO PENDENTE (exige celular, não dá só via API): no painel Z-PRO, canal Hunter → Conectar → ler QR → confirmar que "Não ativado" some e que mensagem enviada ao número 556294381279 chega como ticket.

## 7. Próximos passos
1. Validar Hunter: reconectar (QR) e confirmar ativação + recebimento de mensagem.
2. Se ativar: validar a esteira COMPLETA com um corretor novo (provisiona → corretor lê QR → ativa automático).
3. Se NÃO ativar mesmo com `wabaId`+webhook: investigar endpoint de sessão/ativação usando a coleção Postman da API do Z-PRO (o usuário tem; pastas como "Tenant API", "Listagens"). Verificar se falta algum `POST /whatsappSession` disparado pelo próprio painel.
4. Roteiro de produção pendente (ver `project_imobiflow_pending.md`): segurança, commit, deploy final, configs.

## Como me ajudar a continuar
Comece confirmando o estado do canal #398 via diagnóstico (login do tenant + GET /whatsapp/398, checar `wabaId`, `plugged`, `status`, e o webhook na UAZAPI). Depois conduza a validação com o usuário.
