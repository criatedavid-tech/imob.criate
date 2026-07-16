# ImobiFlow — Documentação do Projeto

> Documento de referência técnica e operacional. Cobre arquitetura, fluxo
> ponta a ponta, modelo de dados, endpoints, integrações e pontos pendentes.
> **Não contém valores de segredos** — apenas os nomes das variáveis (os
> valores ficam no `.env` local, nos *secrets* da Fly e nas notas de memória).

Última atualização: 2026-07-16. **Comece pela §14.16** — ela registra a
virada de arquitetura mais importante do projeto: **o v2 é agora o projeto
principal; o v1 (`main`/`imobiflow.fly.dev`) fica só como rollback de
segurança**, sem receber trabalho ativo. §14.1-14.15 descrevem o estado do
v1 (ainda válidas para conceitos compartilhados — Asaas, billing, modelo de
dados core) mas ficaram desatualizadas quanto à experiência de produto, ao
provisionamento de WhatsApp e a boa parte do backend, que mudaram no v2. Os
checkpoints §14.24–§14.27 registram a auditoria mais recente de integridade,
performance e remoção de código órfão; §14.28 registra esse trabalho
commitado, pushed e deployado em produção.

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

> **Registro histórico:** o fluxo Z-PRO descrito em §5.1–§5.3 documenta a
> arquitetura anterior. O provisionamento atual usa UAZAPI nativa por
> `provisionUazapiInstanceNative`/`provisionUazapiInstanceForMember` e recebe
> mensagens em `/api/wpp-shim/inbound/:instanceId`. Veja o estado vigente em
> §14.16, §14.20 e §14.27.

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

---

## 13. Billing de excedente de atendimentos (implementado em 2026-06-11)

### Modelo de cobrança

| Parâmetro | Valor padrão | Env var para alterar |
|-----------|-------------|---------------------|
| Plano mensal |  (R$ 5,00 durante validação; futuro R$ 297,00) | Updating existing machines in 'imobiflow' with rolling strategy
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Waiting for 7814053f9e2078 [app] to have state: started
> [1/2] Machine 7814053f9e2078 [app] has state: started
> [1/2] Checking that 7814053f9e2078 [app] is up and running
> [1/2] Waiting for 7814053f9e2078 [app] to become healthy: 1/1

✔ [1/2] Machine 7814053f9e2078 [app] update succeeded
> [2/2] Updating 7840637a265778 [app]
> [2/2] Updating 7840637a265778 [app]
> [2/2] Waiting for 7840637a265778 [app] to have state: started
> [2/2] Machine 7840637a265778 [app] has state: started
> [2/2] Checking that 7840637a265778 [app] is up and running
> [2/2] Waiting for 7840637a265778 [app] to become healthy: 1/1

✔ [2/2] Machine 7840637a265778 [app] update succeeded |
| Atendimentos inclusos/ciclo | 100 | Updating existing machines in 'imobiflow' with rolling strategy
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Waiting for 7814053f9e2078 [app] to have state: started
> [1/2] Machine 7814053f9e2078 [app] has state: started
> [1/2] Checking that 7814053f9e2078 [app] is up and running
> [1/2] Waiting for 7814053f9e2078 [app] to become healthy: 1/1

✔ [1/2] Machine 7814053f9e2078 [app] update succeeded
> [2/2] Updating 7840637a265778 [app]
> [2/2] Updating 7840637a265778 [app]
> [2/2] Waiting for 7840637a265778 [app] to have state: started
> [2/2] Machine 7840637a265778 [app] has state: started
> [2/2] Checking that 7840637a265778 [app] is up and running
> [2/2] Waiting for 7840637a265778 [app] to become healthy: 1/1

✔ [2/2] Machine 7840637a265778 [app] update succeeded |
| Preço por atendimento excedente | R$ 2,00 | Updating existing machines in 'imobiflow' with rolling strategy
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Waiting for 7814053f9e2078 [app] to have state: started
> [1/2] Machine 7814053f9e2078 [app] has state: started
> [1/2] Checking that 7814053f9e2078 [app] is up and running
> [1/2] Waiting for 7814053f9e2078 [app] to become healthy: 1/1

✔ [1/2] Machine 7814053f9e2078 [app] update succeeded
> [2/2] Updating 7840637a265778 [app]
> [2/2] Updating 7840637a265778 [app]
> [2/2] Waiting for 7840637a265778 [app] to have state: started
> [2/2] Machine 7840637a265778 [app] has state: started
> [2/2] Checking that 7840637a265778 [app] is up and running
> [2/2] Waiting for 7840637a265778 [app] to become healthy: 1/1

✔ [2/2] Machine 7840637a265778 [app] update succeeded |

**Exemplo:** corretor com 250 atendimentos no ciclo → 150 excedentes → R$ 300,00 cobrado automaticamente no cartão.

---

### O que conta como atendimento

Um **ticket novo no Z-PRO** = 1 atendimento. A contagem é feita pela chave composta :
- Primeira mensagem de um lead novo → ticket A → conta 1
- Segunda mensagem do mesmo lead no mesmo ticket → mesmo ticket A → **não conta** (idempotente via UNIQUE INDEX)
- Lead retorna após meses, Z-PRO cria ticket B → conta +1

A contabilização ocorre no endpoint  (disparado pelo N8N a cada mensagem recebida).

---

### Tabelas envolvidas

#### 
Registra cada atendimento único por broker.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| uid=197609(Criate) gid=197121 groups=197121 | UUID PK | — |
|  | UUID FK brokers | Corretor dono do atendimento |
|  | TEXT | ID do ticket no Z-PRO |
|  | TEXT | Telefone normalizado do lead |
|  | TIMESTAMPTZ | Momento do primeiro contato deste ticket |

Índice único:  → garante que o mesmo ticket só conta uma vez.

#### 
Registra cada ciclo processado (com ou sem excedente).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| uid=197609(Criate) gid=197121 groups=197121 | UUID PK | — |
|  | UUID FK brokers | — |
|  | TIMESTAMPTZ | Início do ciclo () |
|  | TIMESTAMPTZ | Fim do ciclo ( anterior) |
|  | INT | Total de tickets no ciclo |
|  | INT | Limite do plano (padrão 100) |
|  | INT | Tickets acima do limite |
|  | NUMERIC | Preço unitário aplicado |
|  | INT | Valor cobrado em centavos |
|  | TEXT |  /  /  /  /  |
|  | TEXT | ID do payment no Asaas (quando ) |
|  | TEXT | Mensagem de erro (quando ) |
|  | TIMESTAMPTZ | Quando a cobrança foi confirmada |

####  — nova coluna
| Coluna | Tipo | Descrição |
|--------|------|-----------|
|  | TEXT | Token do cartão retornado pelo Asaas na criação da subscription. Permite cobranças avulsas futuras sem pedir o cartão novamente. |

---

### Fluxo de cobrança de excedente



**Tolerância de atraso:** o webhook do Asaas pode chegar com até 7 dias de atraso;  só processa se .

**Falha não-bloqueante:** se a cobrança de excedente falhar (cartão recusado, timeout), o registro fica  no banco, mas a renovação da assinatura principal **não é afetada**. Revisão manual via tabela .

---

### Endpoint para o corretor

 — autenticado com 

Retorna:


---

### Variáveis de ambiente relevantes

| Variável | Descrição |
|----------|-----------|
|  | Valor mensal do plano (R$ — padrão 49.90, validação 5.00, futuro 297.00) |
|  | Atendimentos inclusos no plano (padrão 100) |
|  | Preço por atendimento excedente em R$ (padrão 2.00) |
|  | Chave da API Asaas — necessária para criar payments de excedente |
|  |  = api.asaas.com; qualquer outro = sandbox |

Para alterar limites sem redeploy:
Updating existing machines in 'imobiflow' with rolling strategy
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Updating 7814053f9e2078 [app]
> [1/2] Waiting for 7814053f9e2078 [app] to have state: started
> [1/2] Machine 7814053f9e2078 [app] has state: started
> [1/2] Checking that 7814053f9e2078 [app] is up and running
> [1/2] Waiting for 7814053f9e2078 [app] to become healthy: 1/1

✔ [1/2] Machine 7814053f9e2078 [app] update succeeded
> [2/2] Updating 7840637a265778 [app]
> [2/2] Updating 7840637a265778 [app]
> [2/2] Waiting for 7840637a265778 [app] to have state: started
> [2/2] Machine 7840637a265778 [app] has state: started
> [2/2] Checking that 7840637a265778 [app] is up and running
> [2/2] Waiting for 7840637a265778 [app] to become healthy: 1/1

✔ [2/2] Machine 7840637a265778 [app] update succeeded


---

# 14. Estado Consolidado e Continuidade (atualizado 2026-07-02)

> **Leia esta seção primeiro se você é novo no projeto.** Ela é auto-contida e
> reflete o estado **real e verificado** do código em produção nesta data.
> Onde houver divergência com seções anteriores (§4 e §13), **esta seção
> prevalece** — as seções 1–13 foram escritas antes de duas mudanças grandes:
> (a) o *rename* das tabelas para o prefixo `imf_` (commit `c11caa4`) e
> (b) a migração do modelo de cobrança de excedente para "valor da assinatura
> ajustado antes da renovação". A §13 do documento, além disso, está
> **corrompida** (saída de `fly deploy` foi colada dentro das células das
> tabelas) — ignore-a e use a §14.5 abaixo.

---

## 14.1. Objetivo geral do projeto

**ImobiFlow** (marca comercial **Criate**) é um **SaaS B2B multitenant** para
corretores de imóveis brasileiros. A proposta de valor é uma **esteira 100%
automática**: o corretor assina o plano, paga pelo **Asaas**, e o sistema
**provisiona sozinho** um atendimento de WhatsApp isolado (número, sessão,
canal e um agente de IA) sem intervenção humana. A partir daí, um **agente de
IA no N8N** atende os clientes finais do corretor 24/7, respondendo com base
nos **imóveis que o corretor cadastrou** no painel e reativando leads silenciosos
via **follow-up automático**.

Em uma frase: **"pague e, minutos depois, tenha um vendedor de imóveis por IA
no seu WhatsApp, alimentado pelo seu próprio catálogo."**

Divisão de painéis (importante não confundir):
- **ImobiFlow / Criate** (este repositório, `imobiflow.fly.dev`): cadastro de
  imóveis, landing pages, leads, agenda, configuração do agente de IA,
  pagamento, billing de excedente e o **motor de provisionamento**.
- **Z-PRO** (`app.criate.online`): onde o corretor **lê o QR Code** e opera a
  caixa de entrada do WhatsApp (inbox/tickets). É um produto de terceiros
  (fork do Whaticket) que orquestramos via API.

---

## 14.2. Arquitetura atual

### Visão de componentes

```mermaid
flowchart TB
    subgraph Cliente["Navegador / Cliente final"]
        Painel["Painel Corretor (React SPA)"]
        Landing["Landing /p/:slug (público)"]
        Zap["Cliente final no WhatsApp"]
    end

    subgraph Fly["Fly.io — app 'imobiflow' (2 máquinas, GRU)"]
        API["server.ts — Express + TS<br/>(monolito ~3900 linhas)<br/>+ serve dist/ do Vite"]
        Cron1["Cron 60s: follow-up<br/>(claim_due_followups)"]
        Cron2["Cron 60min: prepareOverageBilling<br/>(com lock distribuído)"]
    end

    subgraph Ext["Integrações externas"]
        Supa[("Supabase<br/>Postgres + Auth<br/>umvbrahsqvqeondwtikm")]
        Asaas["Asaas<br/>(assinatura + excedente)"]
        Zpro["Z-PRO<br/>appback.criate.online"]
        Uaz["UAZAPI<br/>criate.uazapi.com"]
        N8N["N8N<br/>212hook.criate.online"]
        OR["OpenRouter (LLM)"]
        Gem["Google Gemini<br/>(melhora de texto)"]
    end

    Painel -->|"Bearer + x-user-id"| API
    Landing -->|"POST /api/leads"| API
    Zap --> Uaz --> Zpro -->|"webhook msg"| N8N
    N8N -->|"INTERNAL_PROXY_TOKEN"| API
    N8N -->|"LLM proxy"| API --> OR
    API --> Supa
    API --> Asaas
    API -->|"provisiona"| Zpro
    API -->|"cria instância"| Uaz
    API --> Gem
    Cron2 --> Asaas
    Cron1 --> Zpro
    Asaas -->|"webhooks pagamento"| API
```

### Características arquiteturais-chave

- **Monólito intencional — agora modular (concluído em 2026-07-02).** Um único
  processo/deploy no Fly continua sendo a decisão certa (ver §14.8); só o
  **arquivo** deixou de ser monolítico. `server.ts` caiu de **181KB (4025
  linhas) para 3,2KB (~85 linhas)** — virou puramente um orquestrador: cria o
  app Express, monta os middlewares globais, monta os routers por domínio e
  os cron jobs, e sobe o servidor. Toda a lógica foi redistribuída em 22
  arquivos sob `server/`:
  - `server/config.ts` — todas as env vars.
  - `server/supabase.ts` — cliente Supabase.
  - `server/lib/` — `crypto.ts` (encrypt/decrypt/normalizePhoneBR),
    `zproAuth.ts` (JWT do Z-PRO), `infra.ts` (Sentry/Redis).
  - `server/middleware/` — `auth.ts` (requireUser/optionalUser/requireAdmin/
    getBrokerId), `rateLimits.ts` (os 3 limiters).
  - `server/services/` — `billing.ts` (handleAsaasPaymentReceived,
    prepareOverageBilling, chargeOverageIfDue, asaasHeaders),
    `provisioning.ts` (toda a esteira Z-PRO/UAZAPI — createZproTenantAndChannel
    e as ~12 funções auxiliares), `followup.ts` (runFollowupTick + engine).
  - `server/routes/` — um arquivo por domínio (auth, brokers, properties,
    corretora, ai, dashboard, leads, agenda, billing, whatsapp, llmProxy,
    admin, followup), cada um exportando um `express.Router()` montado em
    `server.ts`.
  - Verificação: **65 de 65** combinações método+rota conferidas 1:1 contra o
    arquivo original (nenhuma perdida/duplicada), `tsc --noEmit` limpo, build
    ok, `tsx server.ts` sobe sem erro. Nenhum comportamento foi alterado —
    é reorganização pura de código.
  - Domínios novos do roadmap (Locação, Lançamentos, Financeiro, Equipe...)
    já nascem como `server/routes/<dominio>.ts` a partir de agora — ver
    `UX_MASTERPLAN.md`.
- **Multitenant por `broker_id`.** Cada corretor é um *tenant*. O isolamento
  é **100% responsabilidade do código de aplicação**, porque o backend usa a
  `service_role` do Supabase, que **ignora RLS** (ver §14.5.2 e §14.9).
- **Stateless + 2 máquinas.** O Fly roda 2 VMs com `auto_start_machines`.
  Qualquer job agendado (`setInterval`) roda **nas duas** — daí a necessidade
  de **locks/claims atômicos no Postgres** para tudo que não pode duplicar.
- **Frontend só fala com o backend.** O SPA nunca consulta o Supabase
  diretamente (o cliente `anon` em `src/lib/supabase.ts` é exportado mas
  **nenhum** `.from()`/`.rpc()` o usa). Isso torna seguro habilitar RLS sem
  quebrar a UI.

---

## 14.3. Tecnologias utilizadas

| Camada | Tecnologia | Observação |
|--------|-----------|-----------|
| Backend | Node + Express + TypeScript, via `tsx server.ts` (porta 3000) | `--max-old-space-size=1024` evita OOM em uploads base64 |
| Frontend | Vite + React 19 + React Router 7 + Tailwind 4 | Design system "Liquid Glass" (`motion`, `recharts`, `lucide-react`) |
| Banco/Auth | Supabase (`umvbrahsqvqeondwtikm`) — Postgres + Auth | Instância **compartilhada** com outros projetos (ver §14.5) |
| Deploy | Fly.io — app `imobiflow` (`imobiflow.fly.dev`), 2 máquinas GRU | CI/CD: GitHub Actions faz `fly deploy` no push para `main` |
| Pagamentos | Asaas — assinatura mensal recorrente + cobrança de excedente | `ASAAS_ENV=production` → `api.asaas.com`; senão sandbox |
| WhatsApp | Z-PRO (fork Whaticket) sobre UAZAPI | Z-PRO orquestra; UAZAPI é o provedor real do número |
| Automação IA | N8N (`212hook.criate.online`) | Fluxo do agente + provisioning webhook |
| LLM | OpenRouter | Chave por corretor (fallback da empresa) via proxy |
| Texto auxiliar | Google Gemini | "Varinha mágica" para melhorar descrições de imóveis |

Rodar / deployar:
```bash
# Local (em C:\Users\Criate\imob.criate)
npm run dev     # tsx --max-old-space-size=1024 server.ts (porta 3000)
npm run build   # vite build → dist/
npm run lint    # tsc --noEmit (typecheck — sempre rode antes de commitar)

# Produção: push para main dispara GitHub Actions → fly deploy
# (ou manual) fly deploy --app imobiflow
```

---

## 14.4. Estrutura do banco de dados (Supabase) — **fonte de verdade atual**

> ⚠️ **Mudança crítica vs. §4:** as tabelas **núcleo** foram renomeadas para o
> prefixo `imf_` no commit `c11caa4`. A §4 (que lista `brokers`, `properties`,
> `agenda`, `ticket_events`, `overage_charges`) está **desatualizada**. Além
> disso, a instância Supabase é **compartilhada** com outros sistemas da Criate
> (CVV usa prefixo `cvv_`, Criate IA usa `ia_`, zpro-dashboard usa `zpro_`).
> **Sempre filtre pelo prefixo `imf_` ao mexer em tabelas deste projeto.**

### Tabelas com prefixo `imf_` (renomeadas — núcleo do produto)

| Tabela | Papel | Colunas relevantes |
|--------|-------|--------------------|
| `imf_brokers` | Corretor / tenant (núcleo) | `id`, `user_id` (Auth), `name`, `email`, `phone`, `is_admin`, `corretora_id`, `status` (`pendente`/`ativo`/`inativo`/`bloqueado`), `plan`, `valid_until`, `grace_until`, `asaas_customer_id`, `asaas_subscription_id`, `asaas_credit_card_token`, `provisioning_status`, credenciais Z-PRO (`zpro_*`), `ai_name`, `broker_address`, `openrouter_api_key_enc`, `reset_token` |
| `imf_properties` | Imóveis | `id`, `title`, `price`, `location`, `description`, `image_url` (JSON), `slug`, `link`, `status`, `broker_id`, timestamps |
| `imf_agenda` | Visitas/agenda (calendário) | `id`, `broker_id`, `lead_id`, `property_id`, `title`, `scheduled_at`, `status`, dados do cliente |
| `imf_ticket_events` | 1 linha por atendimento único (base do billing) | `id`, `broker_id`, `zpro_ticket_id`, `customer_phone`, `created_at`. **UNIQUE `(broker_id, zpro_ticket_id)`** garante idempotência |
| `imf_ticket_adjustments` | Ajustes manuais de atendimentos (admin) | `id`, `broker_id`, `type` (`bonus` \| `charge`), `amount`, `period_start`, ... |
| `imf_overage_charges` | Log de cada ciclo de billing processado | ver §14.5. **UNIQUE `(broker_id, billing_period_end)`** (índice `uq_overage_broker_period`, criado nesta rodada) |
| `imf_billing_lock` | **NOVO** — lock distribuído do cron de billing | `lock_key` (PK), `acquired_at`, `expires_at` |

### Tabelas **sem** prefixo (não foram renomeadas — atenção!)

`leads`, `corretoras`, `subscriptions`, `webhook_logs`, `followup_config`,
`followup_conversations`, `broker_agents`.

- **`broker_agents`** (novo): agente(s) de IA por corretor —
  `id`, `broker_id`, `agent_name`, `system_prompt`, `is_active`, `updated_at`.
  Substitui a antiga UI de `ai_custom_prompt`. O N8N lê via
  `GET /api/brokers/:id/agent` (auth `INTERNAL_PROXY_TOKEN`).
- **`followup_conversations`**: estado do follow por conversa —
  `broker_id`, `customer_phone`, `last_customer_message_at`, `follow_sent`,
  `follow_sent_at`, `follow_message_index` (0..3), `ai_active`,
  `human_takeover_at`. **UNIQUE `(broker_id, customer_phone)`**.

### RPCs (funções Postgres) em uso

| Função | Uso | Onde |
|--------|-----|------|
| `claim_due_followups()` | Claim atômico dos follow-ups vencidos (multi-máquina safe) | cron 60s |
| `try_billing_lock(p_key, p_ttl_seconds)` | **NOVO** — adquire lock do billing; retorna `true`/`false` | `prepareOverageBilling` |
| `release_billing_lock(p_key)` | **NOVO** — libera o lock no `finally` | `prepareOverageBilling` |

---

## 14.5. Fluxos implementados

Os fluxos de ciclo de assinatura, conteúdo e follow-up da §5 continuam como
referência, usando as tabelas com prefixo `imf_`. Já o provisionamento,
ativação e transporte de mensagens Z-PRO de §5.1–§5.3 são **históricos**:
foram substituídos pela UAZAPI nativa e pelo WPP Shim, conforme §14.16,
§14.20 e §14.27. Abaixo estão os fluxos **novos ou alterados**.

### 14.5.1. Billing de excedente (modelo atual — substitui §13)

O modelo **mudou**: em vez de criar uma cobrança avulsa no cartão, o sistema
**ajusta o valor da própria assinatura no Asaas** antes da renovação. Assim o
corretor recebe **uma única cobrança** = mensalidade + excedente.

**Parâmetros (env vars, alteráveis sem redeploy via `fly secrets set`):**

| Parâmetro | Valor atual | Env var |
|-----------|-------------|---------|
| Mensalidade | R$ 5,00 (validação) → R$ 297,00 (futuro) | `SUBSCRIPTION_VALUE` |
| Atendimentos inclusos/ciclo | 100 | `PLAN_INCLUDED_TICKETS` |
| Preço por excedente | **R$ 3,00** | `PLAN_OVERAGE_PRICE` |

> Nota: a §13 menciona R$ 2,00 — está **desatualizada**. O valor vigente é
> **R$ 3,00/ticket** (commits `dfbf16f`, `51f852f`).

**O que conta como atendimento:** 1 ticket novo no Z-PRO = 1 atendimento.
Mensagens subsequentes no mesmo ticket **não** contam (idempotência via UNIQUE
em `imf_ticket_events`). A contagem é registrada quando o N8N chama o endpoint
de inbound a cada mensagem.

**Ajustes manuais (admin):** via `imf_ticket_adjustments`, o admin pode lançar
`bonus` (aumenta o limite incluso) ou `charge` (soma direto ao excedente).
O cálculo efetivo é:
```
effectiveLim = max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + bonusAdj)
overage      = max(0, totalTickets - effectiveLim) + max(0, chargeAdj)
totalValue   = SUBSCRIPTION_VALUE + overage * PLAN_OVERAGE_PRICE
```

**Fluxo do cron `prepareOverageBilling` (roda a cada 60 min, nas 2 máquinas):**

```mermaid
sequenceDiagram
    participant Tick as setInterval 60min (VM-A e VM-B)
    participant Lock as RPC try_billing_lock
    participant DB as Supabase (imf_*)
    participant Asaas

    Tick->>Lock: try_billing_lock('billing_prep', ttl 7200s)
    alt não conseguiu o lock (outra VM já tem)
        Lock-->>Tick: false → aborta o tick (log e sai)
    else conseguiu o lock
        Lock-->>Tick: true
        Tick->>DB: brokers 'ativo' com valid_until em 20–28h
        loop cada broker
            Tick->>DB: já processou este ciclo? (idempotência)
            Tick->>DB: conta imf_ticket_events + lê imf_ticket_adjustments
            Tick->>Asaas: PUT /subscriptions/:id {value = base + excedente}
            Tick->>DB: INSERT imf_overage_charges (status scheduled_in_subscription | no_charge)
        end
        Tick->>Lock: release_billing_lock (no finally)
    end
```

**Status possíveis em `imf_overage_charges`:** `scheduled_in_subscription`
(excedente agendado no próximo ciclo), `included_in_subscription` (renovação já
cobrou), `no_charge` (sem excedente), e os legados `pending`/`charged`/`failed`/`waived`.

**Três camadas de proteção contra cobrança dupla** (implementadas nesta rodada):
1. **Lock distribuído** (`imf_billing_lock` + RPCs) — só uma VM executa o tick.
2. **Idempotência de ciclo** — checa se já existe registro para o período antes de agendar.
3. **UNIQUE `(broker_id, billing_period_end)`** — rede final: o banco recusa
   uma 2ª linha para o mesmo corretor no mesmo ciclo.

### 14.5.2. Isolamento multi-tenant (endurecido nesta rodada)

Como o backend usa `service_role` (ignora RLS), **cada rota** precisa derivar o
tenant do **token de autenticação**, nunca de `broker_id` vindo do cliente.

```mermaid
flowchart TD
    Req["Requisição chega em uma rota"] --> Q{Tipo de rota?}
    Q -->|"Painel (browser)"| A["requireUser → getBrokerId(userId)<br/>IGNORA broker_id do body/query<br/>toda query .eq('broker_id', brokerId)"]
    Q -->|"Interna (N8N/proxy)"| B["exige header Authorization<br/>== INTERNAL_PROXY_TOKEN"]
    Q -->|"Pública (landing)"| C["valida payload;<br/>escreve escopo por property_id"]
    A --> RLS["RLS (rede de defesa):<br/>anon/frontend só vê broker do auth.uid()"]
    B --> RLS
    C --> RLS
```

**Correções aplicadas (commit `fc5b7e7`):**
- `DELETE /api/properties/:id` — **estava sem autenticação nenhuma**. Agora:
  `requireUser` + `getBrokerId` + `.eq('broker_id', brokerId)`.
- `PATCH /api/properties/:id/status` — agora escopado por `broker_id` (403 se não for dono).
- `PATCH /api/leads/:id/status` — escopado via `property_id` do broker (403 se não for dono).
- **RLS habilitado** em `imf_properties`, `imf_agenda`, `imf_overage_charges`
  (+ condicionalmente `imf_ticket_adjustments` e `followup_conversations`),
  com policy `broker_id = (SELECT id FROM imf_brokers WHERE user_id = auth.uid())`.
  É **defesa em profundidade**: não protege o backend (service_role ignora RLS),
  mas blinda qualquer acesso futuro via chave `anon`.

---

## 14.6. Integrações realizadas

Idêntico à §7 (Asaas, Z-PRO admin+externa, UAZAPI, N8N, OpenRouter, Gemini).
Pontos que um novo dev precisa memorizar:

- **Envio de mensagem no Z-PRO:** header `Authorization: Token {zpro_api_token}`
  (não `Bearer`), body `{ body, number, externalKey, isClosed:false }`, na URL
  base `zpro_api_url`. Confirmado em produção.
- **`wabaId` é o campo crítico** da UAZAPI→Z-PRO: sem ele, o canal nunca ativa.
  O webhook precisa existir **antes** de conectar o WhatsApp (ver §4).
- **N8N → backend** sempre autentica com `INTERNAL_PROXY_TOKEN` (Bearer).

**Os 3 webhooks (não confundir):** `PROVISIONING_WEBHOOK_URL` (entrega
credenciais), `N8N_WEBHOOK_URL` (mensagens dos clientes), `CHATBOT_WEBHOOK_URL`
(lead da landing, opcional). Há ainda o webhook interno UAZAPI→Z-PRO.

---

## 14.7. Funcionalidades já concluídas

- [x] Esteira completa de provisionamento (8 passos) — Z-PRO + UAZAPI.
- [x] Dashboard do corretor (imóveis, leads, agenda, configurações).
- [x] Landing page por imóvel `/p/:slug` + captura de leads.
- [x] Pagamento Asaas (assinatura recorrente, grace period, webhooks).
- [x] Follow-Up Inteligente (3 timers independentes, handover humano) — **validado**.
- [x] Rate limiting (auth/checkout/webhook) + Redis distribuído com fallback.
- [x] Termos de Uso e Política de Privacidade (LGPD/Marco Civil/CDC).
- [x] CI/CD GitHub Actions (`fly deploy` no push para `main`).
- [x] **Rename das tabelas para prefixo `imf_`** (higiene do banco compartilhado).
- [x] **Agente(s) por corretor** (`broker_agents`, `system_prompt` custom).
- [x] **Agenda com calendário completo** (CRUD painel + endpoints N8N que substituem `/appointment/*` do Z-PRO).
- [x] **Billing de excedente** — contagem idempotente + ajuste da assinatura no Asaas.
- [x] **Ajuste manual de atendimentos** no painel admin (bonus/charge).
- [x] **[Esta rodada] Lock distribuído no billing** — impede cobrança duplicada em 2 VMs.
- [x] **[Esta rodada] Endurecimento multi-tenant** — 3 rotas corrigidas + RLS de defesa.
- [x] **[2026-07-01] Correção das 2 regressões pós-rename** — `GET /api/tickets/recent` passou a ler `imf_ticket_events`; `GET /api/agenda` retorna `[]` hardcoded (a feature de slots públicos nunca existiu de fato — expor `imf_agenda` ali vazaria nome/telefone de clientes de todos os corretores, pois o endpoint é público).
- [x] **[2026-07-01] Idempotência de pagamento + guarda anti-reativação** — `subscriptions` com upsert `ON CONFLICT (asaas_payment_id)`; renovação de um broker com `provisioning_status='disabled'` (cancelado) não reativa mais a conta (grava `paid_after_cancellation` + alerta em `webhook_logs`).
- [x] **[2026-07-01] Textos legais preenchidos** — `RAZAO_SOCIAL`, `CNPJ`, `ENDERECO`, `EMAIL_CONTATO`/`EMAIL_DPO` em `Termos.tsx`/`Privacidade.tsx` com dados oficiais da Receita Federal.
- [x] **[2026-07-01] Registro de aceite dos Termos + re-aceite** — colunas `terms_version`/`terms_accepted_at` em `imf_brokers`; constante `TERMS_VERSION` no `server.ts` (mudar quando os Termos mudarem); `GET /api/terms/status` + `POST /api/terms/accept`; modal `TermsGate.tsx` bloqueia o painel até o aceite da versão vigente.
- [x] **[2026-07-02] Copyright dinâmico** em todas as páginas — componente `src/components/Copyright.tsx` com ano calculado em runtime (`variant='dark'|'light'`, `short` para espaços estreitos como a sidebar).

### Superfície de endpoints nova/alterada desde a §8

| Endpoint | Auth | Função |
|----------|------|--------|
| `GET|POST /api/brokers/my-agent` | corretor | lê/salva o agente de IA do corretor |
| `GET /api/brokers/:id/agent` | `INTERNAL_PROXY_TOKEN` | N8N busca prompt do agente |
| `GET|POST|PATCH|DELETE /api/agenda/visits[/:id]` | corretor | CRUD do calendário |
| `GET /api/agenda/n8n/list` · `POST .../create` · `PATCH|DELETE .../:id` | `INTERNAL_PROXY_TOKEN` | agenda pelo agente N8N |
| `GET /api/billing/usage` | corretor | uso do ciclo atual + histórico |
| `GET /api/admin/brokers/:id/ticket-usage` | admin | uso detalhado de um corretor |
| `POST /api/admin/brokers/:id/ticket-adjustment` | admin | lança bonus/charge |

---

## 14.8. Decisões arquiteturais tomadas

| Decisão | Por quê |
|---------|---------|
| **Monólito `server.ts`** | Um dev só, iteração rápida, deploy trivial. Fragmentar cedo custaria mais do que resolve. Reavaliar só quando escalar o time. |
| **Lock por tabela (`imf_billing_lock`) e não `pg_advisory_lock`** | supabase-js usa conexões **pooled**; um advisory lock preso a uma sessão é frágil. Uma tabela com `expires_at` sobrevive à troca de conexão e **se auto-cura** de deadlock via TTL. |
| **Idempotência em 3 camadas no billing** | Cobrança dupla é dano financeiro direto ao cliente. Lock (evita concorrência) + checagem de ciclo (evita repetição lógica) + UNIQUE (garantia do banco). "Na dúvida, não cobra." |
| **Manter `service_role` no backend + RLS só como defesa** | Trocar para `anon` quebraria toda a escrita do sistema. A regra virou: **nunca confiar em `broker_id` do cliente**; RLS é rede, não o muro principal. |
| **`INTERNAL_PROXY_TOKEN` para rotas do N8N** | Separa claramente "rota de browser" (token de usuário) de "rota máquina-a-máquina" (token compartilhado), sem expor dados de um tenant a outro. |
| **Marcador ZWSP nas mensagens do sistema** | Distingue "mensagem do agente/follow-up" de "corretor digitou manualmente" sem depender de flags não confiáveis do Z-PRO — dispara o handover humano corretamente. |
| **Cron a cada 60min com janela 20–28h** | Prepara o billing com folga antes da renovação, tolerando atraso de webhook do Asaas, sem preparar cedo demais. |

---

## 14.9. Problemas encontrados e como foram resolvidos

| Problema | Resolução |
|----------|-----------|
| **Cobrança duplicada** se o Fly subir 2 VMs (ambas rodam o `setInterval` de billing) | Lock distribuído no Postgres (`try_billing_lock`/`release_billing_lock`) + idempotência de ciclo + UNIQUE `(broker_id, billing_period_end)`. |
| **`DELETE /api/properties/:id` sem autenticação** (qualquer um deletava imóvel de qualquer corretor) | Adicionado `requireUser` + escopo `.eq('broker_id', getBrokerId(userId))`. |
| **Vazamento cross-tenant** em rotas que confiavam em `broker_id` do cliente | Rotas de painel passam a derivar o tenant **sempre** do token; rotas internas exigem `INTERNAL_PROXY_TOKEN`; RLS habilitado como rede. |
| **`ADD CONSTRAINT IF NOT EXISTS` é inválido no Postgres** (bug no arquivo de migration) | Trocado por `CREATE UNIQUE INDEX IF NOT EXISTS` (idempotente, mesmo efeito) — commit `b4d441c`. |
| **supabase-js `.rpc()` não é Promise nativa** (`.catch` não existe até dar `await`) | `release_billing_lock` embrulhado em `try/catch` com `await`, dentro do `finally`. |
| **Sem rota de rede para o Supabase a partir do ambiente de dev** (TLS falha) | Verificação de banco (RLS ativo, funções existem) feita pelo usuário no **SQL Editor** do Supabase. |
| **`wabaId` ausente → canal "Não ativado"** | Gravar `wabaId = instance.id` no canal e criar o webhook **antes** de conectar (ver §4). |
| **Cancelamento no painel Asaas não remove cobranças já geradas** — episódio real (broker hunter, 2026-06/07): cancelou a assinatura, mas uma cobrança `PAYMENT_OVERDUE` remanescente sofreu retry do Asaas e reativou a conta | `handleAsaasPaymentReceived` agora checa `provisioning_status==='disabled'` antes de reativar por renovação; grava `paid_after_cancellation` em vez de reativar (commit `267baf0`). |
| **Webhooks da Asaas chegam duplicados (~200ms de intervalo)** — causava risco de linha dupla em `subscriptions` | `upsert` com `ON CONFLICT (asaas_payment_id)` + `ignoreDuplicates` (commit `267baf0`, migração `20260701_subscriptions_payment_idempotency.sql`). |
| **Suposição errada: "a Asaas tem tokenização client-side (Asaas.js) para tirar o cartão do backend"** | Verificado na documentação oficial da Asaas (2026-07-02): **não existe**. O fluxo atual (servidor recebe, repassa via HTTPS, nunca loga/persiste) já é o padrão recomendado pela própria Asaas para quem processa cartão no backend (SAQ-D). Reduzir para SAQ-A exigiria migrar para o checkout hospedado deles (redirect), o que é decisão de produto, não bug. |

---

## 14.10. Estado atual do sistema

- **Em produção**, 2 VMs no Fly (GRU), deploy automático via GitHub Actions.
- Billing de excedente **protegido contra duplicidade** e **verificado no banco**
  (RLS ativo em `imf_properties`/`imf_agenda`/`imf_overage_charges`; funções
  `try_billing_lock`/`release_billing_lock` existem; índice único aplicado).
- Isolamento multi-tenant **endurecido** nas rotas de escrita conhecidas.
- Modelo de cobrança vigente: **R$ 5,00 (validação) + R$ 3,00/atendimento
  excedente acima de 100/ciclo**. Trocar para R$ 297,00 após validação ponta a ponta.
- Regressões pós-rename corrigidas, billing com idempotência de pagamento e
  guarda anti-reativação, textos legais completos, aceite de Termos rastreado
  e copyright dinâmico em todas as telas — tudo deployado e verificado em produção.
- **Sem assinante pagante ativo no momento** (o único broker de teste com cartão
  real foi cancelado/removido) — a validação viva do lock de billing na renovação
  (§14.11.A item 4) segue pendente por falta de um ciclo real para observar.

> Commits desta rodada (2026-07-01/02): `649d88c`, `7adbb11`, `34ff34e`,
> `267baf0`, `869e3db`, `0b6ff89`, `d03dbed`. Commits da rodada anterior:
> `fc5b7e7` (isolamento + billing lock) e `b4d441c` (correção da migration).
> Migrations versionadas em `supabase/migrations/20260630_billing_lock_and_rls.sql`,
> `20260701_subscriptions_payment_idempotency.sql`, `20260701_terms_acceptance.sql`.

---

## 14.11. Próximos passos (roadmap detalhado para continuidade)

### A. O que ainda precisa ser desenvolvido / concluído

1. **⚠️ Rotacionar a `service_role key` do Supabase** *(segurança, bloqueante)*.
   A chave antiga ficou no histórico git (já expurgado, mas a chave real
   continua válida). Regenerar no dashboard → `fly secrets set SUPABASE_SERVICE_ROLE_KEY=...`.
   Travado: chave compartilhada entre vários projetos, aguardando autorização do líder.
2. ~~Corrigir 2 regressões de nomenclatura pós-rename~~ ✅ **RESOLVIDO 2026-07-01**
   (commits `649d88c` + `34ff34e`) — ver §14.7.
3. **Teste de isolamento com 2 corretores** *(validação da §14.5.2)*: autenticar
   como corretor A e tentar deletar/editar recurso do corretor B → esperar 403.
   Requer acesso de rede à produção (indisponível no ambiente de dev) — ainda não
   executado ao vivo (o sweep de código foi feito, mas não o teste black-box).
4. **Validar billing de renovação ponta a ponta**: lock distribuído (`fc5b7e7`) e
   idempotência de pagamento (`267baf0`) já estão deployados, mas **nunca foram
   testados com uma renovação real** — o único broker com cartão real (hunter)
   foi cancelado e removido do painel em 2026-07-01. Falta um teste dedicado em
   sandbox ou aguardar o próximo cliente pagante real. Monitorar
   `imf_overage_charges` (esperar 1 linha/ciclo) e `subscriptions.asaas_payment_id`
   (sem duplicatas) nesse teste.
5. ~~Preencher constantes legais~~ ✅ **RESOLVIDO 2026-07-01** (commit `869e3db`).
5b. ~~Registro de aceite dos Termos + re-aceite~~ ✅ **RESOLVIDO 2026-07-01**
    (commit `0b6ff89`). Aviso prévio de 30 dias por e-mail quando os Termos
    mudarem (seção 18) segue **manual** — o sistema não automatiza esse envio.
6. **Observabilidade:** confirmar se `SENTRY_DSN` está de fato setado nos Fly
   secrets — o código já suporta (`server.ts`, ativa sozinho se a env existir),
   mas não foi possível confirmar via `fly secrets list` neste ambiente
   (CLI sem permissão de execução no dev). Sem ele, exceções caem em `catch`
   silenciosos sem alerta.
7. **Ativar Redis distribuído** (`fly redis create` → `REDIS_URL`) — mesma
   observação do item 6: suportado no código, status real não confirmado.
8. **PCI — investigado em 2026-07-02, sem mudança de código ainda**: o item
   antigo "considerar tokenização Asaas.js no front" partia de uma premissa
   errada — a Asaas **não** oferece SDK de tokenização client-side (não existe
   "Asaas.js"). A documentação oficial recomenda que o comerciante que processa
   cartão no próprio backend seja certificado **SAQ-D** — que é exatamente o
   modelo atual (`POST /api/checkout` recebe os dados, repassa para a Asaas via
   HTTPS e **nunca loga nem persiste** PAN/CVV; só o `creditCardToken` de
   retorno é salvo em `imf_brokers.asaas_credit_card_token`). A única forma real
   de reduzir o escopo para **SAQ-A** seria trocar o formulário próprio
   (`PaymentPending.tsx`) pelo **checkout hospedado da Asaas** (redirect do
   cliente para a `invoiceUrl`, onde ele digita o cartão fora do seu domínio) —
   isso é uma mudança de produto/UX (perde o formulário com a marca própria),
   não uma correção técnica. Decisão de negócio pendente do usuário.
9. **Limpar registros de teste** em `imf_ticket_adjustments` (`+10`, `+50`, `-1`
   etc. lançados durante o desenvolvimento do ajuste manual de admin) — cosmético,
   não afeta billing real. Como o ambiente de dev não tem rota de rede ao
   Supabase, a limpeza precisa ser feita pelo usuário no SQL Editor (ver §14.13).

### B. Quais componentes devem ser alterados

| Componente | Alteração |
|-----------|-----------|
| `server.ts` (rotas de leitura pós-rename) | trocar `'agenda'`→`'imf_agenda'` e `'ticket_events'`→`'imf_ticket_events'` |
| `server.ts` (auditoria de isolamento) | varrer **todas** as rotas restantes que leem `broker_id`/`brokerId` de `req.query`/`req.body` e aplicar o padrão `getBrokerId` (a §14.5.2 cobriu as 3 conhecidas; falta um sweep completo) |
| `supabase/migrations/` | novas policies RLS para tabelas ainda sem RLS (`leads`, `subscriptions`, `webhook_logs`), se/quando o frontend passar a usar `anon` |
| `Termos.tsx` / `Privacidade.tsx` | constantes da empresa |
| Secrets Fly | `SERVICE_ROLE` rotacionada, `SENTRY_DSN`, `REDIS_URL` |

### C. Quais novos fluxos serão criados

- **Cobrança de excedente via cartão avulso** (caminho alternativo ao ajuste da
  assinatura), usando `imf_brokers.asaas_credit_card_token` — útil para cobrar
  fora do ciclo. Já há coluna e token salvos; falta o disparo.
- **Registro de lead/visita a partir da conversa do agente** (hoje só a landing
  grava `leads`) — o agente N8N passaria a criar lead + agendar visita.
- **Sub-workflow N8N "Deletar Agendamento"** — já mapeado (`/scheduleReminder/delete/`).

### D. Como isso se conecta à arquitetura existente

- As correções de nomenclatura e o sweep de isolamento são **locais** ao
  `server.ts` e não mudam contratos externos — baixo risco de regressão.
- A cobrança avulsa reaproveita `asaas_credit_card_token` + `imf_overage_charges`
  (novo status), encaixando no mesmo modelo de billing (§14.5.1).
- Lead-via-agente reaproveita o endpoint de inbound do N8N + tabela `leads` +
  `imf_agenda` — apenas estende o fluxo 5.3 (operação).

### E. Dependências entre as etapas

```mermaid
flowchart LR
    RotService["Rotar service_role"] --> ValBilling["Validar billing E2E"]
    FixRename["Corrigir 'agenda'/'ticket_events'"] --> TesteIso["Teste isolamento 2 corretores"]
    Sweep["Sweep de isolamento completo"] --> TesteIso
    ValBilling --> GoLive["Trocar SUBSCRIPTION_VALUE p/ 297,00"]
    TesteIso --> GoLive
    Legais["Preencher constantes legais"] --> GoLive
```

- **Rotacionar a chave** deve preceder qualquer validação séria de produção.
- **Trocar o preço para R$ 297** só depois de billing E2E **e** isolamento validados.

### F. Cuidados técnicos importantes

- **Sempre `npm run lint` (tsc) antes de commitar** — o typecheck pega
  regressões cedo (foi assim que o `.catch` do `.rpc()` foi flagrado).
- **Não confie em `broker_id` de query/body** em nenhuma rota de browser.
- **Não use `if (FLY_MACHINE_ID === 'x')`** como guarda de execução única —
  quebra em restart/realocação. Use lock/claim atômico no Postgres.
- **Postgres não aceita `ADD CONSTRAINT IF NOT EXISTS`** — use
  `CREATE UNIQUE INDEX IF NOT EXISTS`.
- **Não alterar valores/regras de billing** ao mexer em concorrência — só
  impedir execução duplicada.
- **Não troque `service_role` por `anon` no backend** — quebra a escrita.
- **Verificação de banco é feita pelo usuário no SQL Editor** (o ambiente de dev
  não tem rota de rede ao Supabase).

### G. Riscos e pontos de atenção

Ver §14.12.

---

## 14.12. Riscos e pontos de atenção (leitura obrigatória)

1. ~~Regressão pós-rename (`ticket_events`)~~ ✅ **RESOLVIDO 2026-07-01** (commit
   `649d88c`) — `GET /api/tickets/recent` já lê `imf_ticket_events`.
2. ~~`GET /api/agenda` silenciosamente vazio~~ ✅ **RESOLVIDO 2026-07-01** (commit
   `34ff34e`) — decidiu-se **não** apontar para `imf_agenda` (o endpoint é
   público e vazaria dados de clientes de todos os corretores); retorna `[]`
   hardcoded porque a feature de slots públicos nunca existiu de fato.
3. **RLS não protege o backend:** `service_role` ignora RLS por design. A
   proteção real do multitenant continua sendo o **código**. RLS só blinda
   acesso via `anon`. Nunca relaxe a regra do `getBrokerId`.
4. ~~Sweep de isolamento incompleto~~ ✅ **FEITO 2026-07-01** — revisados todos
   os ~180 usos de `broker_id`/`brokerId` em `server.ts`; nenhuma rota nova
   vulnerável encontrada além das 3 já corrigidas pelo `b4d441c`. Falta apenas
   o teste black-box ao vivo com 2 corretores reais (§14.11.A item 3).
5. **`service_role` ainda não rotacionada:** a chave antiga é válida e vazou no
   histórico git (mesmo expurgado). Bloqueante comercial.
6. **Instância Supabase compartilhada:** nunca rode migration/DROP sem filtrar
   pelo prefixo `imf_`. Tabelas `cvv_*`, `ia_*`, `zpro_*`, `luxashade*` são de
   **outros** projetos.
7. **§13 corrompida e §4 desatualizada:** use a §14 como fonte de verdade.
8. **Billing só é seguro se as 3 camadas estiverem ativas** (lock + idempotência
   + UNIQUE). Se alguém remover o índice único, a rede final cai.

---

## 14.13. Atualização 2026-07-02 — hardening de billing, legal, copyright e limpeza

Resumo do que mudou desde a última consolidação (todos os itens já **deployados
e verificados em produção**, exceto onde indicado):

- **Regressões pós-rename corrigidas** (`649d88c`, `34ff34e`) e **sweep completo
  de isolamento multi-tenant** (nenhuma rota nova vulnerável) — ver §14.7 e §14.12.
- **Episódio hunter (cancelamento + cobrança órfã):** broker de teste cancelou a
  assinatura no painel Asaas, mas uma cobrança remanescente sofreu retry e
  reativou a conta. Corrigido com idempotência de pagamento + guarda
  anti-reativação (`267baf0`, migração `20260701_subscriptions_payment_idempotency.sql`).
  Episódio encerrado sem dano financeiro real (usuário confirmou no app do
  cartão); o broker de teste foi removido do painel — **não há mais assinante
  pagante ativo**, então a validação viva do lock de billing (§14.11.A item 4)
  segue pendente.
- **Textos legais e aceite de Termos** (`869e3db`, `0b6ff89`): `Termos.tsx`/
  `Privacidade.tsx` com dados oficiais da empresa; rastreamento de aceite
  (`terms_version`/`terms_accepted_at` em `imf_brokers`) com modal de re-aceite
  (`TermsGate.tsx`) sempre que `TERMS_VERSION` mudar no `server.ts`.
- **Copyright dinâmico** (`d03dbed`): componente `Copyright.tsx` em todas as
  páginas (auth, legal, dashboard, admin, landing pública), ano calculado em
  runtime — nada para atualizar manualmente na virada do ano.
- **Investigação PCI (sem mudança de código):** confirmado com a documentação
  oficial da Asaas que não existe tokenização client-side ("Asaas.js"); o fluxo
  atual do checkout já segue o padrão recomendado (SAQ-D). Ver §14.11.A item 8
  para as opções reais caso se queira reduzir o escopo de PCI no futuro.
- **Organização de arquivos:** scratch de trabalho do workflow N8N do agente de
  IA (`agent_params.json`, `agent_system_message.txt`, `n8n_sdk_read.txt`,
  `n8n_workflow_update.js`, `gen_n8n_sdk.py`) e um rascunho de commit
  (`.commit_msg.txt`) foram movidos da raiz do repo para `scratch/`, agora no
  `.gitignore` — não afetam build/deploy (nenhum é importado por `server.ts`
  ou `src/`).

### Pendente: limpeza de `imf_ticket_adjustments` de teste

Existem lançamentos de teste (`+10`, `+50`, `-1` etc.) feitos durante o
desenvolvimento do ajuste manual de admin. São cosméticos — não afetam o
cálculo de billing real de nenhum corretor — mas poluem a visão do admin.
Como o ambiente de dev não tem rota de rede ao Supabase, rode você mesmo no
SQL Editor:

```sql
-- 1) Identifique o(s) broker(s) de teste e os lançamentos suspeitos
select ta.id, ta.broker_id, b.name, ta.type, ta.amount, ta.reason, ta.created_at
from imf_ticket_adjustments ta
join imf_brokers b on b.id = ta.broker_id
order by ta.created_at desc;

-- 2) Depois de confirmar quais IDs são de teste, apague só esses
-- (troque a lista de IDs pelos que você identificou no passo 1)
delete from imf_ticket_adjustments where id in ('<uuid1>', '<uuid2>');
```

Não deletei nada automaticamente porque a tabela é histórico financeiro
(mesmo que hoje sem impacto, o `historicTotal` de cada `type` é usado para
limitar estornos futuros — ver `server.ts` linha ~2601) e o comerciante deve
confirmar visualmente quais linhas são realmente de teste antes de apagar.

## 14.14. Atualização 2026-07-02 (continuação) — Carteira real + bug de follow-up encontrado

**Nova interface (`/app`) — sequência de 3 tarefas concluída** (ver `UX_MASTERPLAN.md`
§9 para o histórico completo):
1. Backend modularizado: `server.ts` (4025 linhas) → 22 arquivos em `server/`
   (config/supabase/lib/middleware/services/routes), `server.ts` virou orquestrador
   de ~85 linhas. Zero rota perdida (diff método+path 1:1 contra o original).
2. Cockpit "Hoje" do Corretor ligado a dados reais (`src/experience/realData.ts`).
3. Carteira real (`src/experience/CarteiraArea.tsx`) — lista/cria/edita/exclui
   imóveis reaproveitando `GET/DELETE /api/properties`, `PATCH .../status` e o
   `PropertyForm.tsx` já existentes, sem nenhuma rota nova.

Tudo verificado com `tsc --noEmit` limpo, `vite build` limpo e teste ao vivo (login
real, dados reais). **Nada disso foi commitado nem deployado ainda** — aguardando
aprovação explícita do usuário, dado que altera o backend inteiro de um sistema de
pagamento em produção sem suíte de testes automatizada.

**Pendente de decisão do usuário:** hoje o login sempre redireciona para `/`
(Dashboard antigo); a experiência nova só é vista acessando `/app` manualmente. Se
`/app` virar o destino padrão, é preciso portar antes a checagem de assinatura que
hoje só existe em `PrivateRoute` (bloqueia corretor inadimplente) — `ExperienceShell`
ainda só checa login, não status de pagamento.

**Bug encontrado (não relacionado à refatoração, pré-existente) — follow-up
automático quebrado, e correção detalhada na §14.15** (a primeira versão desta
seção continha um SQL baseado no arquivo local desatualizado — **não a use**;
a versão certa está na §14.15 e no arquivo `20260702_fix_claim_due_followups.sql`).

## 14.15. Auditoria de schema 2026-07-02 — tabelas, colunas e funções reais do Supabase

Rodada uma auditoria read-only (`information_schema`/`pg_catalog`) no banco
compartilhado, filtrando só o que é do ImobiFlow (prefixo `imf_` + `leads`,
`corretoras`, `subscriptions`, `webhook_logs`, `followup_*`, `broker_agents`).
Resultado: **nenhuma tabela faltando, nenhuma tabela nova sem o prefixo `imf_`
(sem risco de isolamento)**. Achados pontuais:

- **`claim_due_followups()` diverge do arquivo local `supabase_followup_per_delay.sql`.**
  A função que está rodando de verdade no banco já tem uma melhoria que nunca
  voltou pro repo: Follow 2 e Follow 3 contam o atraso a partir de
  `follow_sent_at` (quando o follow anterior foi enviado), não de
  `last_customer_message_at` como o arquivo local ainda diz. Além disso, a
  função ao vivo **também** tem o bug do `JOIN brokers` (tabela renomeada pra
  `imf_brokers`) — confirmado na definição real via `pg_get_functiondef`, não
  só suposto pelo arquivo.
- **Segundo bug, novo, achado na mesma função:** `claim_due_followups()` nunca
  devolve `zpro_ticket_id` no `RETURNS TABLE`. `server/services/followup.ts`
  já espera esse campo (`checkTicketOpen(row.zpro_ticket_id)`) pra não mandar
  follow-up se o corretor já assumiu a conversa manualmente no Z-PRO — sem o
  campo, `ticketId` chega sempre `undefined` e essa proteção nunca roda de
  verdade (o follow-up sai mesmo com o corretor já respondendo por fora).
- **Correção única para os 2 bugs:** `20260702_fix_claim_due_followups.sql`
  (raiz do repo) — recria a função preservando a lógica de cascata já em
  produção, corrige o nome da tabela e passa a devolver `zpro_ticket_id`.
  ✅ **APLICADO pelo usuário no Supabase em 2026-07-02** (precisou `DROP
  FUNCTION` antes — Postgres não deixa `CREATE OR REPLACE` mudar o tipo de
  retorno de uma função existente, erro `42P13`; arquivo já atualizado com o
  DROP incluso).
- **Doc desatualizada (cosmético):** §14.4 lista `lead_id` como coluna de
  `imf_agenda` — não existe. As colunas reais de cliente na agenda são
  `client_name`/`client_phone`/`client_email` (denormalizadas, sem FK pra
  `leads`). Não é bug de código, só a tabela deste doc estava errada.
- **Bug adicional achado ao verificar a correção acima — `GET /api/agenda/visits`
  sempre retornava 500.** O código usa `select('*, imf_properties(title))`
  (sintaxe de embed do PostgREST), que exige uma foreign key entre
  `imf_agenda.property_id` e `imf_properties.id` — a coluna existia, a FK não.
  Afetava o Dashboard antigo, o `AgendaCalendar.tsx` **e** o cockpit novo (os
  três chamam o mesmo endpoint); passou despercebido porque `imf_agenda`
  estava com 0 linhas. ✅ **CORRIGIDO em 2026-07-02** — usuário rodou
  `ALTER TABLE imf_agenda ADD CONSTRAINT imf_agenda_property_id_fkey FOREIGN KEY (property_id) REFERENCES imf_properties(id) ON DELETE SET NULL;`
  no Supabase (tabela vazia = zero risco de dado órfão travar o ALTER).
  Verificado ao vivo: endpoint voltou a responder `200 []` em vez de 500.
- **Colunas legadas do Stripe, sem uso** (não são bug, só ruído): `imf_brokers`
  tem `stripe_customer_id`/`stripe_subscription_id` e `subscriptions` tem
  `stripe_session_id`/`stripe_customer_id`/`stripe_subscription_id`/
  `stripe_payment_intent_id` + `UNIQUE(stripe_session_id)` — sobra de quando o
  billing era Stripe, antes de migrar pra Asaas. Nenhum código atual lê essas
  colunas. Seguro ignorar; só vale limpar se um dia normalizar o schema.
- **Nomes de constraint legados** (cosmético, sem impacto): `imf_brokers`,
  `imf_properties`, `imf_overage_charges`, `imf_ticket_adjustments`,
  `imf_ticket_events` têm PK/UNIQUE com nome antigo (ex.: `brokers_pkey` em vez
  de `imf_brokers_pkey`) — sobra do rename para o prefixo `imf_`, que não
  renomeou as constraints. Não afeta nada, não vale o churn de renomear.
- **Constraints de idempotência conferidas e intactas:**
  `followup_config_broker_id_key`, `followup_conversations_broker_id_customer_phone_key`,
  `uq_overage_broker_period`, `imf_properties_slug_key` — todas presentes.

## 14.16. Atualização 2026-07-13 — v2 vira o projeto principal; auditoria de features + hardening de segurança

### 🎯 Decisão de produto — leia isto primeiro

**O projeto principal agora é o v2.** `imobiflow-v2` — branch `v2`, deployado
num app Fly **separado**, `imobiflow-v2.fly.dev` — é onde todo o
desenvolvimento ativo acontece daqui pra frente. `imobiflow` (branch `main`,
app `imobiflow.fly.dev`, o "v1") **deixou de receber trabalho ativo** e
existe agora só como rollback de segurança, caso o v2 tenha algum problema
grave. Correções, features e hardening daqui pra frente são feitos no v2;
não devem ser retroportados pro v1 a menos que seja explicitamente pedido.
Isolamento de deploy mantido como sempre: `main` continua auto-deployando
via `.github/workflows/deploy.yml` só quando alguém dá push em `main` — o
trabalho no v2 não aciona isso.

### O que aconteceu entre a §14.15 (02/07) e hoje (13/07) — resumo da virada pro v2

Entre a última atualização deste documento e hoje, o v2 saiu de protótipo
(cockpit "Hoje" com dado mock) para um sistema completo com dado real em
praticamente toda superfície. Resumo do arco (detalhe completo, com commits,
está no histórico de sessões — este documento não reproduz cada passo):

- **Etapas 4-7 do `UX_MASTERPLAN.md`**: Negócios (funil), Agenda, Locação
  (contratos de aluguel) e Lançamentos (unidades de incorporadora, com
  reserva e trava por tempo) saíram de mock para núcleo real.
- **Etapas 12+13 — "cérebro" e autonomia reais**: a command bar deixou de
  ser decorativa. Hoje é um agente (`server/services/agent.ts`) que lê o
  estado real da conta (imóveis, visitas, contratos, unidades — conforme o
  tipo de conta) e decide, via Gemini com fallback automático pra OpenRouter
  em caso de cota esgotada, uma entre 12 ações possíveis. A autonomia
  (piloto/copiloto/manual) governa de verdade: piloto executa na hora,
  copiloto/manual só propõem e esperam confirmação. Toda mutação revalida
  posse no backend, independente da IA ter "decidido" a ação.
- **Tipo de conta real**: corretor/imobiliária/incorporadora deixou de ser
  um toggle de front (`account_type` em `imf_brokers`, escolhido no
  cadastro) — cada tipo só acende as superfícies relevantes.
- **Eliminação do Z-PRO** (plano em `stateless-drifting-turing.md`): Fases 1+2
  concluídas — provisionamento de WhatsApp passou a ser nativo via UAZAPI
  (`provisionUazapiInstanceNative`), sem o Z-PRO no meio. Fases 4+6 também
  prontas — tela de Conversas própria, com abas ia/aguardando/encerrado,
  substituindo o inbox do Z-PRO.
- **Episódio de rollback real (07/07)**: o v2 foi publicado direto em cima
  do `main` uma vez; um bug de UX (sem botão de logout, sessão de conta
  antiga presa no `localStorage` do navegador) pareceu, a princípio, um
  vazamento de autenticação entre corretores. Foi revertido na hora via
  `fly deploy -i <imagem anterior>`. Investigação confirmou que o
  isolamento por `broker_id` sempre foi sólido — o problema era só a UX de
  sessão (sem "Sair" visível). Esse episódio é parte do motivo do v2 hoje
  rodar num app Fly **separado** em vez de em cima do `main`.
- **Assistente ganhou ações progressivamente**: primeiro 6 (responder,
  navegar, cadastrar lead, agendar visita, consultar agenda, mandar
  mensagem real de WhatsApp) — validadas ao vivo com conta real, incluindo
  envio de WhatsApp de verdade. Hoje soma 12, incluindo `create_property`
  (ver próxima seção e a seção logo abaixo sobre 13/07).

### Auditoria completa de features (13/07) — 16 funcional / 5 parcial / 1 quebrada

Rodada uma auditoria das 22 funções do sistema, testadas via código e ao
vivo com 4 personas reais logadas simultaneamente (corretor, imobiliária,
incorporadora, admin). Achados e correções aplicadas na sequência:

- **Vitrine pública** (era a única "quebrada"): formulário de captação de
  lead e modal de "Entre em Contato" existiam prontos no código
  (`src/pages/PropertyLanding.tsx`) mas **nenhum botão os abria** — corrigido,
  adicionado o gatilho que faltava. De passagem, removido um segundo
  formulário de lead duplicado e nunca usado, e um passo de "escolher
  horário" que dependia de um endpoint público intencionalmente stubado
  (`GET /api/agenda` sempre devolve `[]` pra não vazar dado de agenda entre
  corretores).
- **Locação**: adicionado botão de editar contrato (não existia — só dava
  pra criar), campo de CPF/CNPJ com detecção e máscara automática
  (`src/lib/document.ts::maskCpfCnpj` — decide CPF vs. CNPJ pela quantidade
  de dígitos), campo de fim de contrato, e a UI de "gerar cobrança do mês"
  conectada de verdade ao boleto/PIX real via Asaas (`imf_rental_payments`).
- **Financeiro**: passou a agregar inadimplência real e um "fluxo de caixa"
  com os últimos 12 pagamentos de aluguel (`server/routes/financeiro.ts`) —
  antes só contava contratos ativos, sem nenhum dado de pagamento de fato.
- **Admin**: removidas 2 rotas Z-PRO órfãs, sem nenhum caller no frontend
  (`PATCH /brokers/:id/zpro-credentials`, `POST /brokers/:id/relink-uazapi`);
  botão de "provisionar" corrigido pra checar `uazapi_instance_id` (fluxo
  nativo) em vez de `zpro_tenant_id` (nunca era limpo pelo fluxo novo, então
  o botão nunca sumia mesmo já provisionado).
- **Assistente — 2 bugs reais achados em uso normal, ambos corrigidos**:
  (1) preço editado pelo assistente gravava número cru (`"350000"`) em vez
  do formato do app (`"R$ 350.000"`) — `normalizePriceToBRL()` em `agent.ts`
  resolve; (2) **fuso horário**: o servidor no Fly roda em UTC, então "13h"
  virava 13h UTC = 10h em Brasília — corrigido ancorando toda escrita e
  leitura de data/hora do agente em `America/Sao_Paulo`
  (`agent.ts::brDateTimeToISO` na escrita, `timeZone: BR_TZ` em todo
  `toLocaleString`/`toLocaleTimeString` de leitura).
- **Assistente ganhou 5 ações novas** (de 6 para 11), pedidas explicitamente
  depois da auditoria revelar essas lacunas: `update_property` (editar
  preço/título/status de imóvel), `cancel_visit`, `update_visit`
  (remarcar), `end_rental_contract` (só imobiliária), `update_unit`
  (reservar/vender/liberar, só incorporadora). **Bug real achado testando**:
  um cliente de teste chamado "Ana Teste Cancel" fez o modelo confundir e
  executar `cancel_visit` em vez de `create_visit`, cancelando uma visita
  antiga não relacionada. Corrigido com 2 regras novas no system prompt (id
  só é escolhido se o nome bater exatamente com a lista de contexto; uma
  palavra dentro do NOME de alguém não é comando) — retestado e confirmado.
- **Assistente ganhou a 12ª ação, `create_property`** (achada em uso real
  pelo usuário, não em auditoria): pedir pra IA "cadastrar um imóvel novo"
  sempre caía em `update_property` (a única ação relacionada a imóveis até
  então), que exige um `property_id` existente — resultava numa resposta
  confusa em vez de cadastrar. `create_property` cadastra de verdade,
  reaproveitando a MESMA convenção do `PropertyForm.tsx`/`properties.ts`:
  campos sem coluna própria (quartos, banheiros, área, piscina, vagas,
  tipo, finalidade, varanda gourmet) vão serializados dentro do
  `description`, depois de um separador `---DETALHES-GERADOS---`; o que não
  tem campo estruturado nenhum (suítes, andar, "banheiro de serviço") vira
  texto natural de venda escrito pela própria IA. Testado ao vivo (função
  chamada direto, sem precisar de login) com o mesmo pedido que falhou:
  "apartamento no Setor Oeste, 1 milhão, 3 quartos sendo 3 suítes, 1
  banheiro de serviço, área gourmet, piscina do prédio, 19º andar" — o
  agente extraiu preço "R$ 1.000.000", 3 quartos, 4 banheiros (3 suíte + 1
  serviço, somado corretamente), piscina e área gourmet marcados, e
  escreveu os detalhes sem campo próprio (andar, suítes) numa descrição de
  venda natural. Imóvel de teste removido depois da verificação.

### Auditoria de hardening de segurança (13/07) — 46 itens avaliados, 3 críticos

Auditoria separada, focada em segurança de infraestrutura (headers,
validação, rate limit, dependências, container/CI, testes, isolamento
multi-tenant, webhooks), cobrindo um checklist de 5 fases. Método: leitura
direta do billing/checkout, mais 3 agentes de exploração em paralelo
cobrindo headers/validação/rate-limit, dependências/Docker/CI, e testes de
segurança — todos só-leitura. Resultado: **3 críticos, 23 não implementados,
12 parciais, 8 OK**.

**Os 3 críticos, corrigidos e deployados no v2 no mesmo dia:**

1. **Vazamento de segredos na landing pública** —
   `server/routes/properties.ts` (`GET /api/properties/:slug`) fazia
   `select('*, imf_brokers(*))` sem allowlist nem autenticação, devolvendo a
   linha inteira de `imf_brokers` — incluindo `reset_token`,
   `zpro_api_token`, `uazapi_instance_token`, `asaas_credit_card_token`,
   `zpro_password`, `is_admin` — pra qualquer um que acessasse um slug de
   imóvel. **Corrigido**: allowlist explícita
   (`select('*, brokers:imf_brokers(name, phone, broker_address)')`) —
   exatamente os 3 campos que `PropertyLanding.tsx` usa. Achado de bônus: o
   frontend sempre leu a chave `brokers` (não `imf_brokers`), então o bloco
   "Fale com o corretor" da landing estava silenciosamente quebrado desde
   sempre — a mesma correção resolveu os dois problemas.
2. **Chave de serviço do Supabase com prefixo `VITE_`** — o `.env` local
   tinha `VITE_SUPABASE_SERVICE_ROLE_KEY` (prefixo que o Vite expõe no
   bundle do navegador) em vez de `SUPABASE_SERVICE_ROLE_KEY`.
   **Confirmado via `fly secrets list`**: produção (v1 e v2) já usava o
   nome correto — o erro nunca vazou de verdade, era só local. Corrigido o
   `.env` local e removido o fallback inseguro em `server/config.ts` que
   aceitava o nome com `VITE_` (pra esse erro não poder "funcionar
   silenciosamente" de novo no futuro).
3. **Webhook de entrada da UAZAPI sem autenticação** —
   `POST /api/wpp-shim/inbound/:instanceId` (`server/routes/wppShim.ts`)
   não validava token nem assinatura nenhuma, só confiava que o
   `:instanceId` da URL batesse com algum corretor no banco. Quem
   descobrisse um `instanceId` podia injetar "mensagem de cliente" falsa ou
   acionar a IA a mandar WhatsApp real em nome de um corretor. **Corrigido**:
   a rota agora exige que `body.token` bata com o `uazapi_instance_token`
   salvo do corretor — verificado contra 5 payloads reais recentes em
   `webhook_logs` antes de implementar (a UAZAPI ecoa o token da própria
   instância em todo evento; bateu 5 de 5).

**Ficou pendente (não crítico, não corrigido ainda)**: CSP desativada
(`helmet({ contentSecurityPolicy: false })`), `Permissions-Policy` ausente,
sem validação de schema centralizada (zod/joi), erros de rota vazando
`err.message` cru quase universalmente, sem `trust proxy` (crítico atrás do
proxy do Fly), rate limit provavelmente em memória por VM (não confirmado
`REDIS_URL` ativo), sem timeout/retry nas chamadas a Asaas/UAZAPI/Gemini,
webhook do Asaas sem `ASAAS_WEBHOOK_TOKEN` setado no v2 (setado no v1),
7 vulnerabilidades `high` no `npm audit` (2 delas em `nodemailer`/
`http-proxy-middleware`, dependências mortas sem uso real), Dockerfile
single-stage rodando como root sem pin de digest, backend nunca compilado
(roda `tsx` interpretado em produção), e a GitHub Action de deploy pinada
em `superfly/flyctl-actions/setup-flyctl@master` — um branch mutável, o
vetor clássico de supply-chain attack via Actions.

### Próximo passo (aguardando o usuário)

Uma nova rodada de auditoria será trazida pelo usuário em breve — os itens
"pendente" acima são o ponto de partida esperado para essa próxima rodada.

## 14.17. Atualização 2026-07-13 (continuação) — 9 itens de hardening fechados + WhatsApp por membro (codificado, bloqueado)

### 9 itens não-críticos do hardening, fechados um a um (todos deployados no v2)

Depois dos 3 críticos da §14.16, o usuário pediu pra seguir pela lista
restante "um por um". Cada item abaixo foi implementado, testado
(`tsc --noEmit`/`vite build`), deployado (`fly deploy -a imobiflow-v2`) e
confirmado com `curl` antes do próximo:

1. **`trust proxy`** — `app.set('trust proxy', 1)` em `server.ts`, necessário
   pro rate limit por IP e pros logs refletirem o IP real atrás do proxy do Fly.
2. **Dependências mortas removidas** — `nodemailer`, `@types/nodemailer`,
   `http-proxy-middleware` (zero uso real confirmado); `npm audit` high caiu
   de 7 pra 5.
3. **`Permissions-Policy`** — nega câmera/microfone/geolocalização/pagamento/
   USB/sensores/`interest-cohort` por padrão (confirmado que o app não usa
   nenhuma dessas APIs — só `navigator.clipboard.writeText`, não afetado).
4. **Health check sem vazamento** — `GET /api/properties/health` parou de
   devolver `full_error` (objeto de erro completo) numa rota pública; loga
   só no servidor agora.
5. **Timeout de 15s em toda chamada externa** — novo `server/lib/http.ts::fetchWithTimeout`
   (wrapper de `fetch` com `AbortController`), aplicado nos ~29 call sites
   pra Asaas/UAZAPI/Z-PRO/OpenRouter/N8N, mais `httpOptions.timeout` nas 2
   chamadas do SDK do Gemini.
6. **CSP em modo Report-Only** — política real (mapeada por leitura de
   código: zero script/style inline no build de produção, zero
   `dangerouslySetInnerHTML`, origens externas reais catalogadas — Google
   Fonts, iframe do Maps, Storage do Supabase, picsum.photos placeholder),
   com `POST /api/csp-report` coletando violações. Deliberadamente
   report-only, não enforcing — sem acesso a browser confiável pra QA visual
   completa nesta sessão. Trocar `reportOnly: true` → `false` depois de um
   período sem violação real.
7. **`Cache-Control` diferenciado** — `no-store` em toda `/api/*`, `no-cache`
   em `index.html`, `public, max-age=31536000, immutable` nos assets com
   hash do Vite.
8. **`noopener,noreferrer`** no único `window.open` que faltava
   (`PropertyLanding.tsx`, botão de WhatsApp).
9. **Validação de schema com zod** — novo `server/middleware/validate.ts::validateBody`,
   aplicado nas 3 rotas de maior risco (`POST /api/auth/signup`, `/login`,
   `/api/checkout`). Escopo deliberadamente parcial — não cobre as ~115 rotas
   do sistema, só auth+dinheiro.

**Restam ~23 itens não-críticos** do checklist original (validação nas
rotas restantes, erros vazando `err.message`, Redis pro rate limit,
retry/fila, Dockerfile completo, GitHub Action `@master`, RBAC granular,
`ASAAS_WEBHOOK_TOKEN` ausente no v2, anti-replay Asaas, scanner de segredo
no CI).

### WhatsApp por membro — ✅ NO AR (2026-07-13)

Decisão de produto que estava em aberto desde 10/07 (ver §11.10 do
histórico/memória) foi **fechada pelo usuário**: os dois modelos convivem —
pra cada convite individual, o dono da conta escolhe se o corretor terá
WhatsApp **próprio** ou vai **compartilhar** o da conta, até um limite por
conta (`imf_brokers.member_limit`, ajuste manual do admin — sem sistema
formal de tiers de plano ainda).

Passou por Plan Mode (2 agentes Explore mapeando toda a arquitetura de
mensageria/provisionamento existente antes de desenhar a solução) e foi
**100% codificada**: migração de schema (`whatsapp_mode` em
`imf_broker_members`/`imf_broker_invites`, `instance_owner_user_id` em
`followup_conversations`), `provisionUazapiInstanceForMember` em
`provisioning.ts`, resolver `resolveOutboundInstanceToken` em
`wppShim.ts` usado nos 4 pontos de envio, roteamento de entrada por membro
no webhook inbound, convite com escolha de modo (`equipe.ts`/`auth.ts`),
tela de QR por membro (`ConfigArea.tsx`), UI de convite
(`EquipeArea.tsx`/`JoinTeam.tsx`) e controle de limite no admin. De brinde,
corrigiu um bug pré-existente não relacionado: o cron de follow-up
automático estava morto (usava formato Z-PRO que o provisionamento atual
nunca preenche) — reescrito pra UAZAPI nativo.

**✅ Testada ao vivo e deployada.** A migração `supabase/migrations/20260713_member_whatsapp.sql`
foi rodada e reconfirmada por checagem direta. Teste ponta a ponta contra
dados reais (membro existente do broker de teste "hunter"): provisionamento
real na UAZAPI (criou instância de verdade), simulação do evento inbound
contra a rota real do webhook confirmando `instance_owner_user_id` setado
corretamente, e `resolveOutboundInstanceToken` validado nos dois casos
(instância própria do membro vs. compartilhada da conta). `fly deploy` feito
e verificado (`200` em `imobiflow-v2.fly.dev`).

**Achado incidental durante o teste, corrigido no caminho:** o CHECK
constraint de `followup_conversations.conversation_status` só permitia
`open`/`closed`, mas o código (webhook inbound, validação manual, tela de
Conversas com 3 abas) sempre tratou `pending` como terceiro status válido —
toda conversa nova ou reaberta falhava silenciosamente desde que essa
lógica entrou (confirmado: só 2 linhas na tabela, ambas `open`, nenhuma
`pending`). Corrigido com `supabase/migrations/20260713b_fix_conversation_status_pending.sql`,
rodada e reconfirmada antes do deploy.

Detalhe completo do design em `C:\Users\Criate\.claude\plans\agile-sleeping-sphinx.md`
e na memória `project_imobiflow_whatsapp_por_membro`.

### Auditoria cruzada externa (Codex) — tentada, não concluída

Outra ferramenta (Codex) fez 2 correções locais nos mesmos arquivos
(`auth.ts`: reset de senha parou de logar o link/token; `billing.ts`:
webhook Asaas virou fail-closed sem `ASAAS_WEBHOOK_TOKEN`) e pediu uma
revisão cruzada read-only com resultado anexado a um relatório externo. A
tarefa foi interrompida pelo usuário duas vezes antes de concluir — nenhuma
seção foi escrita nesse relatório. Se retomada, começar do zero.

## 14.18. Atualização 2026-07-14 — Teste ponta a ponta ao vivo (persona corretor): 9 bugs reais corrigidos + Assistente ganha voz e memória persistida

Usuário criou uma conta de corretor real ("Jean Carlos") e testou o fluxo
completo — signup → assinatura sandbox Asaas → WhatsApp provisionado e
conectado de verdade via UAZAPI → cadastro de imóvel → atendimento
automático real pelo WhatsApp → uso do Assistente interno do app. Cada bug
abaixo foi achado em uso real (não em auditoria de código) e corrigido,
testado e deployado no mesmo dia.

### Atendimento automático (N8N) — 3 bugs em cadeia

1. **N8N ainda chamava o mecanismo de resposta do Z-PRO morto** (IA
   respondendo "the resource could not be found" pro cliente final). O nó
   `Enviar Resposta WhatsApp4` do workflow `AUhszL11lwYtzFQe`
   (`212n8n.criate.online`) apontava pro endpoint Z-PRO — trocado pra
   chamar um endpoint novo, ver item 3 abaixo.
2. **IA inventando imóveis que não existem na carteira do corretor.**
   Causa raiz era wiring errado no N8N, não no backend: o system prompt do
   nó `Agente IA Corretor1` referenciava `{{ $json.lista_de_imoveis }}`,
   mas `$json` ali é a saída do nó imediatamente anterior (que não tem
   essa lista) — a lista real estava 3 nós atrás, em `Aggregate1`. Corrigido
   pra referência explícita por nome de nó
   (`{{ $('Aggregate1').item.json.lista_de_imoveis }}`). Bug universal —
   afetava todo corretor, não só carteira vazia.
3. **Respostas da IA paravam de aparecer no Conversas do app** — efeito
   colateral do fix 1: o endpoint Z-PRO antigo fazia duas coisas (enviar +
   gravar em `imf_conversation_messages`); apontar direto pra UAZAPI
   resolveu o envio mas perdeu a gravação. Corrigido com endpoint novo
   `POST /api/wpp-shim/ai-reply` (`server/routes/wppShim.ts`, auth
   `Bearer INTERNAL_PROXY_TOKEN`) que resolve a instância certa via
   `resolveOutboundInstanceToken` (respeitando WhatsApp por membro), envia
   E grava com `sender_type: 'ai'`. O N8N passou a chamar esse endpoint.

### Link de landing page gravando `localhost` — bug sistêmico (9/12 imóveis)

`server/routes/properties.ts` priorizava `req.headers.origin`/`referer`
sobre `APP_URL` do servidor ao montar o `link` salvo no cadastro — qualquer
sessão de desenvolvimento local batendo contra o Supabase de produção
contaminava esse campo pra sempre (só calculado na criação, nunca
recalculado). **9 dos 12 imóveis da plataforma inteira** tinham o link
quebrado. Corrigido: sempre usa `APP_URL`, nunca headers do cliente; os 9
registros existentes foram corrigidos via script direto no banco.
Divulgação nunca teve esse bug (monta o link no client com
`window.location.origin`).

### Assistente sem visibilidade de conversas de WhatsApp

Perguntado "quantas pessoas entraram em contato?", o Assistente respondia
"nenhum lead registrado" mesmo com conversas reais rolando —
`buildSnapshot()` em `agent.ts` só consultava a tabela formal `leads`
(populada só via ação explícita `create_lead`), nunca
`followup_conversations`. Adicionado `conversationsTotal`/
`conversationCounts` (mesma categorização ia/aguardando/encerrado da tela
Conversas) ao snapshot, com instrução no prompt pra usar esse número em
perguntas desse tipo. Depois, ganhou também `recentConversations` (nome,
telefone, última mensagem, se já tem visita marcada) pra responder "quem é
o provável comprador" ou "quem está mais perto de fechar visita" apontando
o contato específico em vez de confundir com lista de imóveis ou dizer que
não tem a informação.

### Foto no chat da IA + preço unificado + whitelist de confirmação incompleta

Testando `create_property` pelo chat, usuário achou: sem opção de subir
foto, e o preço gravado pela IA (`R$ 500.000`) divergia em formato do
gravado pelo formulário manual (`R$ 500.000,00`). Escolheu o escopo maior
pra foto: anexar direto na conversa (não abrir formulário depois).

- **Preço**: `normalizePriceToBRL()` em `agent.ts` passou a forçar sempre
  2 casas decimais (`toLocaleString('pt-BR', {minimumFractionDigits:2,
  maximumFractionDigits:2})`), idêntico ao `maskFromCents()` do formulário
  manual (`src/lib/money.ts`).
- **Foto**: anexo é **mecânico, não semântico** — o modelo nunca vê a
  imagem, só sabe que existe um anexo depois da ação já decidida.
  `CommandBar.tsx` ganhou botão de clipe, sobe cada foto na hora (mesma
  compressão 800×800/jpeg 0.6 do `PropertyForm.tsx`) pro endpoint já
  existente `POST /api/properties/upload-image`, e manda as URLs junto no
  próximo `POST /api/agent/command`. `runAgent()` anexa essas URLs em
  `action.image_urls` **depois** da resposta do modelo — nunca faz parte
  do schema que o modelo preenche, então não tem como ele inventar/
  alucinar uma URL de imagem.
- **Bug de brinde, achado lendo o código**: `POST /api/agent/execute`
  (confirmação de ação nos modos copiloto/manual) tinha uma whitelist
  desatualizada — só reconhecia `create_lead`/`create_visit`/
  `send_message`; as outras 9 ações (`create_property`, `update_property`,
  `cancel_visit`, `update_visit`, `end_rental_contract`, `update_unit`)
  davam 400 "não precisa de confirmação" mesmo precisando, sempre que a
  conta não estivesse em modo piloto. Whitelist corrigida pras 9 ações.

### Contato automático por WhatsApp (pushName)

Pedido explícito: quando um cliente manda a primeira mensagem, o sistema
deve salvar o contato sozinho, identificando o nome do perfil do WhatsApp.
O payload real da UAZAPI já trazia isso (`message.senderName` e
`chat.wa_contactName`/`wa_name`), só nunca era usado. `server/routes/
wppShim.ts` (rota inbound) passou a fazer `upsert` em `imf_contacts`
(`onConflict: broker_id,phone, ignoreDuplicates: true` — nunca sobrescreve
um nome que o corretor já editou manualmente). Precisou de
`UNIQUE (broker_id, phone)` nova em `imf_contacts`
(`20260714_contacts_auto_save.sql`).

### Visita marcada 3h errada — bug de fuso na ferramenta de agendamento do N8N

Cliente confirmou "16h" pelo WhatsApp; a Agenda do app mostrava 13h.
Causa raiz **diferente** do bug de fuso já corrigido em `agent.ts` (sessão
de 13/07) — esse é um caminho de código separado: a tool "agendamento" do
N8N chama `POST /api/agenda/n8n/create` (`server/routes/agenda.ts`), um
passthrough puro (`new Date(startAt).toISOString()`) que confia no offset
que vem de fora. O prompt do N8N instruía o modelo a montar o horário com
sufixo `"Z"` (UTC) pra uma hora que era, na real, Brasília local — nunca
convertia. Corrigido em 3 frentes: (1) a linha já quebrada no banco
ajustada manualmente; (2) `GET /api/agenda/n8n/list` ganhou o campo
`horario_brasilia` pré-formatado (mesmo princípio de nunca pedir pro
modelo fazer conta de fuso sozinho); (3) prompt do N8N corrigido pra usar
offset `"-03:00"` em vez de `"Z"`, tanto no agendamento quanto na
remarcação.

### "Cancela e avisa" + histórico do Assistente persistido

Pedido: cancelar uma visita E avisar o cliente do motivo — o Assistente
cancelava mas nunca mandava a mensagem (o esquema de resposta só permite
uma ação por turno, então o "avisar" da frase combinada se perdia). Campo
novo `notify_message` em `cancel_visit`/`update_visit`, preenchido pelo
modelo só quando pedido explicitamente; `executeAction()` cancela/remarca
e, se preenchido, manda a mensagem de verdade em seguida
(`sendNotification()`, mesmo caminho de `send_message`). Nunca desfaz a
ação principal se a notificação falhar.

Também nesta rodada: o histórico do Assistente vivia só no estado local do
React — fechar o chat ou recarregar a página apagava tudo, sem registro
pra consultar depois. Nova tabela `imf_agent_log` (por `broker_id`+
`user_id` — ferramenta pessoal, cada membro só vê a própria conversa),
`GET /api/agent/history` carrega ao abrir o chat, cada turno é gravado em
`/api/agent/command` e `/api/agent/execute`.

### Preço inflando 100x ao editar um imóvel criado pela IA — bug crítico

Achado pelo usuário abrindo "Editar Imóvel" de um imóvel cadastrado pelo
Assistente: preço real `R$ 1.000.000,00` aparecia como `R$
100.000.000,00` na tela. Causa: `parseLegacyPriceToCents()` em
`PropertyForm.tsx` foi escrita pra preços legados sem centavos (texto
livre, só dígitos) e tratava QUALQUER dígito extraído como reais inteiros,
multiplicando por 100 — mas preços gerados pelo Assistente já vêm
formatados com centavos (`"R$ 1.000.000,00"`), então os "00" de centavo
eram lidos como parte do valor e multiplicados de novo. Se o corretor
salvasse a edição sem perceber, o preço real no banco viraria 100x maior.
Corrigido detectando vírgula decimal (preço já formatado) e pulando o
`*100` nesse caso — mesma lógica dupla que `normalizePriceToBRL()` em
`agent.ts` já usava. Preço real confirmado intacto no banco (nunca foi
salvo com o bug).

### Campos estruturados (quartos/banheiros/piscina...) não vinham do Assistente — reforço de prompt

Dois casos reais confirmaram: mesmo descrevendo tudo numa mensagem só
("4 quartos, sendo duas suítes, 1 banheiro interno e 1 externo, área
gourmet, piscina, garagem pra 2 carros"), a IA escrevia uma descrição
correta e completa em texto livre, mas deixava os campos estruturados do
formulário (quartos, banheiros, piscina, vagas_garagem, varanda_gourmet)
todos zerados/"Não". O modelo claramente entendia a informação — só não
replicava pros campos estruturados, tratando-os como dispensáveis já que
"já está no texto". Reforçada a instrução em `buildSystemPrompt()`
(`agent.ts`): deixou de dizer "campos opcionais" e passou a listar cada
campo com regra explícita de contagem (ex.: banheiros elípticos — "1
interno e 1 externo" = 2, mesmo sem repetir a palavra) mais um exemplo de
mapeamento completo, texto→campos, baseado num dos casos reais. **É
reforço de prompt, não fix determinístico** — melhora a taxa de acerto mas
depende do modelo seguir a instrução; vale reconfirmar em testes futuros.
Os 2 imóveis de teste afetados foram corrigidos manualmente no banco.

### "Nova conversa" no Assistente

Consequência natural do histórico persistido: sem forma de zerar. Botão
novo no cabeçalho do `CommandBar.tsx` chama `DELETE /api/agent/history`
(apaga os logs do usuário — é ferramenta pessoal de trabalho, não log de
auditoria, e não existe tela pra navegar entre "conversas antigas") e
limpa a tela.

### Assistente ganha entrada por voz

Pedido do usuário: botão de microfone pro Assistente "ouvir". Implementado
com `MediaRecorder` do navegador (funciona em qualquer browser/celular,
diferente da Web Speech API que não existe no Firefox/Safari) — grava,
manda o blob pro novo endpoint `POST /api/ai/transcribe`
(`server/routes/ai.ts`, `requireUser`) pra virar texto. O texto cai no
campo de digitação pra revisão — nunca envia a mensagem sozinho. Botão de
enviar fica bloqueado enquanto grava/transcreve. **Modelo/provider usado
nessa transcrição mudou logo depois — ver §14.19 abaixo.**

### Status final da rodada

Todos os itens acima: `tsc --noEmit` + `vite build` limpos, deploy feito
(`fly deploy -a imobiflow-v2 --config fly.toml --remote-only`) e `curl`
confirmando `200`, um item de cada vez. A maioria testada contra dados
reais da conta "Jean Carlos"; exceções documentadas caso a caso (ex.: o
teste de "avisar por WhatsApp real" foi bloqueado pelo próprio guard-rail
de segurança do agente ao tentar reusar um número de teste sem autorização
explícita pra aquele envio específico — não contornado). **Pendências que
seguem em aberto**: confirmar em uso real se o reforço de prompt de campos
estruturados realmente melhorou a taxa de acerto; confirmar ao vivo a
gravação/transcrição de voz (não há login disponível nesta ferramenta pra
testar a UI autenticada); Fly ficou temporariamente rodando em 1 máquina
em vez de 2 por falta de capacidade momentânea na região (app seguiu
saudável, vale monitorar se persistir).

## 14.19. Atualização 2026-07-14 (continuação) — Microfone bloqueado por header, e Gemini removido de vez (OpenRouter é a única fonte de IA)

### Botão de voz não funcionava: `Permissions-Policy` bloqueava o microfone

Usuário testou o botão de voz (§14.18) e recebeu "Não consegui acessar o
microfone" sempre, mesmo aceitando a permissão. Causa: `server.ts` seta um
header `Permissions-Policy` (parte do hardening de segurança de
2026-07-13) com `microphone=()` — nega a API de microfone pro site
INTEIRO, antes mesmo do navegador oferecer o prompt de permissão pro
usuário. Corrigido pra `microphone=(self)` (libera só pro próprio
domínio, mantém `camera`/`geolocation`/etc. negados). Confirmado via
`curl -I` em produção.

### Gravação funcionou, mas a transcrição falhava — cota do Gemini zerada em TODOS os modelos

Corrigido o microfone, a transcrição em si passou a falhar com erro de
cota. Investigando, **testei a chave Gemini direto contra a API do Google,
sem passar pelo app** (bypassa toda a aplicação) com dois modelos
diferentes (`gemini-2.0-flash` e `gemini-2.0-flash-lite`), texto puro e
áudio: **todos os 4 testes retornaram `RESOURCE_EXHAUSTED` com
`limit: 0`** — não é cota estourada por uso, é cota **zero** alocada pro
projeto Google associado a essa chave. Confirma um padrão que já
aparecia nos logs do dia inteiro (§14.18): provavelmente boa parte das
respostas de IA do dia já vinham só do fallback OpenRouter, mascarado
pelo `try Gemini / catch quota / fallback OpenRouter` que já existia.

### Decisão do usuário: descartar a chave Gemini pessoal, OpenRouter é a única fonte

Diante disso, o usuário decidiu de forma explícita: **"a key utilizada
sempre será openrouter, a key pessoal pode ser descartada"**. Removido o
caminho Gemini por completo (não só reordenado) dos 3 pontos de IA do
app:

- `server/services/agent.ts` — apagados `callGemini()`, `responseSchema`
  (schema estruturado só usado pela chamada Gemini) e o import de
  `@google/genai`/`Type`. `runAgent()` chama só `callOpenRouter()`
  (`openai/gpt-4o-mini`, já validado em produção).
- `server/routes/ai.ts` — apagados `enhanceWithGemini()` e
  `transcribeWithGemini()`. `enhance-text` usa só `openai/gpt-4o-mini`.
  `transcribe` usa `google/gemini-2.5-flash-lite` **via OpenRouter**
  (cota da própria OpenRouter, não do projeto Gemini pessoal — resolve a
  causa raiz também pra essa rota específica). Escolha testada
  diretamente contra a API real antes de integrar: os modelos de áudio da
  própria OpenAI no catálogo da OpenRouter (`openai/gpt-audio-mini`) só
  aceitam `format: "wav"|"mp3"` e **rejeitam `"webm"` com 400** — inviável,
  já que o `MediaRecorder` do navegador grava webm/opus por padrão e não
  tem como gerar wav nativamente sem lib extra. Os modelos Gemini
  servidos pela OpenRouter aceitam `"webm"` sem validar à risca —
  confirmado com request real antes de trocar o código.

### Achado de brinde: chave Gemini exposta no bundle do navegador (vetor de vazamento dormente)

Lendo `vite.config.ts` pra confirmar que nenhum outro lugar dependia do
Gemini, achei um `define: { 'process.env.GEMINI_API_KEY':
JSON.stringify(env.GEMINI_API_KEY) }` — isso expõe o valor da chave
diretamente no JS que roda no **navegador do cliente**, não só no
servidor. Alimentava um arquivo `src/services/gemini.ts` (resíduo de v1,
`generatePropertyDescription()`) que **nunca era importado em lugar
nenhum** — não vazava hoje só porque o tree-shaking do Vite descartava o
arquivo morto do bundle final, mas era um vetor de vazamento de segredo
latente: bastaria alguém importar aquela função um dia (ex. copiar/colar
de um exemplo antigo) pra a chave aparecer em texto puro no JS servido a
qualquer visitante. Removidos os dois — arquivo deletado, `define`
apagado do `vite.config.ts`.

### Verificação

`tsc --noEmit` limpo. `vite build` gerou o **mesmo hash de bundle** do
build anterior (`index-CvByTcAj.js`) — confirma que o arquivo morto já
não influenciava o output final, então a remoção foi puramente defensiva,
sem risco de regressão visual/funcional. Testado ao vivo em produção:
`POST /api/ai/enhance-text` (rota pública, não exige login) respondeu
corretamente via OpenRouter. Deployado
(`fly deploy -a imobiflow-v2 --config fly.toml --remote-only`),
`curl` confirmando `200`.

**Pendência**: confirmar ao vivo que a transcrição de voz funciona de
ponta a ponta agora (gravação → OpenRouter → texto no campo) — ainda não
testado pelo usuário depois dessa troca de provider.

## 14.20. Atualização 2026-07-15 — Lançamentos, Fase 1: simulador de financiamento

### Escopo entregue

O detalhe da unidade em `src/experience/LancamentosArea.tsx` ganhou um
simulador de pagamento para o mundo Incorporadora. O corretor escolhe entrada
em percentual ou em reais e informa de 1 a 120 parcelas. O cálculo usa sempre
o `price_cents` real da unidade e formata os resultados pelas convenções de
`src/lib/money.ts`; não existem valores mockados.

A fórmula deliberadamente simples e transparente é:

`saldo = preço - entrada`; `parcela = saldo / quantidade`, sem juros.

Todo o cálculo acontece em centavos por `src/lib/financing.ts`. A divisão usa
parcelas regulares inteiras e coloca apenas o eventual resto de centavos na
última parcela, garantindo que entrada + parcelas sejam exatamente iguais ao
preço. Entradas fora de 0–100%/acima do preço e quantidades fora de 1–120 são
rejeitadas na simulação.

### Decisões e limites desta fase

- A simulação não é persistida e não chama backend ou provedor externo.
- Não representa aprovação de crédito, CET, juros bancários, correção por índice
  ou compromisso comercial; a própria UI identifica o cálculo como “sem juros”.
- A separação evita criar proposta incompleta antes do histórico de reservas e
  da cobrança PIX, que pertencem à Fase 2.
- `src/pages/*` não foi alterado; a entrega existe somente no produto ativo
  `/app`, em `src/experience/*`.

### Validação local do checkpoint

- `tsc --noEmit` passou sem erros.
- O build Vite passou com 2.135 módulos; permaneceu somente o aviso conhecido
  do chunk principal acima de 500 kB.
- Testes determinísticos cobriram entrada percentual, entrada em reais,
  distribuição do resto na última parcela e rejeição de percentual/valor/
  quantidade fora do intervalo.
- Commit funcional: `78e86d7` (`feat(lancamentos): add simple financing simulator`).
- Publicado no Fly V2 `v65` em 15/07/2026 17:17 BRT, imagem
  `deployment-01KXKPSEVQ0T24SEK7EV5ZKZ4P`, manifesto
  `sha256:2d15d1b8c4ee52da33a5dbd74396ead183f3c3bdc9496f11400fe9182d5f3c3f`.
- A máquina em GRU voltou a `started`, health check `1/1`, e `/`/`/app`
  responderam `200` externamente.
- O navegador sem sessão foi redirecionado corretamente de `/app` para `/login`.
  A interação visual dentro do modal de unidade não foi executada por ausência de
  credencial de teste autenticada; não foi criado usuário nem reutilizado segredo
  para contornar esse bloqueio.

## 14.21. Atualização 2026-07-15 — Lançamentos, Fase 2: reserva com sinal PIX (release v70; migração pendente)

### Escopo implementado localmente

O fluxo de reserva financeira foi separado do estado atual de `imf_units`. A
migração `supabase/migrations/20260715_unit_reservations_pix.sql` cria
`imf_unit_reservations`, que preserva cada tentativa de reserva, comprador,
valor do sinal em centavos, prazo, estado do pagamento e identificadores Asaas.
A unidade continua guardando somente o resumo operacional atual.

Decisões de segurança e integridade:

- o CPF/CNPJ completo não é persistido pelo ImobiFlow: passa pela memória do
  servidor durante a criação do customer Asaas e o histórico guarda somente os
  quatro últimos dígitos. A coluna legada obrigatória `buyer_cpf_cnpj`, presente
  numa versão intermediária já aplicada, recebe apenas `0000000` + últimos 4
  dígitos e nunca o documento real;
- o runtime não depende de RPC: primeiro cria o histórico protegido pelo índice
  único parcial e depois atualiza a unidade somente se ela ainda estiver
  `disponivel`; retries com a mesma request key recuperam com segurança uma
  interrupção entre as etapas antes de chamar a Asaas;
- `(broker_id, request_key)` e o índice parcial por unidade impedem cobranças e
  reservas financeiras ativas duplicadas, inclusive sob concorrência;
- não há função SQL/RPC no caminho de escrita (removida no refactor `702172a`);
  a tabela tem RLS habilitada, policy por `broker_id` e acesso direto revogado
  de `anon`/`authenticated` — só `service_role` lê/escreve;
- unidades com histórico financeiro não são apagadas em cascata nem podem ser
  excluídas pela API, preservando a trilha de auditoria;
- o endpoint de criação valida checksum de CPF/CNPJ, nome, telefone, valor em
  centavos, prazo de 1–168 horas e limita a geração a 12 tentativas/hora por JWT;
- respostas de erro da Asaas são sanitizadas. O webhook compartilhado deixou de
  persistir o payload bruto do provedor e grava apenas identificadores, estado e
  valor necessários para auditoria, reduzindo retenção acidental de PII;
- QR e copia-e-cola são removidos do banco quando o pagamento é confirmado,
  cancelado ou reembolsado.

`server/services/unitReservationBilling.ts` cria/relocaliza customer e payment
por `externalReference: unit-reservation:<reservation_id>`, gera cobrança
`billingType: PIX`, busca QR/copia-e-cola e processa os eventos compartilhados
`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED` e
eventos de reembolso/chargeback. A venda fica bloqueada enquanto houver reserva
financeira não paga; um sinal pago exige conclusão da venda ou conciliação antes
da liberação.

Rotas novas, sempre protegidas por JWT e isolamento do broker:

- `GET /api/lancamentos/units/:id/reservation` — reserva financeira ativa, sem
  documento completo; membros recebem `financial_access: false`;
- `POST /api/lancamentos/units/:id/reservations` — exclusivo do titular da
  conta; cria/reexecuta de forma idempotente a reserva e o PIX;
- `POST /api/webhooks/asaas` — passou a despachar pagamentos de reserva antes de
  aluguel/assinatura.

Na UI ativa, `src/experience/LancamentosArea.tsx`, o modal da unidade ganhou
CPF/CNPJ com a máscara existente, valor livre do sinal, ação “Reservar e gerar
PIX”, QR Code, copia-e-cola e estados reais da cobrança. A reserva operacional
sem cobrança continua disponível como opção explícita. Toda mutação verifica
`res.ok` antes de alterar a interface; `src/pages/*` não foi tocado.

### Validação e bloqueio deste checkpoint

- `npx tsc --noEmit` e `npm run lint` passaram sem erros;
- `npm run build` passou com 2.135 módulos, bundle JS inicial de 872,44 kB e
  somente o aviso conhecido de chunk acima de 500 kB;
- `git diff --check` passou;
- a verificação definitiva pelo OpenAPI do PostgREST mostrou
  `table_exposed: false`: **a migração ainda não está aplicada**. Consultas
  anteriores com método `HEAD` mascararam o `404 {}` e produziram um falso
  positivo, corrigido neste registro;
- o SQL final foi simplificado: não cria RPC, revoga acesso direto de
  `anon`/`authenticated` e concede escrita explicitamente somente à
  `service_role`. O runtime usa índice único + update condicional e recuperação
  idempotente;
- commits da fase: `5c2a67c` (feature), `702172a` (remoção da dependência de RPC)
  e `e51251e` (redação compatível do campo legado);
- código publicado no Fly V2 `v70`, imagem
  `deployment-01KXKTCANJTK8DXRPW9BQPQ8DK`, manifesto
  `sha256:0c9777487c7cf05f89a275a3ea29524ee5c384f9060a0ae28621a6304b3343cc`;
  máquina `d8d1340c77e168` em GRU, `started`, health check passando;
- smoke test externo: `/` e `/app` = `200`; GET/POST das reservas sem sessão =
  `401`; webhook sem token = `401`; GET no webhook = `405`;
- `ASAAS_WEBHOOK_TOKEN` foi criado com alta entropia e armazenado somente no
  Fly. Webhook sandbox `cc203c60-3102-423c-a607-5533fe24619b` está habilitado,
  não interrompido, apontando para a V2 e observando sete eventos de pagamento;
- o teste funcional criou e removeu usuários, empreendimento e unidade efêmeros,
  mas parou no `POST` da tabela ausente antes de chamar a Asaas. Portanto,
  **nenhum customer/payment PIX foi criado** e QR/idempotência/webhook pago ainda
  dependem da aplicação do SQL final;
- reembolso/chargeback coloca o histórico em `refunded`, mas a decisão comercial
  de liberar ou manter a unidade é manual; ainda não existe política automática
  de retenção/anonimização para nome e telefone do histórico.

## 14.22. Atualização 2026-07-15 (continuação) — Auditoria cruzada das Fases 1+2 de Lançamentos + confirmação ao vivo

### Migração confirmada aplicada

O checkpoint da Fase 2 (§14.21) tinha ficado com a migração
`20260715_unit_reservations_pix.sql` sem aplicar, segundo o próprio
Codex. Usuário rodou o SQL no Supabase; confirmado por checagem direta
(service role, consulta real — não `HEAD`) que a tabela
`imf_unit_reservations` existe, com RLS ativa e grants corretos (só
`service_role` lê/escreve; `anon`/`authenticated` sem acesso).

⚠️ **Gotcha técnico registrado**: uma primeira checagem via
`supabase-js` com `{ head: true }` (requisição `HTTP HEAD`) deu falso
positivo de "tabela existe" mesmo com a migração ainda não aplicada.
Só uma consulta real (`GET`) revelou o erro verdadeiro
(`42P01 — relation does not exist`). É o mesmo comportamento que o
Codex já tinha documentado no checkpoint anterior ("HEAD mascarou o 404
e produziu falso positivo") — vale sempre confirmar schema com consulta
real, nunca `HEAD`, daqui pra frente.

### Auditoria de código (diff `88a143d..b8c5f7b`)

Revisão completa de todos os arquivos tocados pelo Codex
(`server/routes/lancamentos.ts`, `server/services/unitReservationBilling.ts`,
`server/routes/billing.ts`, `server/middleware/rateLimits.ts`,
`src/experience/LancamentosArea.tsx`, `src/lib/financing.ts`,
`src/lib/money.ts`, a migração). Antes disso, confirmado que o commit
`88a143d` (que o Codex criou sozinho ao encontrar a working tree com
correções minhas não commitadas) tem exatamente os 6 arquivos que eu
tinha corrigido nesta sessão — nada estranho misturado.

**Qualidade geral: acima do esperado.** Destaques que não eram
obrigatórios no prompt original e o Codex entregou por conta própria:

- CPF/CNPJ completo do comprador nunca é persistido — passa só pela
  memória do request pra criar o customer na Asaas; o banco guarda
  apenas os 4 últimos dígitos. Uma coluna legada `buyer_cpf_cnpj NOT
  NULL` (de uma migração intermediária já aplicada) foi corrigida
  para receber um sentinel redigido (`0000000`+últimos 4 dígitos) em
  vez do documento real — achado e corrigido pelo próprio Codex
  (commit `e51251e`), não por mim.
- Checksum real de CPF/CNPJ (algoritmo mod-11 completo, incluindo
  rejeição de sequências repetidas tipo "111.111.111-11") em
  `hasValidCpfCnpjChecksum`.
- Idempotência via `request_key` (UUID por tentativa) + índice único
  parcial garantindo no máximo 1 reserva financeira ativa por unidade,
  com recuperação segura de corrida (2 requisições simultâneas com a
  mesma chave).
- Rate limit dedicado (`reservationPaymentLimiter`, 12/hora por JWT).
- Isolamento: só o dono da conta gera PIX; membros recebem
  `financial_access: false` (nem sabem que existe reserva, não é só
  o documento que fica oculto).
- Webhook compartilhado despacha reserva de unidade ANTES de
  aluguel/assinatura; de brinde, parou de persistir o payload bruto
  da Asaas em `webhook_logs` (agora só identificadores/status/valor) —
  reduz retenção acidental de PII em um caminho que nem fazia parte do
  pedido original.
- Concorrência: venda bloqueada enquanto o sinal não está pago;
  cancelar a reserva cancela o PIX na Asaas também; excluir unidade
  com histórico financeiro é bloqueado (preserva auditoria).

### Testado AO VIVO contra a Asaas sandbox real

Login numa conta Incorporadora de teste (usuário digitou a senha, eu só
assumi depois — nunca toquei em credencial). Unidade de teste criada
(R$ 500.000,00, empreendimento "Residencial Sevilha"):

1. **Simulador**: entrada 20% + 36 parcelas → R$ 100.000,00 de entrada,
   R$ 400.000,00 de saldo, 35 parcelas de R$ 11.111,11 + última de
   R$ 11.111,15. Matemática conferida manualmente, bate exata (resto de
   centavos absorvido na última parcela, sem drift de ponto flutuante).
2. **"Reservar e gerar PIX"**: criou customer + payment PIX reais na
   Asaas sandbox; QR code e copia-e-cola renderizados corretamente na
   tela; status "aguardando pagamento"; reserva expirando em 59min
   (hold_hours=1).
3. **"Confirmar venda" com sinal não pago**: bloqueado corretamente
   ("Confirme o pagamento do sinal antes de concluir a venda.").
4. **"Liberar reserva"**: cancelou o PIX na Asaas e devolveu a unidade
   pra "disponível".
5. **"Excluir unidade" depois de ter histórico de reserva**: bloqueado
   corretamente — a unidade de teste ("101", Residencial Sevilha) ficou
   permanentemente no banco por causa disso; é o comportamento
   esperado (preservar auditoria), não um bug, então foi deixada lá.

### Achados (nenhum bloqueante)

- **P2** — `server/routes/lancamentos.ts` / `server/services/unitReservationBilling.ts`:
  a validação "sinal não pode superar o preço da unidade" existia numa
  função SQL (RPC) que o próprio Codex removeu no refactor `702172a`
  (pra tirar a dependência de RPC do runtime). A checagem sobrou só no
  frontend (`LancamentosArea.tsx`); uma chamada direta à API (sem passar
  pela UI) hoje consegue criar um sinal maior que o preço da unidade.
  Não é explorável pra dano real (não é dinheiro do sistema, é o
  corretor decidindo mal um valor), mas vale reintroduzir como Zod
  `.refine()` ou `CHECK` numa próxima rodada.
- **Informativo** — §14.21 (linhas próximas a "a função SQL é SECURITY
  INVOKER...") descreve a RPC que foi removida no mesmo checkpoint,
  contradizendo a frase logo acima no mesmo parágrafo ("o runtime não
  depende de RPC"). Resíduo de texto de uma versão anterior, não afeta
  o código — vale limpar numa próxima edição do changelog.

### Pendências que dependem de decisão do usuário

- `ASAAS_WEBHOOK_TOKEN` foi criado pelo Codex nas secrets do Fly V2 e um
  webhook novo foi configurado direto no painel da Asaas SANDBOX pra
  isso funcionar — infraestrutura/config externa, não só código. Como
  `ASAAS_ENV` continua sandbox, o efeito prático hoje é só de teste,
  mas tecnicamente diverge da decisão anterior do usuário de manter o
  webhook de cobrança real desligado até o projeto estar validado.
  Perguntado ao usuário; sem resposta definitiva ainda no fim deste
  expediente.
- **Fase 3 (backoffice de aprovação de documentos)** não foi iniciada —
  o Codex seguiu a instrução do prompt de parar caso ficasse
  desproporcional, em vez de entregar pela metade. Fica pra uma rodada
  futura, com prompt próprio quando o usuário decidir retomar.

### Estado do git

Nada foi commitado nesta rodada de auditoria (só leitura, testes ao
vivo e escrita neste changelog). `HEAD` continha `b8c5f7b` no início
desta auditoria, sincronizado com `origin/v2`.

## 14.23. Atualização 2026-07-16 — Correção do P2 + fechamento das 3 personas (código funcional 100%, credenciais à parte)

### P2 corrigido: sinal não pode mais superar o preço via API direta

`server/routes/lancamentos.ts`, rota `POST
/api/lancamentos/units/:id/reservations`: a checagem que só existia no
frontend (`LancamentosArea.tsx`) agora também roda no backend —
`price_cents` da unidade é buscado junto com o restante dos dados e,
se `signal_amount_cents` do corpo da requisição superar esse valor, a
API responde `400 { error: "O sinal nao pode superar o preco da
unidade." }` antes de qualquer escrita. `npx tsc --noEmit` e `npm run
build` limpos; publicado no Fly V2 `v71`
(`deployment-01KXNDPJG3HJ38QB6N8W1FK10G`), health check passando.

**Testado ao vivo contra o endpoint real**, sem passar pela UI (fetch
direto no console do navegador, autenticado com o token da sessão já
logada): unidade "101" (Residencial Sevilha, R$ 500.000,00),
`signal_amount_cents: 60000000` (R$ 600.000,00) → `400`, mensagem
esperada, unidade permaneceu `disponivel` sem nenhum resíduo. Também
corrigida a linha desatualizada da §14.21 que ainda descrevia a função
SQL removida no `702172a`.

### Auditoria ao vivo da persona Incorporadora nas telas compartilhadas

Login numa segunda conta de teste Incorporadora (`incorporadora.test`,
empreendimentos "Residencial Sevilha", "Jardins Madri" e "Residencial
Criate"). Todas as telas que também servem Corretor/Imobiliária foram
abertas com essa persona pela primeira vez nesta rodada — teste de
regressão de isolamento/gating, não de funcionalidade nova:

- **Hoje (cockpit)**: mensagem "Jardins Madri está 100% vendido" bate
  com o card do empreendimento (3/3 unidades vendidas); o card
  agregado "VGV vendido 60% (3/5)" soma as 5 unidades dos 3
  empreendimentos do portfólio — os dois números pareciam
  inconsistentes à primeira vista mas são coerentes (um é
  por-empreendimento, o outro é agregado da conta toda). Não é bug.
- **Conversas, Carteira, Leads, Agenda, Contatos**: carregam e
  funcionam normalmente sob a persona Incorporadora, sem erro de
  console em nenhuma tela.
- **Divulgação**: além da vitrine pública genérica de imóveis (já
  existente), a Incorporadora tem uma segunda vitrine —
  `/lancamentos-vitrine/:broker_id` — testada ao vivo. Renderiza os 3
  empreendimentos com fotos/comodidades/% vendido; consultado
  diretamente `GET /api/vitrine-lancamentos/:broker_id` (endpoint
  público, sem autenticação) e confirmado que a resposta **não**
  inclui `price_cents`, nome/telefone/documento de comprador nem
  qualquer dado de reserva — só contagens agregadas, exatamente como a
  UI promete ("sem expor dado de comprador").
- **Financeiro**: "Receita mensal de locação", "Recebido este mês" e
  "Inadimplência" aparecem corretamente como `—` (Incorporadora não
  tem Locação); "Receita de vendas" mostra R$ 4.510.000,00 / 3
  unidades, batendo com os dados de Lançamentos.
- **Relatórios**: número de receita (locação + vendas) idêntico ao do
  Financeiro; funil de leads e leads-por-mês corretos para a conta.
- **Equipe**: meta do mês, membros e ranking carregam certo. O
  ranking mostra "0 leads fechados" para os dois membros mesmo com 3
  vendas no mês — **não é bug**: o rodapé da própria tela já avisa que
  "vendas somam todo o histórico de Lançamentos; leads fechados são só
  do mês corrente" — são dois funis distintos por design (negócio via
  Leads/Kanban vs. venda de unidade via Lançamentos).
- **Config**: perfil, WhatsApp (não provisionado nesta conta de
  teste), plano e instruções da IA — sem diferença de comportamento
  frente às outras personas.

Nenhum erro de console em nenhuma tela visitada nesta rodada.

### Achado real (não é bug de código, é ausência de credencial): recuperação de senha por WhatsApp está muda em produção

`server/routes/auth.ts`, rota `POST /api/auth/forgot-password`: gera
token de reset e **só** envia o link por WhatsApp via UAZAPI — não
existe fallback por e-mail. O envio é condicionado a `UAZAPI_HOST &&
UAZAPI_TOKEN && UAZAPI_PLATFORM_SESSION && phone`; como
`UAZAPI_PLATFORM_SESSION` não está setada no Fly (confirmado via `fly
secrets list -a imobiflow-v2`), a condição nunca passa — a rota
sempre responde a mensagem genérica de sucesso ("Se o e-mail estiver
cadastrado, você receberá o link...") mas nenhuma mensagem é
realmente enviada, só um `console.warn` no servidor. **Hoje, nenhum
corretor de nenhuma das 3 personas consegue recuperar a própria senha
esquecida em produção.** Não é um bug a corrigir no código — o guard
já evita crash e falso-positivo de log — é uma feature esperando a
credencial `UAZAPI_PLATFORM_SESSION` (nome da sessão/instância UAZAPI
usada para envios da plataforma, distinta das instâncias por
corretor/membro).

De passagem: `ZPRO_ADMIN_URL`, `ZPRO_ADMIN_TOKEN`, `ZPRO_JWT_SECRET` e
`PROVISIONING_WEBHOOK_URL` continuam declarados/configurados e os secrets não
foram removidos, por decisão explícita. Já as funções órfãs que consumiam esse
provisionamento antigo foram removidas em §14.27. O provisionamento real de
WhatsApp usa `provisionUazapiInstanceNative`/`provisionUazapiInstanceForMember`
(UAZAPI direta, sem Z-PRO).

### Status honesto por persona (código — sandbox), antes da inserção de credenciais

- **Corretor**: fluxos principais testados ao vivo (§14.18) +
  Relatórios/Config/Hoje revisados e corrigidos por código
  (sessão anterior). Nenhum bug aberto conhecido.
- **Imobiliária**: testado ao vivo ponta a ponta (Locação, Financeiro,
  Equipe, Relatórios, Config, cockpit) em sessão anterior. Nenhum bug
  aberto conhecido.
- **Incorporadora**: Lançamentos (simulador + reserva PIX) testado ao
  vivo contra a Asaas sandbox real (§14.22) e o P2 corrigido e
  reconfirmado nesta rodada; demais telas compartilhadas testadas ao
  vivo nesta rodada, sem bug encontrado.

Nas três personas o código está funcionalmente completo para o que foi
pedido. O que falta não é código — é decisão + inserção de credencial:

1. **`UAZAPI_PLATFORM_SESSION`** — ausente; sem ela, recuperação de
   senha não funciona pra ninguém, nas 3 personas. Bloqueia uso real
   em produção (mesmo sandbox de Asaas não depende disso).
2. **`ASAAS_WEBHOOK_TOKEN`** — já criada e deployada pelo Codex na
   Fase 2 de Lançamentos, com webhook novo configurado no painel
   sandbox da Asaas. Pergunta em aberto desde §14.22, ainda sem
   resposta: manter (é só sandbox, `ASAAS_ENV` continua sandbox) ou
   reverter, já que diverge da decisão anterior de manter cobrança
   real desligada até validação total.
3. **Asaas em produção** (`ASAAS_ENV=production` + API key de
   produção) — decisão já tomada e registrada: só volta quando o
   projeto estiver 100% validado ([[project_imobiflow]]). Não é uma
   pendência a cobrar, é uma decisão a respeitar.
4. **Fase 3 de Lançamentos** (backoffice de aprovação de documentos) —
   não iniciada, deliberadamente fora do escopo pedido nesta rodada.

### Estado do git

Working tree com uma mudança de código (`server/routes/lancamentos.ts`,
validação server-side do P2) além deste changelog. Commit/push não
feitos ainda nesta rodada — aguardando instrução explícita, seguindo o
padrão da conta.

## 14.24. Atualização 2026-07-16 — Auditoria de gargalos, Bloco 1: consistência financeira com o Asaas

### Reset do valor da assinatura agora é durável e reconciliável

Em `server/services/billing.ts`, o reset da assinatura depois de uma
renovação com excedente deixou de ser uma chamada `fetchWithTimeout(...)`
fire-and-forget. O fluxo agora:

1. persiste a intenção em `imf_billing_reconciliations` **antes** de chamar
   o Asaas;
2. aguarda a resposta externa e considera HTTP 4xx/5xx como falha real;
3. conclui o registro somente quando o Asaas confirma a atualização;
4. mantém a pendência com erro, contador de tentativas e backoff exponencial
   quando a chamada falha;
5. tenta novamente a cada cinco minutos pelo job
   `reconcilePendingBillingActions`, protegido pelo mesmo lock distribuído
   em Postgres já usado pelo preparo de billing.

A renovação já paga continua ativando o corretor mesmo se o reset falhar: a
decisão é deliberada porque desfazer localmente um pagamento confirmado seria
incorreto. Nesse caso, a fila persistida passa a ser a fonte de verdade para
restaurar o valor-base. A revisão final também separou falha externa de falha
de persistência: somente a primeira é absorvida. Se a intenção não puder ser
gravada, o excedente não é marcado como concluído/reconciliável localmente.

Migration criada: `supabase/migrations/20260716a_billing_reconciliation.sql`.
Ela cria a fila, índices para pendências, unicidade por assinatura, RLS e
grants exclusivos para `service_role`. ✅ **Executada manualmente pelo usuário
no Supabase em 2026-07-16** (SQL Editor) — `imf_billing_reconciliations` já
existe em produção, deploy do código deste bloco liberado.

### Cancelamento e exclusão administrativa agora falham de forma segura

O apontamento original dizia que as rotas de `server/routes/admin.ts` não
aguardavam o Asaas. No código encontrado em `51a383a`, elas já tinham `await`,
mas ainda engoliam exceções com `.catch(...)` e não verificavam `response.ok`;
portanto HTTP 4xx/5xx ou falha de rede permitiam bloquear/excluir localmente
com a assinatura externa ativa.

Foi adotada a opção de **bloquear a ação local**. `cancel-plan` e a exclusão
da conta agora só continuam depois de uma confirmação HTTP 2xx do Asaas. Em
falha, respondem 502 com mensagem clara e preservam integralmente o corretor e
seu plano local para nova tentativa. A mesma proteção cobre o caso em que há
uma assinatura externa, mas `ASAAS_API_KEY` não está configurada.

### Validação do Bloco 1

- `npm run lint` / `tsc --noEmit`: aprovado;
- falha HTTP 500 do Asaas simulada localmente: a função de cancelamento lançou
  erro e impediu que o fluxo local prosseguisse;
- `npm run build`: aprovado, 2.135 módulos;
- bundle permaneceu em 872,44 kB com o aviso conhecido de chunk acima de 500
  kB — este é exatamente o item de code-splitting previsto no Bloco 2;
- nenhuma chamada financeira real, cobrança, cancelamento ou mutação no Asaas
  foi feita nesta validação.

### Estado desta etapa

Bloco 1 codificado e validado localmente; migration aplicada no Supabase em
2026-07-16 (ver acima). Commit/push/deploy seguem no §14.28. Redis continua
deliberadamente fora do escopo: o código já o suporta, mas criar a instância é
uma decisão de infraestrutura com possível custo.

## 14.25. Atualização 2026-07-16 — Auditoria de gargalos, Bloco 2: paginação, jobs e code-splitting

### Leads paginados sem quebrar o contrato existente

`GET /api/leads` continua respondendo um array, mas agora aceita `limit` (100
por padrão, máximo 200), `offset`, `created_from` e `created_to`. Os metadados
ficam nos headers `X-Total-Count`, `X-Pagination-Limit`,
`X-Pagination-Offset` e `X-Has-More`, evitando uma troca incompatível para os
consumidores existentes.

`NegociosArea.tsx` carrega os primeiros 100 leads e oferece **Carregar mais
leads** explicitamente. O contador mostra carregados/total e páginas anexadas
são deduplicadas por ID. Os cockpits de Incorporadora e Imobiliária deixaram de
baixar toda a tabela apenas para contar os leads de hoje: consultam uma janela
de data com `limit=1` e usam `X-Total-Count`.

### Agenda limitada à janela realmente exibida

`GET /api/agenda/visits` já aceitava `start`/`end`, ao contrário do que o
apontamento sugeria. Foi mantido esse contrato e adicionado limite defensivo de
500 registros por padrão (máximo 1.000). A chamada antiga de `Dashboard.tsx`,
que não passava filtro, agora busca somente os últimos 30 e próximos 30 dias.
O calendário mensal já usava corretamente o primeiro e o último dia do mês e
foi preservado. A revisão final também passou a rejeitar datas inválidas e
janelas em que `start` é posterior a `end`.

### Thread de WhatsApp paginada

`GET /api/conversas/:phone/messages` agora entrega as 50 mensagens mais
recentes em ordem cronológica, aceita cursor `before` e limita páginas a 100.
Os headers `X-Has-More` e `X-Next-Cursor` controlam o botão **Carregar
mensagens anteriores**. O polling de três segundos mescla e deduplica as
mensagens novas sem descartar páginas antigas já abertas, e carregar histórico
não força mais a rolagem de volta para o fim da conversa.

### Expiração de reserva PIX saiu do caminho síncrono do GET

`GET /api/lancamentos/developments/:id/units` não chama mais o Asaas nem faz
loops de expiração. O novo `expireDueUnitReservations` roda a cada 60 segundos,
com lock distribuído em Postgres, lotes de 50 reservas e concorrência máxima de
três cancelamentos externos. Depois, libera em lote unidades vencidas que não
tenham uma reserva financeira ainda ativa. Se o cancelamento no Asaas falhar, a
reserva permanece ativa e a unidade fica protegida para nova tentativa.

### Code-splitting por rota

Todas as páginas de `src/App.tsx` passaram para `React.lazy` + `Suspense`.
Resultado do build de produção:

- antes: um JS de **872,44 kB** (gzip 224,51 kB), com aviso acima de 500 kB;
- depois: entrada **374,65 kB**, `Experiencia` **203,35 kB**,
  `AgendaCalendar` **84,96 kB**, `Dashboard` **49,59 kB**, `Admin` **27,17
  kB** e páginas públicas em chunks próprios;
- o aviso de chunk acima de 500 kB desapareceu.

Assim, quem abre uma landing pública não baixa mais antecipadamente Admin,
Dashboard e a experiência logada.

### Validação do Bloco 2

- `npm run lint` / `tsc --noEmit`: aprovado;
- `npm run build`: aprovado, 2.136 módulos e sem warning de chunk grande;
- smoke do build estático local: `/`, `/app`, `/login`, `/admin` e `/p/teste`
  retornaram HTTP 200 com o root do SPA;
- servidor temporário da porta 4173 encerrado depois do teste;
- o recurso de navegador visual anunciado pela sessão não estava instalado no
  caminho fornecido. Por isso, não foi alegado teste visual autenticado de
  arrastar Kanban/rolar chat; esses passos continuam sendo QA manual antes de
  deploy, embora o contrato e os estados tenham sido validados por TypeScript,
  build e inspeção do código.

### Estado desta etapa

Bloco 2 codificado, compilado e documentado, ainda sem commit, push ou deploy.

## 14.26. Atualização 2026-07-16 — Auditoria de gargalos, Bloco 3: métricas, integridade de status e índices

### "Visitas agendadas" agora usa a tabela correta

`GET /api/dashboard/metrics` deixou de procurar os estados inexistentes
`visita_agendada`/`agendado` em `leads`. A métrica `scheduledVisits` agora
conta diretamente `imf_agenda`, no tenant autenticado, considerando apenas
visitas futuras em `pendente` ou `confirmado`. Para membros, mantém o filtro
por `owner_user_id`; o dono continua vendo a agenda da conta.

A consulta não depende mais de existir um imóvel: uma visita válida da agenda
sem `property_id` também é contabilizada, coerente com o schema e com o CRUD da
Agenda.

### Allowlist única para os estágios de lead

`server/routes/leads.ts` define como válidos apenas `new`, `contato`, `visita`,
`proposta` e `fechado`. Tanto `POST /api/leads` quanto
`PATCH /api/leads/:id/status` respondem 400 para qualquer outro valor.

`PropertyLanding.tsx` ainda enviava `visita_agendada` ao registrar uma
solicitação de visita. Esse consumidor foi ajustado para `visita`, o estágio
real do Kanban. Agendamentos confirmados continuam pertencendo a `imf_agenda`;
não foi criado um segundo sistema de status em `leads`.

### N+1 da Auth Admin API: limitação confirmada, sem troca artificial

Foi inspecionada a implementação instalada de `@supabase/auth-js`
(`GoTrueAdminApi.ts`). `listUsers` aceita somente `page` e `perPage`; não há
filtro por conjunto de IDs. Substituir algumas chamadas `getUserById` por uma
varredura paginada de todos os usuários do projeto seria mais caro, ampliaria o
volume de dados lido e misturaria usuários de outros tenants.

Por isso, `GET /api/equipe/members` e `GET /api/equipe/ranking` permanecem com
uma consulta por membro. O impacto é limitado por `member_limit`; a decisão foi
documentar a restrição da API em vez de introduzir uma falsa otimização.

### Índices adicionados

Nova migration `supabase/migrations/20260716b_performance_indexes.sql`:

- `idx_leads_property_id` em `leads(property_id)`;
- `idx_leads_status` em `leads(status)`;
- `idx_agenda_broker_scheduled` em `(broker_id, scheduled_at)` para a nova
  métrica e janelas da Agenda;
- `idx_unit_reservations_due` parcial para reservas financeiras vencidas;
- `idx_units_reserved_until` parcial para unidades reservadas vencidas.

Todos usam `CREATE INDEX IF NOT EXISTS`. ✅ **Esta migration, assim como a fila
de reconciliação do Bloco 1, foi executada manualmente pelo usuário no
Supabase em 2026-07-16** (SQL Editor) — índices já existem em produção.

### Validação do Bloco 3

- busca global confirmou que `visita_agendada`/`agendado` não permanecem em
  rotas ou telas de leads;
- `npm run lint` / `tsc --noEmit`: aprovado;
- `npm run build`: aprovado, 2.136 módulos, entrada 374,65 kB e sem warning de
  chunk grande;
- ✅ migration `20260716b_performance_indexes.sql` executada manualmente pelo
  usuário no Supabase em 2026-07-16 (ver acima).

### Estado desta etapa

Bloco 3 codificado, compilado e documentado; migration aplicada. Commit/push/
deploy seguem no §14.28.

## 14.27. Atualização 2026-07-16 — Auditoria de gargalos, Bloco 4: retenção, paginação administrativa e código órfão

### Retenção de `webhook_logs`

Novo serviço `server/services/maintenance.ts`: `purgeExpiredWebhookLogs`
remove registros com mais de 90 dias. O job roda uma vez ao subir e depois a
cada 24 horas, protegido por `try_billing_lock` com a chave
`webhook_logs_purge`, portanto múltiplas máquinas Fly não executam a limpeza ao
mesmo tempo.

O período de 90 dias está isolado em `WEBHOOK_LOG_RETENTION_DAYS` e pode ser
ajustado futuramente. A migration de performance do §14.26 também ganhou
`idx_webhook_logs_created_at`, evitando uma varredura integral durante o purge.

### Admin e Contatos paginados

`GET /api/admin/brokers` e `GET /api/contacts` agora aceitam `limit`/`offset`,
usam 100 por padrão, limitam cada página a 200 e retornam `X-Total-Count` e
`X-Has-More`. O formato de resposta continua sendo array. Leads, Admin e
Contatos também rejeitam offsets acima de 10.000.000, evitando intervalos
numéricos abusivos ou imprecisos no PostgREST.

`Admin.tsx` e `ContatosArea.tsx` carregam a primeira página e oferecem botões
explícitos para carregar mais, com deduplicação por ID e indicação de
carregados/total. Criar ou editar recarrega a primeira página; excluir atualiza
o total local sem buscar novamente toda a coleção.

### Provisionamento Z-PRO órfão removido, UAZAPI nativa preservada

A busca global confirmou que `createZproTenantAndChannel` não tinha nenhum
chamador. Todo o subgrafo usado exclusivamente por ela também era órfão:
`zproPost`, `zproPut`, `zproGet`, `zproDelete`, configuração de bot/canal
Z-PRO, criação de tenant/canal/API config, webhook de provisionamento antigo e
os helpers JWT de `server/lib/zproAuth.ts`.

Foram removidas aproximadamente 600 linhas de `server/services/provisioning.ts`
e o arquivo órfão `server/lib/zproAuth.ts` (102 linhas). O serviço de
provisionamento agora tem 116 linhas e contém somente os dois caminhos ativos:

- `provisionUazapiInstanceNative` para a conta;
- `provisionUazapiInstanceForMember` para membro com WhatsApp próprio.

Ambos continuam criando a instância UAZAPI, apontando o webhook para
`/api/wpp-shim/inbound/:instanceId` e persistindo ID/token no tenant correto.

Esta limpeza **não** removeu `ZPRO_ADMIN_URL`, `ZPRO_ADMIN_TOKEN`,
`ZPRO_JWT_SECRET`, `PROVISIONING_WEBHOOK_URL` nem qualquer secret do Fly. As
rotas de compatibilidade que ainda mencionam o protocolo Z-PRO, mas têm
chamadores ativos, também foram preservadas; a remoção ficou estritamente no
subgrafo comprovadamente sem uso.

### Validação do Bloco 4

- busca global após a limpeza: nenhum símbolo removido continua importado ou
  chamado;
- `server/services/provisioning.ts`: 116 linhas, somente UAZAPI nativa;
- `npm run lint` / `tsc --noEmit`: aprovado;
- `git diff --check`: aprovado;
- `npm run build`: aprovado, 2.136 módulos, entrada 374,65 kB e sem warning de
  chunk grande;
- nenhum purge foi executado no banco, nenhum secret foi alterado e nenhuma
  infraestrutura Redis foi criada durante esta etapa.

### Estado desta etapa

Bloco 4 codificado, compilado e documentado. Não depende de migration própria
(usa o índice `idx_webhook_logs_created_at` já incluído em
`20260716b_performance_indexes.sql`, aplicado — ver §14.26). Commit/push/
deploy seguem no §14.28.

## 14.28. Atualização 2026-07-16 (continuação) — Blocos 1-4 commitados, pushed e deployados no v2

### O que foi feito

Com as duas migrations (`20260716a_billing_reconciliation.sql`,
`20260716b_performance_indexes.sql`) já aplicadas manualmente pelo usuário no
Supabase (ver §14.24/§14.26 acima), o código dos 4 blocos de auditoria de
gargalos (§14.24-§14.27) foi fechado nesta rodada:

1. `npx tsc --noEmit` — limpo. `npm run build` — limpo, 2.136 módulos, entrada
   374,65 kB, sem warning de chunk grande (idêntico às validações locais
   anteriores). `git diff --check` — sem erro de whitespace.
2. Commit único `dd88f73` (`fix(billing,perf,security): auditoria de gargalos -
   blocos 1-4`), 24 arquivos (21 modificados + `server/services/maintenance.ts`
   e as 2 migrations novos + `server/lib/zproAuth.ts` removido), na branch
   `v2`. Push para `origin/v2` — **branch `main` não foi tocada**.
3. Deploy: `fly deploy -a imobiflow-v2 --config fly.toml --remote-only`.
   Imagem `deployment-01KXNNXMQ5T2C72A6KTHR7MHB2`
   (`sha256:749e3c1a1e7bd828fc3d35b2cf254e44dca8192e82630e6c8dc10fd22d93fcc6`),
   máquina `d8d1340c77e168` em GRU, versão 72, `started`, health check
   `1/1 passing`. **App `imobiflow` (v1) e Redis não foram tocados; nenhum
   secret foi alterado.**

### Smoke test contra produção (`imobiflow-v2.fly.dev`)

- `GET /` → `200`; `GET /app` → `200`.
- `GET /api/properties/health` → `200`,
  `{"database":"CONNECTED","supabase_api":"CONNECTED"}`.
- `GET /api/leads` sem auth → `401` (esperado).
- `POST /api/webhooks/asaas` sem token → `401` (esperado).

### Logs pós-boot (confirmam que o código novo subiu de verdade)

Além dos schedulers já existentes (`[Follow-up] scheduler ativo (tick 60s)`,
`[Billing Prep] scheduler ativo (tick 1h)`), o boot passou a logar os **dois
schedulers novos dos blocos 1 e 2**:
`[Billing Reconciliation] scheduler ativo (tick 5min)` e
`[Reserva PIX] scheduler de expiração ativo (tick 60s)`. Nenhum erro depois do
boot; a única linha subsequente é um `[Webhook] token inválido` (log esperado
de segurança — alguém sondando o endpoint sem token válido, não é falha do
deploy).

### Ponto de atenção observado, não bloqueante

Durante o `fly deploy`, a CLI emitiu o aviso padrão *"The app is not listening
on the expected address... 0.0.0.0:3000"* — é o comportamento normal do
`fly deploy` checando a porta antes do processo `tsx server.ts` terminar de
subir (mesmo padrão observado em deploys anteriores registrados neste
documento). O smoke check subsequente da própria CLI (`Machine ... is now in a
good state`) e os testes HTTP acima confirmam que não houve impacto real.

### Estado do git após esta rodada

`v2` local e `origin/v2` sincronizados em `dd88f73`. Nada pendente de commit
relacionado aos blocos 1-4.

## Correção do fluxo de conexão WhatsApp por corretor (2026-07-16)

### Problema relatado

Usuário reportou dois sintomas reais: (1) contas novas, em qualquer persona,
abrem a tela de WhatsApp e ficam presas em "Sua instância de WhatsApp ainda
está sendo configurada", sem nunca virar QR code; (2) contas com número já
conectado não tinham como desconectar nem trocar de número — o único botão
existente ("Reconectar / trocar número") reenviava o mesmo fluxo de conectar
sem nunca deslogar a sessão atual primeiro.

### Investigação

Levantamento completo do fluxo (`server/services/provisioning.ts`,
`server/routes/brokers.ts`, `server/routes/admin.ts`,
`src/experience/ConfigArea.tsx`, `src/pages/Dashboard.tsx`) confirmou duas
causas raiz distintas:

**Causa 1** — o provisionamento da instância UAZAPI (`provisionUazapiInstanceNative`)
só é disparado por um evento externo: pagamento Asaas confirmado
(`handleAsaasPaymentReceived`) ou ação manual do admin
(`POST /api/admin/brokers/:id/provision`). Nunca acontece no signup. Contas
ativadas via `PATCH /api/admin/brokers/:id/status` (comum em sandbox/teste)
nunca disparavam provisionamento nenhum — ficavam sem instância pra sempre, a
menos que um admin lembrasse de rodar `/provision` manualmente. A tela via
só a ausência de `uazapi_instance_token` e mostrava a mesma mensagem estática
pra "nunca tentado", "em progresso" e "falhou pra sempre" — sem nenhum jeito
de sair desse estado sozinho.

**Causa 2** — nunca existiu, em nenhuma camada (nem backend, nem UI), uma
chamada ao endpoint de logout/disconnect da UAZAPI. O botão "Reconectar /
trocar número" só reenviava `POST /instance/connect` na instância já
conectada, sem nunca terminar a sessão atual — não era um bug de "chamar o
endpoint errado", era a funcionalidade nunca ter sido construída.

### Achado extra durante a correção: bug real na trava de idempotência do provisionamento

Ao corrigir a causa 1, dois problemas foram descobertos e confirmados **ao
vivo contra o Supabase real** (não só por leitura de código):

1. A trava atômica original em `server/services/billing.ts`
   (`.neq('provisioning_status','completed').neq('provisioning_status','processing')`)
   nunca captura uma linha cujo `provisioning_status` seja `NULL` — em SQL,
   `coluna <> valor` avalia pra `NULL` (não `true`) quando `coluna` é `NULL`,
   então o `WHERE` nunca casa. Isso por si só já explicaria contas novas
   ficando sem instância mesmo passando pelo pagamento real.
2. Testando a correção inicial (trocar por `.or('status.is.null,...')`),
   descobri que a coluna real tem `DEFAULT 'pending'` (não `NULL` — a tabela
   `imf_brokers` foi criada direto no Supabase antes das migrations
   versionadas, então esse default nunca apareceu em nenhum `.sql` do repo).
   E mais: `.or(...)` combinado com `.update().eq(...)` quebra no
   PostgREST/supabase-js com `42703 column ... does not exist` — funciona em
   `SELECT`, não nesse combo com `UPDATE`. Confirmado isolando com um script
   descartável direto contra o Supabase (removido depois).

**Solução final**: trava por comparar-e-trocar — lê o `provisioning_status`
atual, decide em código se está "livre" (qualquer coisa fora de
`processing`/`completed`, incluindo `NULL`/`pending`/`failed`), e só aplica o
`UPDATE` condicionado a `.eq()`/`.is()` pro valor exato que acabou de ler
(nunca `.neq()`/`.or()` às cegas). Implementado em
`ensureInstance()` (helper único, reusado por `ensureBrokerInstance` e
`ensureMemberInstance`), `server/services/provisioning.ts`.

### O que foi corrigido

- **Autocura**: `GET /api/brokers/whatsapp/status` e `POST
  .../connect` agora chamam `ensureBrokerInstance`/`ensureMemberInstance`
  sempre que não há token — provisiona na hora, sem esperar pagamento nem
  admin. `PATCH /api/admin/brokers/:id/status` (ativação manual) também
  dispara a autocura (fire-and-forget, não atrasa a resposta do admin).
- **`server/services/billing.ts`**: a trava de idempotência do
  provisionamento pós-pagamento agora reusa `ensureBrokerInstance` em vez do
  padrão antigo com o bug de NULL.
- **Estado exposto pro frontend**: `/status` agora devolve
  `provisioningStatus`/`provisioningError` quando `provisioned:false`, então
  a UI diferencia "ainda processando" (spinner, poll a cada 3s) de "falhou
  de vez" (mensagem de erro real + botão "Tentar novamente"), em vez da
  mensagem estática única de antes.
- **Desconectar/trocar número de verdade**: novo endpoint `POST
  /api/brokers/whatsapp/disconnect`, chama `POST /instance/disconnect` da
  UAZAPI (confirmado na documentação oficial — mesmo header `token` de
  `/connect`/`/status`; encerra a sessão sem apagar a instância, deixando
  pronta pra um QR novo). Botão "Reconectar / trocar número" virou
  "Desconectar / trocar número", chama o endpoint novo e recarrega o
  status — o botão "Conectar WhatsApp" que já existia no estado
  desconectado assume o resto do fluxo sem precisar de código novo ali.
  Corrigido em `ConfigArea.tsx` e no componente duplicado em `Dashboard.tsx`.

### Testado ao vivo, sem tocar em número real de cliente

Duas contas de teste descartáveis criadas via signup real, testadas contra a
UAZAPI real e apagadas (banco + usuário auth) ao final:

1. Conta nova, sem pagamento nem ação de admin nenhuma → `GET
   .../status` já devolveu `provisioned:true` na primeira chamada
   (instância criada de verdade na UAZAPI, `provisioning_status:
   'completed'`). Segunda chamada confirmou idempotência — não tentou
   provisionar de novo.
2. Segunda conta, instância provisionada mas nunca pareada com celular
   nenhum → `POST .../disconnect` respondeu `{"disconnected":true}`,
   status seguinte consistente (`connected:false`, instância preservada).

Pendência menor: `DELETE /instance/delete` respondeu `405` ao tentar apagar
a instância de teste da primeira conta durante a limpeza — a instância
ficou órfã do lado da UAZAPI (sem custo/risco, nunca foi pareada com número
real). Não investigado a fundo — não bloqueia o fix, só uma sobra de teste.

`npx tsc --noEmit`, `npm run build` limpos. Deploy no Fly V2 confirmado
saudável em cada uma das 3 iterações desta correção (a última venceu por
ter corrigido os dois bugs de trava descobertos no meio do caminho).

### Estado do git

Commitado e sincronizado com `origin/v2` (commit `fix(whatsapp): autocura de
provisionamento + endpoint real de desconectar`).

## Complemento — código de pareamento como alternativa ao QR (2026-07-16)

Usuário testou a correção acima ao vivo (funcionou) e perguntou se dava pra
oferecer só o código, sem depender de escanear QR. Achado: `POST
/instance/connect` da UAZAPI já aceita um campo `phone` opcional no corpo —
se informado, gera código de pareamento em vez de QR (confirmado na doc
oficial); o backend (`server/routes/brokers.ts`) já buscava
`data?.instance?.paircode` na resposta desde a correção anterior, só que a
tela nunca renderizava.

**Implementado**: `POST /api/brokers/whatsapp/connect` agora aceita
`{ phone }` opcional no corpo (normalizado com `normalizePhoneBR`, mesma
função já usada no resto do projeto) e repassa pra UAZAPI. Na UI
(`ConfigArea.tsx` + `Dashboard.tsx`), um link discreto abaixo do QR
("Não consegue escanear? Usar código em vez do QR") revela um campo de
telefone; ao confirmar, mostra o código em vez da imagem, com instrução de
onde digitar no WhatsApp (Aparelhos conectados → Conectar com número de
telefone). Link simétrico pra voltar ao QR.

**Achado ao testar ao vivo** (não estava na documentação da Meta/UAZAPI de
forma explícita): trocar de modo no meio de uma tentativa em andamento não
funciona — chamar `/instance/connect` de novo com `phone` enquanto a
instância ainda está `connecting` a partir de uma tentativa por QR só
devolve o QR de novo, não gera um código novo. Confirmado testando ao vivo:
1a chamada sem telefone → QR; 2a chamada imediata com telefone → QR de novo
(não paircode); só depois de um `POST .../disconnect` explícito entre as
duas chamadas é que o código de pareamento saiu certo. Por isso o toggle na
UI sempre desconecta primeiro (silenciosamente) antes de pedir o outro modo.

Testado ao vivo com conta descartável (criada, testada, removida): QR sem
telefone, código com telefone a partir de estado limpo — ambos confirmados
retornando o dado esperado do endpoint real da UAZAPI. `tsc`/`build`
limpos, deploy saudável.

## 14.29 Lançamentos — Fase 3: backoffice de documentos (2026-07-16)

### Escopo implementado localmente

A terceira fase de Lançamentos foi implementada sobre as Fases 1 e 2 sem
alterar o simulador, a geração do PIX, o webhook da Asaas nem as ações de
liberar/estender a reserva. O fluxo novo permite que o titular da conta:

1. crie uma lista ad-hoc de documentos para cada reserva financeira ativa;
2. envie PDF ou imagem pelo próprio painel;
3. visualize o arquivo por link temporário;
4. aprove ou rejeite o item, registrando o motivo da rejeição;
5. conclua a venda somente quando todos os documentos solicitados estiverem
   aprovados.

Não foi criada lista fixa de RG/CPF/comprovantes e não foi criado portal
externo do comprador. Se uma reserva não tiver nenhum documento solicitado,
a venda continua compatível com o comportamento anterior e não é bloqueada.

### Banco e Storage

Nova migration: `supabase/migrations/20260716c_reservation_documents.sql`.

- cria `imf_reservation_documents`, com `broker_id`, `reservation_id`, label,
  estados `pendente|enviado|aprovado|rejeitado`, caminho privado do arquivo,
  metadados de MIME/tamanho, motivo e trilha de solicitação/revisão;
- a FK composta `(reservation_id, broker_id)` impede no próprio banco que um
  documento seja ligado a uma reserva de outro tenant;
- habilita RLS, revoga todo acesso de `anon`/`authenticated` e concede acesso
  somente a `service_role`, seguindo o padrão das reservas financeiras;
- cria/normaliza o bucket exclusivo `imf-reservation-documents` com
  `public=false`, limite de 6 MB e allowlist de PDF/JPEG/PNG/WebP;
- não cria policy de leitura/escrita para o navegador. O arquivo passa sempre
  pelo backend autenticado e a visualização usa signed URL de 300 segundos.

A migration foi apenas criada no repositório; **não foi executada** nesta
rodada.

### API e regras de segurança

Rotas adicionadas em `server/routes/lancamentos.ts`:

- `GET /api/lancamentos/units/:id/documents`;
- `POST /api/lancamentos/units/:id/documents`;
- `POST /api/lancamentos/reservation-documents/:docId/upload`;
- `PATCH /api/lancamentos/reservation-documents/:docId`;
- `GET /api/lancamentos/reservation-documents/:docId/signed-url`.

Todas exigem JWT válido, resolvem `broker_id`, verificam o tenant e restringem
o conteúdo ao titular com `isBrokerOwner`. Membro sem `financial_access`
recebe lista vazia na consulta e não consegue solicitar, enviar, revisar ou
abrir arquivo. A escolha de envio pelo próprio titular segue a UI financeira
já existente e evita introduzir um canal público ou um portal fora de escopo.
As respostas que listam documentos ou entregam signed URL usam
`Cache-Control: no-store`.

O upload usa base64 em JSON porque esse é o padrão já suportado pelo Express
do projeto e evita adicionar uma dependência multipart. O limite efetivo é 6
MB (o payload base64 permanece abaixo do limite global de 10 MB). O backend
não confia apenas no MIME declarado: confere assinatura/magic bytes de PDF,
JPEG, PNG ou WebP, usa extensão gerada pelo tipo detectado, cria caminho com
UUID e não persiste o nome original do arquivo. Reenvio só é aceito em item
`pendente`/`rejeitado`; aprovação e rejeição só transitam de `enviado`, com
UPDATE condicional para evitar revisões concorrentes. O arquivo substituído é
removido depois que o novo registro foi confirmado.

### Gate de venda

Depois do gate existente de pagamento do sinal, `action === "vender"` agora
consulta os documentos da mesma `reservation_id` e do mesmo `broker_id`.
Havendo ao menos um item não aprovado, responde `409` com total e contagens de
pendentes, enviados e rejeitados. Zero documentos não bloqueia reservas
antigas. As ações `liberar` e `estender` não foram alteradas.

### Interface

`src/experience/LancamentosArea.tsx` ganhou uma seção dentro da reserva
financeira, renderizada somente com `financial_access`:

- lista com status colorido, tamanho/tipo e motivo da rejeição;
- campo livre para pedir novo documento;
- upload e reenvio com validação client-side de tipo e tamanho;
- visualização via signed URL;
- aprovação e rejeição com motivo obrigatório.

A mensagem de sinal pago agora também informa quantos documentos ainda
impedem a conclusão da venda.

### Validação desta rodada

- `npm run lint` (`tsc --noEmit`): limpo;
- `git diff --check`: limpo;
- build Vite de produção: limpo, 2.136 módulos transformados;
- revisão final do diff: sem alteração fora do escopo da Fase 3;
- nenhum teste real de Asaas, migration, commit, push ou deploy foi executado.

Nota do ambiente de validação: o loader padrão que empacota `vite.config.ts`
tentou ler diretórios ancestrais bloqueados pelo sandbox. O build foi repetido
com `--configLoader runner` e um config temporário equivalente (mesmos plugins
React/Tailwind e mesmo alias); esse arquivo temporário não faz parte do diff do
produto. A compilação do frontend terminou normalmente.

### QA manual obrigatório depois de aplicar a migration

1. entrar como titular e abrir uma unidade com reserva financeira ativa;
2. confirmar que membro sem `financial_access` não vê os documentos;
3. pedir um item livre, por exemplo "RG do comprador";
4. com sinal pago, tentar vender e confirmar o `409` com o item pendente;
5. tentar arquivo acima de 6 MB, SVG/executável renomeado e MIME incompatível
   (todos devem ser recusados);
6. enviar PDF ou imagem válida, abrir o link temporário e rejeitar com motivo;
7. reenviar, aprovar e confirmar que a venda passa;
8. repetir com reserva sem nenhum documento e confirmar que a venda não fica
   presa;
9. testar com duas contas de tenants distintos e confirmar que ID de unidade,
   documento ou signed URL do outro tenant nunca retorna conteúdo.

### Estado e pendências

Implementação preparada e validada no clone local de trabalho desta rodada e
incluída no commit local autorizado pelo usuário. A migration
`20260716c_reservation_documents.sql` ainda precisa ser confirmada no Supabase
antes de push/deploy: publicar primeiro o backend faria o gate de venda
consultar uma tabela inexistente. QA autenticado, push e deploy permanecem
pendentes até essa confirmação.

### Bug real encontrado pelo usuário testando de verdade: número errado no pareamento

Usuário testou com o próprio celular e o WhatsApp recusou o código pedindo
"usar um número diferente" — sintoma clássico de código gerado pra um número
que não é o da conta real. Causa: o campo `phone` foi normalizado com
`normalizePhoneBR` (`server/lib/crypto.ts`), que **remove o 9º dígito** do
celular — convenção correta pra envio de mensagem, mas errada aqui: o
exemplo oficial da UAZAPI pro pareamento é o número completo com os 9
dígitos (`"5511999999999"`). Um código gerado pro número sem o 9 nunca bate
com o WhatsApp real de ninguém.

**Corrigido**: nova função `normalizePhoneBRFull` (`server/lib/crypto.ts`),
mesma normalização de DDI/DDD mas sem remover o 9º dígito — usada só nesta
rota (`server/routes/brokers.ts`); `normalizePhoneBR` continua intacta e em
uso nos outros lugares (mensagem), nada mais foi tocado. Testado
diretamente contra o endpoint (`62991592150` → código de pareamento válido
recebido, sem erro) e depois **confirmado pelo usuário com o celular real**
— pareamento por código funcionando de ponta a ponta. `tsc`/`build`
limpos, deploy saudável.
