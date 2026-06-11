# ImobiFlow — Documentação do Projeto

> Documento de referência técnica e operacional. Cobre arquitetura, fluxo
> ponta a ponta, modelo de dados, endpoints, integrações e pontos pendentes.
> **Não contém valores de segredos** — apenas os nomes das variáveis (os
> valores ficam no `.env` local, nos *secrets* da Fly e nas notas de memória).

Última atualização: 2026-06-11.

---

## 1. Visão geral

ImobiFlow é um **SaaS multitenant** para corretores de imóveis. A esteira é
automática: o corretor paga no **Asaas** → o sistema provisiona automaticamente
um atendimento WhatsApp isolado no **Z-PRO** (fork do Whaticket) usando a
**UAZAPI** como provedor de WhatsApp → um agente de IA (no **N8N**) responde os
clientes finais consultando os imóveis cadastrados.

Divisão de responsabilidades dos painéis:
- **ImobiFlow** (este projeto): cadastro/landing de **imóveis**, leads, agenda,
  configuração do agente de IA, pagamento e o motor de provisionamento.
- **Z-PRO** (`app.criate.online`): o corretor **lê o QR Code** e opera o
  atendimento WhatsApp (inbox, tickets).

---

## 2. Stack e infraestrutura

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node + Express + TypeScript, rodado com `tsx server.ts` (porta 3000) |
| Frontend | Vite + React 19 + React Router 7 + Tailwind 4 (`motion`, `recharts`, `lucide-react`) |
| Banco / Auth | **Supabase** (project_id `umvbrahsqvqeondwtikm`) |
| Deploy | **Fly.io** — app `imobiflow` (`imobiflow.fly.dev`) |
| Pagamentos | **Asaas** (assinatura recorrente mensal via cartão) |
| WhatsApp | **Z-PRO** (`appback.criate.online` = API, `app.criate.online` = painel) sobre **UAZAPI** (`criate.uazapi.com`) |
| Automação IA | **N8N** (`212hook.criate.online`) |
| LLM | **OpenRouter** (chave por corretor, com fallback da empresa) |
| Texto auxiliar | **Google Gemini** (melhorar descrições de imóveis) |

### Como rodar / deployar
```bash
# Local (a partir de C:\Users\Criate\imob.criate)
npm run dev        # tsx --max-old-space-size=1024 server.ts  (porta 3000)
npm run build      # vite build → dist/
npm run lint       # tsc --noEmit (typecheck)

# Produção
fly deploy         # PowerShell, a partir da pasta do projeto
```
> Em prod o Express serve `dist/`. O flag `--max-old-space-size=1024` evita OOM
> (uploads em base64). O `.env` **local não tem** `ZPRO_JWT_SECRET` (só Fly).

---

## 3. Estrutura de arquivos

```
imob.criate/
├── server.ts                 # TODO o backend (Express): ~2790 linhas, 1 arquivo
├── index.html                # entrypoint Vite
├── vite.config.ts
├── Dockerfile / fly.toml      # build e deploy Fly
├── .env / .env.example        # variáveis de ambiente
├── HANDOFF.md                 # histórico de handoff entre sessões
├── README.md                  # leia-me geral
├── DOCUMENTACAO.md            # este arquivo
└── src/
    ├── App.tsx                # rotas (React Router)
    ├── main.tsx / index.css
    ├── lib/        supabase.ts, utils.ts
    ├── services/   auth.ts (token/headers), gemini.ts
    ├── components/ PropertyForm, AISettings, CorretoraSettings, MagicWandTextarea
    └── pages/      Dashboard, PropertyLanding, Login, Signup,
                    PaymentPending, PaymentSuccess, ForgotPassword,
                    ResetPassword, Termos, Privacidade, Admin
```

---

## 4. Modelo de dados (Supabase)

Tabelas usadas hoje pelo ImobiFlow estão abaixo. O projeto Supabase é
compartilhado com outros sistemas — tabelas `autoescola*`, `cfc*`, de clínicas
etc. **não** fazem parte deste projeto. Já a camada `ia_*` (`ia_tenants`,
`ia_clients`, `ia_chat_histories`, `ia_tenant_handoff_routes` etc.) **pertence
ao ImobiFlow e está em desenvolvimento** (features novas — ver §11).

### `brokers` — corretor / tenant (núcleo)
Identidade: `id` (uuid), `user_id` (Supabase Auth), `name`, `email`, `phone`, `is_admin`, `corretora_id`.
Plano/assinatura: `status` (`pendente`/`ativo`/`inativo`/`bloqueado`), `plan`, `valid_until`, `grace_until`, `asaas_customer_id`, `asaas_subscription_id`.
Provisionamento Z-PRO: `provisioning_status` (`pending`→`tenant_created`→`session_created`→`api_created`→`completed`, ou `processing`/`failed`/`disabled`), `provisioning_error`, `provisioning_completed_at`.
Credenciais Z-PRO: `zpro_tenant_id`, `zpro_channel_id`, `zpro_channel_name`, `zpro_user_email`, `zpro_username`, `zpro_password`, `zpro_qr_code`.
**API externa Z-PRO (convenção — ver §6):** `zpro_api_key` = **UUID** da api-config · `zpro_api_token` = **plainToken** (Bearer) · `zpro_api_url` = URL completa `…/v2/api/external/{UUID}`.
IA / config: `ai_name`, `broker_address`, `openrouter_api_key_enc` (chave OpenRouter criptografada AES-256).
Recuperação de senha: `reset_token`, `reset_token_expires_at`.

### `properties` — imóveis
`id`, `title`, `price`, `location`, `description`, `image_url` (JSON de URLs), `slug`, `link` (landing `/p/:slug`), `status`, `broker_id`, `created_at`, `updated_at`.

### `leads`
`id`, `property_id`, `name`, `phone`, `email`, `status`, `notes`, `broker_id`, `created_at`.

### `agenda` — visitas
`id`, `broker_id`, `lead_id`, `property_id`, `title`, `scheduled_at`, `status`, dados do cliente.

### `subscriptions` — histórico de pagamento
`id`, `broker_id`, `asaas_payment_id`, `asaas_customer_id`, `plan`, `amount` (centavos), `currency`, `status`, `paid_at`, `valid_until`.

### `corretoras` — imobiliária (nível acima do corretor)
`id`, `razao_social`, `cnpj`, `creci`, `owner_broker_id`. Vincula-se a `brokers.corretora_id`.

### `webhook_logs` — auditoria
`id`, `source` (`asaas`/`zpro`/`provisioning_webhook`), `event_type`, `payload` (jsonb), `status`, `broker_id`, `created_at`.

### `followup_config` — config do Follow-Up IA (1 por corretor)
`id`, `broker_id` (único), `enabled` (toggle), `delay_minutes_1` (default 1440 = 24h), `delay_minutes_2` (default 4320 = 3 dias), `delay_minutes_3` (default 10080 = 7 dias), `message_1/2/3`, timestamps.
Cada timer é independente: F1 conta a partir de `last_customer_message_at`; F2/F3 contam a partir de `follow_sent_at` do follow anterior.

### `followup_conversations` — estado do follow por conversa (corretor × cliente)
`id`, `broker_id`, `customer_phone`, `last_customer_message_at`, `follow_sent`, `follow_sent_at`, `follow_message_index` (0..3), `ai_active` (`false` = handover humano), `human_takeover_at`, **único(broker_id, customer_phone)**.
Função SQL `claim_due_followups()`: claim atômico (multi-máquina safe) — seleciona + marca + avança o índice numa única instrução.

---

## 5. Fluxo operacional completo

### 5.1 PROVISIONAMENTO (onboarding do corretor)
1. **Cadastro** — `Signup.tsx` → `POST /api/auth/signup`: cria user no Supabase Auth (já confirmado) + linha em `brokers` (`status: pendente`).
2. **Pagamento** — `PaymentPending.tsx` → `POST /api/checkout`: cria *customer* + **subscription mensal recorrente** (cartão) no Asaas; valida a 1ª cobrança (`CONFIRMED`/`RECEIVED`).
3. **Confirmação** — dois caminhos: (a) síncrono no próprio checkout; (b) assíncrono via `POST /api/webhooks/asaas` (`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`). Ambos chamam `handleAsaasPaymentReceived`.
4. **Trava + disparo** — `handleAsaasPaymentReceived` ativa o corretor (`status: ativo`, `valid_until` +1 mês), registra `subscriptions`, e aplica **trava atômica** (`provisioning_status = processing`, condicional) para evitar provisionamento duplicado em webhooks repetidos → chama `createZproTenantAndChannel`.
5. **Esteira Z-PRO/UAZAPI** (`createZproTenantAndChannel`), 8 passos:
   1. `POST /tenants` (super admin) → tenant isolado (já com `uazapiHost`+`uazapiToken`).
   2. `POST /userTenants` → usuário admin do tenant (`status: active`, `restrictedUser: false`).
   3. `POST /auth/login` → token do tenant (fallback: `forgeTenantJwt`).
   4. `POST /whatsappTenants` → canal WhatsApp (`type: uazapi`, `DISCONNECTED`).
   5. **UAZAPI** `createUazapiInstanceForChannel`: `POST /instance/create` → grava `tokenAPI` e **`wabaId`** (= "Number ID / Instance ID") no canal, e configura o webhook UAZAPI→Z-PRO.
   6. `POST /api-config` → cria API externa; salva `zpro_api_key`(UUID), `zpro_api_token`(plainToken), `zpro_api_url`.
   7. Ativa Bots IA (`PUT /settings/n8n` + `/settings/n8nAllTickets`) e seta `n8nUrl` no canal (`PUT /whatsapp/:id`).
   8. `provisioning_status = completed` + `fireProvisioningWebhook`.
6. **Entrega de credenciais** — `fireProvisioningWebhook` → **PROVISIONING_WEBHOOK_URL** (N8N) com login/senha/URL/token → N8N entrega ao corretor.

### 5.2 ATIVAÇÃO (conectar o WhatsApp) — **no painel Z-PRO**
7. Corretor loga no **Z-PRO** (`app.criate.online`) com as credenciais recebidas.
8. Lê o **QR Code** no Z-PRO e escaneia no celular.
9. UAZAPI emite evento `connection` → webhook `…/uazapi-webhook/{instanceId}` → **Z-PRO casa o evento pelo `wabaId`** → canal vira `CONNECTED`/`plugged`.
   > **Descoberta crítica:** sem `wabaId` correto no canal, o Z-PRO ignora os eventos da UAZAPI e o canal nunca ativa ("Não ativado"). O webhook precisa existir **antes** de conectar.

### 5.3 OPERAÇÃO (atendimento automático)
10. Cliente final manda mensagem → UAZAPI → webhook → Z-PRO cria ticket → chama **N8N_WEBHOOK_URL** (`n8nUrl` do canal).
11. N8N: **Normalizar Dados** → **Buscar Corretor** (`brokers` por telefone, limpando o sufixo `:xxxx` da UAZAPI) → **Buscar Imóveis** (`properties` por `broker_id`).
12. Agente IA chama o **LLM Proxy** `POST /api/proxy/llm/:brokerPhone/*` → encaminha para OpenRouter usando a chave do corretor (ou fallback da empresa).
13. **Enviar Resposta** → `POST {zpro_api_url}` (URL **base**, sem sufixo) com header `Authorization: Token {zpro_api_token}` e body `{ body, number, externalKey, isClosed:false }`. Multitenant: cada corretor traz a própria URL/token via "Buscar Corretor". *(Formato confirmado no fluxo N8N real — não é `Bearer`/`/messages/send-text`.)*

### 5.4 CONTEÚDO (corretor cadastra imóveis) — **no painel ImobiFlow**
- `Dashboard.tsx` → `PropertyForm.tsx` → `POST /api/properties`: gera `slug` + **landing page** `/p/:slug`, salva imagens, vincula `broker_id`.
- Landing pública `PropertyLanding.tsx` (`/p/:slug`) → visitante preenche → `POST /api/leads` (opcional dispara `CHATBOT_WEBHOOK_URL`).
- Apoio: `POST /api/properties/upload-image`, `POST /api/brokers/upload-photo`, `POST /api/ai/enhance-text` (Gemini — "varinha mágica").

### 5.5 CICLO DE VIDA da assinatura (`POST /api/webhooks/asaas`)
- `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` → renova `valid_until` (cobrança mensal recorrente).
- `PAYMENT_OVERDUE` → concede **grace de 3 dias** (`grace_until`); suspensão é *lazy* em `GET /api/subscription`.
- `PAYMENT_DELETED` → `status: inativo`.
- `SUBSCRIPTION_DELETED`/`INACTIVATED`/`CANCELED` → `status: inativo` + `provisioning_status: disabled`.

### 5.6 FOLLOW-UP IA (reativação de lead + handover humano) — VALIDADO EM PRODUÇÃO
Camada **isolada** (não altera o fluxo acima). Config por corretor na aba **Configurações** (`FollowUpSettings.tsx`).

**Regras:**
- Máximo 3 follows por ticket. `follow_message_index` vai de 0→1→2→3 e para.
- Index **nunca reseta** quando cliente responde — só reseta em `isNewTicket` (ticket_id diferente).
- **Timers independentes por follow:**
  - F1: conta a partir de `last_customer_message_at + delay_minutes_1` (padrão 1440 min = 24h)
  - F2: conta a partir de `follow_sent_at + delay_minutes_2` (padrão 4320 min = 3 dias)
  - F3: conta a partir de `follow_sent_at + delay_minutes_3` (padrão 10080 min = 7 dias)
- Auto-progressão: após F1 enviado, `follow_sent=false` é resetado; F2 dispara automaticamente no próximo tick após `follow_sent_at + delay_minutes_2`; idem F3.
- Mensagens vazias são puladas (sem loop infinito).
- **Handover humano:** corretor responde manualmente → `human_takeover_at` setado → `ai_active=false` → agente N8N interrompido e follow-ups pausados naquela conversa.

**Peças:**
1. **N8N → ImobiFlow:** o fluxo do agente chama `POST /api/followup/inbound` (registra a msg do cliente + retorna `respond`; se `false`, o agente para). Corretor manual → `POST /api/followup/broker-reply`.
2. **Marcador ZWSP (`​`):** agente e follow-up incluem um *zero-width space* (invisível) nas mensagens do **sistema**. O nó de handover só dispara quando a msg `fromMe` **não** tem o marcador (= corretor digitou manual) — resolve "agente vs corretor" sem depender de `wasSentByApi`.
3. **Motor (cron 60s):** `claim_due_followups()` faz claim atômico (multi-máquina safe na Fly) e envia via API externa Z-PRO (mesmo formato do agente — ver §6). Falha de envio → reverte o claim p/ retry no próximo tick.

---

## 6. Convenção dos campos da API externa Z-PRO (importante)

Cada corretor tem **uma** "api-config" no Z-PRO, vinculada ao canal, que expõe a
API externa em `…/v2/api/external/{UUID}`. **Envio de mensagem** usa header `Authorization: Token {plainToken}` (formato do agente N8N — confirmado em produção); endpoints de leitura (ex.: `showChannelById`) também aceitam `Bearer`.

| Campo Supabase | Conteúdo | Usado em |
|----------------|----------|----------|
| `zpro_api_key` | **UUID** da api-config | montar a URL externa |
| `zpro_api_token` | **plainToken** | header `Token {plainToken}` no envio (agente N8N + cron follow-up) |
| `zpro_api_url` | URL completa `…/external/{UUID}` | base das chamadas |

> O `plainToken` só é exibido **uma vez** na criação. Para reparar um corretor,
> recria-se a api-config logando como o tenant (não via super admin, senão cria
> uma config solta sem vínculo ao canal).

---

## 7. Integrações externas

| Integração | Uso | Auth |
|-----------|-----|------|
| **Asaas** | customer + subscription mensal; webhooks de pagamento | `ASAAS_API_KEY` |
| **Z-PRO** (admin) | criar tenant/user/canal/api-config; PUT canal | `ZPRO_ADMIN_TOKEN` (super admin) ou token de login do tenant; fallback `forgeTenantJwt` com `ZPRO_JWT_SECRET` |
| **Z-PRO** (externa) | enviar mensagem do corretor / follow-up | `zpro_api_token` (header `Token`) |
| **UAZAPI** | criar instância, configurar webhook | header `admintoken`/`token` = `UAZAPI_TOKEN` |
| **N8N** | provisioning webhook + processamento de mensagem + LLM proxy | `INTERNAL_PROXY_TOKEN` (N8N→servidor) |
| **OpenRouter** | LLM do agente | chave do corretor (`openrouter_api_key_enc`) ou `OPENROUTER_API_KEY` |
| **Gemini** | melhorar texto de imóveis | `GEMINI_API_KEY` |

### Os 3 webhooks (não confundir)
1. **PROVISIONING_WEBHOOK_URL** — entrega credenciais ao corretor (pós-provisionamento).
2. **N8N_WEBHOOK_URL** — recebe mensagens dos clientes finais (setado como `n8nUrl` no canal).
3. **CHATBOT_WEBHOOK_URL** *(opcional)* — dispara lead capturado na landing page.

Há ainda o webhook **UAZAPI→Z-PRO** (`…/uazapi-webhook/{instanceId}`), interno à camada WhatsApp.

---

## 8. Referência de endpoints (backend — `server.ts`)

**Auth** *(rate-limited: 10 req/15min por IP)*: `POST /api/auth/signup` · `/login` · `/forgot-password` · `/reset-password`
**Corretor:** `GET /api/brokers/me` · `POST /api/brokers/settings` · `POST|DELETE /api/brokers/openrouter-key` · `POST /api/brokers/upload-photo`
**Corretora:** `GET|POST /api/corretora` · `GET /api/corretora/brokers`
**Imóveis:** `GET|POST /api/properties` · `GET /api/properties/health` · `GET /api/properties/:slug` · `DELETE /api/properties/:id` · `PATCH /api/properties/:id/status` · `POST /api/properties/upload-image`
**Leads:** `POST|GET /api/leads` · `GET /api/leads/recent` · `PATCH /api/leads/:id/status`
**Agenda:** `GET /api/agenda` · `GET /api/agenda/visits`
**Dashboard:** `GET /api/dashboard/metrics` · `GET /api/dashboard/charts`
**IA:** `POST /api/ai/enhance-text` (Gemini)
**Pagamento** *(`/api/checkout` rate-limited: 5 req/1h; `/api/webhooks/asaas` rate-limited: 120 req/1min)*: `GET /api/config/plan` · `POST /api/checkout` · `GET /api/subscription` · `POST /api/webhooks/asaas` · `POST /api/webhooks/asaas/test` *(bloqueado em produção)*
**WhatsApp:** `POST /api/whatsapp/send` *(N8N, auth `INTERNAL_PROXY_TOKEN`)*
**Follow-Up IA:** `GET|POST /api/followup/config` *(corretor)* · `POST /api/followup/inbound` *(N8N: msg do cliente + gate `respond`)* · `POST /api/followup/broker-reply` *(N8N: handover humano)* — N8N usa `INTERNAL_PROXY_TOKEN`; um cron interno (60s) dispara os follows
**Admin** *(exige `requireAdmin` via header `x-user-id` de um broker `is_admin`)*: `GET /api/admin/brokers` · `GET /api/admin/metrics` · `PATCH /api/admin/brokers/:id/status` · `GET /api/admin/brokers/:id` · `POST /api/admin/brokers/:id/provision` · `PATCH /api/admin/brokers/:id/zpro-credentials` · `POST /api/admin/brokers/:id/cancel-plan` · `DELETE /api/admin/brokers/:id` · `POST /api/admin/brokers/:id/relink-uazapi`
**Proxy LLM:** `ALL /api/proxy/llm/:brokerPhone/*`

Autenticação geral: o frontend envia `Authorization: Bearer <supabase_token>` + `x-user-id: <user.id>` (ver `src/services/auth.ts`).

---

## 9. Frontend — rotas (`src/App.tsx`)

| Rota | Página | Acesso |
|------|--------|--------|
| `/login`, `/signup` | Login, Signup | público |
| `/forgot-password`, `/reset-password` | recuperação de senha | público |
| `/termos`, `/privacidade` | textos legais | público |
| `/p/:slug` | **PropertyLanding** (landing do imóvel) | público |
| `/payment`, `/payment/success`, `/payment/cancelled` | fluxo de pagamento | logado |
| `/admin` | **Admin** | logado (`is_admin`) |
| `/` | **Dashboard** | logado **+ assinatura ativa** (`PrivateRoute` checa `GET /api/subscription`; `pendente` → `/payment`) |

Dashboard concentra as abas: imóveis (`PropertyForm`), leads, agenda, configurações de IA (`AISettings`) + **Follow-Up Inteligente** (`FollowUpSettings`), corretora (`CorretoraSettings`).

---

## 10. Variáveis de ambiente (nomes — valores no `.env`/Fly)

`SUPABASE_URL`/`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`/`VITE_SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY` ·
`APP_URL` · `GEMINI_API_KEY` ·
`ASAAS_API_KEY`, `ASAAS_ENV`, `SUBSCRIPTION_VALUE` ·
`UAZAPI_TOKEN`, `UAZAPI_HOST`, `UAZAPI_PLATFORM_SESSION` ·
`ZPRO_ADMIN_URL`, `ZPRO_ADMIN_TOKEN`, `ZPRO_API_SECRET`, `ZPRO_JWT_SECRET` ·
`PROVISIONING_WEBHOOK_URL`, `N8N_WEBHOOK_URL`, `CHATBOT_WEBHOOK_URL` ·
`INTERNAL_PROXY_TOKEN`, `LLM_PROXY_ENC_KEY`, `OPENROUTER_API_KEY`.

> O servidor **recusa subir** sem `SUPABASE_SERVICE_ROLE_KEY`.

---

## 11. Pontos de atenção / roadmap

### ✅ Concluído (2026-05-27)
- **Rebranding "Criate":** title, favicon, header desktop, sidebar mobile, nav da landing.
- **Follow-Up Inteligente:** 3 timers independentes, auto-progressão, skip mensagens vazias — validado em produção.
- **Rate limiting:** `express-rate-limit` nos endpoints de auth, checkout e webhook Asaas.
- **Termos de Uso e Política de Privacidade:** 20 cláusulas cada, cobrindo LGPD, Marco Civil, Lei do Software, CDC, Decreto 7.962/2013.
- **Limpeza do histórico git:** service_role key do Supabase expurgada de todos os commits com `git-filter-repo`.
- **Tenant 209 (David):** validado.

### ⚠️ Urgente / bloqueante comercial
- **Rotacionar service_role key do Supabase** (chave antiga ficou no histórico git — ver HANDOFF.md §7).
- **Páginas legais:** preencher constantes de empresa (`RAZAO_SOCIAL`, `CNPJ`, `ENDERECO`, `EMAIL_CONTATO`, `EMAIL_DPO`) no topo de `Termos.tsx` e `Privacidade.tsx`.

### 🟡 Pendente / roadmap
1. **N8N — sub-workflow "Deletar Agendamento":** campo `id visita` vazio; URL correta: `$json.url/scheduleReminder/delete/$json['id visita']`; nó "When Executed by Another Workflow" precisa de `$fromAI()` no campo; body `{}`.
2. **Email real de notificação de lead:** atualmente `console.log('[E-MAIL SIMULADO]')` em `server.ts` — implementar com Resend, SendGrid ou Nodemailer.
3. **Agente IA "Juliana":** colar conteúdo de `agent_system_message.txt` no nó "Agente IA Corretor" do N8N.
4. **GitHub Actions CI/CD:** `fly deploy` automático no push para `main` (`FLY_API_TOKEN` como secret).
5. **Rate limiting distribuído (Redis):** hoje cada máquina Fly tem contador independente — para multi-máquina correta, usar Redis (ex.: `rate-limit-redis`).
6. **Verificar ticket aberto antes de follow:** idealmente consultar Z-PRO API para não disparar follow em ticket já encerrado.
7. **Sentry / error tracking:** vários `catch` silenciosos em `server.ts`.
8. **Bug pré-existente:** `src/pages/ResetPassword.tsx:94` referencia `accessToken` inexistente (erro de typecheck, não afeta runtime).
9. **`UAZAPI_PLATFORM_SESSION`:** placeholder no `.env` local — recuperação de senha por WhatsApp só funciona se configurado na Fly.
10. **Lead/visita via WhatsApp:** hoje só a landing grava `leads`; gravar a partir da conversa do agente está no roadmap.
11. **`POST /api/whatsapp/send`:** caminho alternativo de envio (autenticado por `INTERNAL_PROXY_TOKEN`), não usado pelo fluxo N8N atual — candidato a consolidação futura.

---

## 12. Limpeza realizada (código morto removido em 2026-05-22)

Removido por estar **comprovadamente órfão** (sem referências; typecheck
confirmou que nada quebrou). Nenhuma lógica viva foi alterada:

| Item | Motivo |
|------|--------|
| `src/pages/WhatsAppSetup.tsx` | Página não roteada (não importada no `App.tsx`); leitura de QR migrou para o Z-PRO |
| `GET /api/whatsapp/status` (em `server.ts`) | Único consumidor era a página acima |
| `check.ts`, `check_env.ts`, `check_schema.ts` | Scripts de diagnóstico soltos (2 com service-role key hardcoded; um inseria dado de teste) |
