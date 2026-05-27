# Criate (ImobiFlow) — Handoff de sessão

Você é um agente de engenharia trabalhando no projeto **Criate** (nome comercial; repo `imob.criate`).
Antes de agir, leia:
- `C:\Users\Criate\imob.criate\DOCUMENTACAO.md` (referência técnica completa)
- `C:\Users\Criate\imob.criate\server.ts` (backend principal, ~2970 linhas)
- `.env` (na pasta do projeto) — segredos como `ZPRO_JWT_SECRET` estão no `.env` da Fly.

---

## 1. O que é o Criate

SaaS B2B para corretores de imóveis brasileiros. Esteira automática:
pagamento no **Asaas** → provisiona atendimento WhatsApp isolado no **Z-PRO** (backend `https://appback.criate.online`, painel corretor `https://app.criate.online`) usando a **UAZAPI** (`https://criate.uazapi.com`) → agente IA (**N8N + OpenRouter**) atende os clientes finais. Follow-up automático reactiva leads silenciosos.

App em produção: `https://imobiflow.fly.dev` (Fly.io, 2 máquinas GRU São Paulo).

---

## 2. Stack / Infra

- **Backend:** Node + Express + TypeScript, `tsx server.ts` (porta 3000). Em prod serve `dist/`.
- **Frontend:** Vite + React 19 + Tailwind — design system "Liquid Glass".
- **Banco/Auth:** Supabase (project `umvbrahsqvqeondwtikm`).
- **Deploy:** `fly deploy --app imobiflow` (a partir de `C:\Users\Criate\imob.criate`).
- **Pagamentos:** Asaas — assinatura mensal recorrente.
- IMPORTANTE local: `tsx --max-old-space-size=1024 server.ts` (OOM com base64). O `.env` LOCAL **não tem** `ZPRO_JWT_SECRET`.

---

## 3. Esteira de provisionamento (8 passos)

1. `POST /tenants` (super admin) → tenant isolado.
2. `POST /userTenants` → usuário admin (`status:'active'`, `restrictedUser:false`).
3. `POST /auth/login` → token do tenant. Fallback: `forgeTenantJwt(tenant, userIdReal, email)`.
4. `POST /whatsappTenants` → canal (`type:uazapi`, DISCONNECTED, `isActive:true`, `uazapiHost`+`uazapiToken`).
4b. UAZAPI: `POST /instance/create` → `{token, instance:{id,token}}`.
   - `PUT /whatsapp/:id {tokenAPI: instanceToken}` (retorna 500 mas persiste).
   - `PUT /whatsapp/:id {wabaId: instanceId}` ← **CAMPO CRÍTICO** (ver §4).
   - `POST /webhook` → webhook UAZAPI→Z-PRO antes de conectar.
5. `POST /api-config` → cria API externa; guarda `zpro_api_key`(UUID), `zpro_api_token`(plainToken), `zpro_api_url`.
6. `PUT /settings/n8n` + `/settings/n8nAllTickets` + `PUT /whatsapp/:id {n8nUrl}` → ativa Bots IA.
7. `provisioning_status = completed` + `fireProvisioningWebhook` entrega credenciais ao corretor.

---

## 4. DESCOBERTAS CRÍTICAS Z-PRO/UAZAPI (não reaprender)

- **`wabaId` = "Number ID (Instance ID)"** no painel Z-PRO = `instance.id` da UAZAPI. Sem ele, o canal nunca ativa ("Não ativado") — o Z-PRO ignora os eventos da UAZAPI porque não consegue casar o evento ao canal.
- **Webhook deve existir ANTES** de conectar o WhatsApp (senão o evento de conexão se perde).
- `PUT /whatsapp/:id` retorna 500 mas persiste — verificar via GET. Fazer PUTs separados (combinado é não-confiável).
- `GET /whatsapp/:id` com super admin → 500 para canal de outro tenant. Usar login real do tenant.
- Forja JWT: `forgeSuperAdminJwt()` (typo "usarname", tenantId:1) e `forgeTenantJwt(tenantId, userId, email)`. Secret em `ZPRO_JWT_SECRET` (UTF-8, não base64).
- Bug OUT_RANGE no `POST /userTenants`: `restrictedUser` deve ser boolean `false`, não string.
- `GET /tenants/:id` ignora o `:id` e retorna sempre o tenant 1 — workaround: `GET /tenants` + filtrar.

---

## 5. Follow-Up Inteligente (IMPLEMENTADO E VALIDADO em produção — 2026-05-27)

Sistema de reativação de leads silenciosos. Config por corretor em **Configurações > Follow-Up IA** (`FollowUpSettings.tsx`).

**Tabelas:**
- `followup_config` — `broker_id`, `enabled`, `delay_minutes_1/2/3`, `message_1/2/3`.
- `followup_conversations` — estado por conversa: `follow_message_index` (0→3), `follow_sent`, `follow_sent_at`, `last_customer_message_at`, `ai_active`, `zpro_ticket_id`, `human_takeover_at`.

**Regras:**
- Máximo 3 follows por ticket. Index **nunca reseta** quando cliente responde — só reseta em `isNewTicket` (ticket_id diferente).
- **Timers independentes:**
  - F1: `last_customer_message_at + delay_minutes_1` (padrão 1440 min = 24h)
  - F2: `follow_sent_at + delay_minutes_2` (padrão 4320 min = 3 dias)
  - F3: `follow_sent_at + delay_minutes_3` (padrão 10080 min = 7 dias)
- Auto-progressão: após F1 enviado, `follow_sent=false` reseta; F2/F3 disparam automaticamente nos seus delays.
- Mensagens vazias são puladas (sem loop infinito).
- Corretor responde manualmente → `human_takeover_at` setado → agente IA pausado (`ai_active=false`).
- Marcador ZWSP (`​`) distingue mensagem do sistema vs. corretor manual (invisível no WhatsApp).

**RPC atômica:** `claim_due_followups()` — atualiza atomicamente, incrementa index, retorna dados para envio.

**Endpoints:** `GET|POST /api/followup/config` · `POST /api/followup/inbound` (N8N, msg cliente) · `POST /api/followup/broker-reply` (N8N, handover humano).

---

## 6. Rate Limiting (IMPLEMENTADO em 2026-05-27, Redis em 2026-05-27)

`express-rate-limit` aplicado em:
- `POST /api/auth/signup|login|forgot-password` → 10 req / 15 min por IP
- `POST /api/checkout` → 5 req / 1 hora por IP
- `POST /api/webhooks/asaas` → 120 req / 1 min por IP

**Rate limiting distribuído (Redis):** código implementado com fallback gracioso.
- Sem `REDIS_URL`: cada VM usa store em memória (comportamento anterior).
- Com `REDIS_URL`: contadores compartilhados entre as 2 VMs Fly via `ioredis`.
- Para ativar: `fly redis create --app imobiflow` → `fly secrets set REDIS_URL=<url>`

---

## 7. Segurança — AÇÃO PENDENTE OBRIGATÓRIA

A `service_role key` do Supabase ficou hardcoded em commits antigos (`check.ts`, `check_schema.ts`, versões antigas do `.env.example`). O histórico git foi **completamente reescrito** com `git-filter-repo` e a chave foi substituída por `SUPABASE_SERVICE_ROLE_KEY_REDACTED`. Force push feito em 2026-05-27.

**⚠️ A chave real DEVE ser rotacionada:**
1. Supabase dashboard → Project Settings → API → regenerar `service_role key`.
2. `fly secrets set SUPABASE_SERVICE_ROLE_KEY="nova_chave" --app imobiflow`

---

## 8. Estado atual (2026-05-27)

### Concluído e em produção
- [x] Esteira completa de provisionamento (8 passos)
- [x] Dashboard corretor (imóveis, leads, agenda, configurações)
- [x] Landing page por corretor `/p/:slug`
- [x] Webhooks Asaas (pagamento, cancelamento, grace period)
- [x] Follow-Up Inteligente com 3 timers independentes — **VALIDADO**
- [x] Tenant 209 (David) — **VALIDADO**
- [x] Rebranding "Criate" (title, favicon, header, sidebar, nav)
- [x] Rate limiting (auth, checkout, webhook) + Redis distribuído (fallback gracioso)
- [x] Termos de Uso e Política de Privacidade completos (LGPD + Marco Civil + Lei do Software)
- [x] Limpeza de credenciais do histórico git
- [x] CI/CD GitHub Actions (`fly deploy` no push para `main`)
- [x] Sentry error tracking (opcional — ativo com `SENTRY_DSN`)
- [x] Verificação de ticket aberto antes de disparar follow-up (via Z-PRO API)
- [x] Bug `ResetPassword.tsx:94` corrigido (`accessToken` → `resetToken`)
- [x] Agenda do tenant: dom-sáb, 07h-19h
- [x] Email simulado de lead removido (contato via WhatsApp)

### Pendente / próximos passos
- [ ] **⚠️ URGENTE:** Rotacionar service_role key do Supabase (ver §7)
- [ ] Páginas legais: preencher constantes no topo de `Termos.tsx` e `Privacidade.tsx` (Razão Social, CNPJ, Endereço, Emails)
- [ ] Ativar Redis distribuído: `fly redis create --app imobiflow` → `fly secrets set REDIS_URL=<url>`
- [ ] Ativar Sentry: criar conta em sentry.io → `fly secrets set SENTRY_DSN=<dsn>`
- [ ] Ativar CI/CD: adicionar `FLY_API_TOKEN` como secret no GitHub (Settings → Secrets → Actions)

---

## 9. Corretores de teste (Supabase)

| Corretor | zpro_tenant_id | zpro_channel_id | Status |
|----------|---------------|----------------|--------|
| Hunter | 208 | 399 | ✅ Ativo |
| Hiago | 202 | 392 | ✅ Ativo |
| David | 209 | — | ✅ Validado |

---

## 10. Convenção API externa Z-PRO (envio de mensagens)

Header: `Authorization: Token {zpro_api_token}` (não `Bearer`).
Body: `{ body, number, externalKey, isClosed:false }`.
URL base: `zpro_api_url` (sem sufixo extra).

---

## Como continuar

1. Confirme se a service_role key já foi rotacionada (§7).
2. Leia `DOCUMENTACAO.md` para detalhes completos de qualquer componente.
3. Para o `server.ts`, leia apenas as seções relevantes (~2970 linhas).
