# ImobiFlow

Plataforma B2B SaaS para corretores de imóveis. Cada corretor recebe automaticamente um CRM, landing pages para imóveis e um agente IA no WhatsApp — tudo provisionado em segundos após o pagamento.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 |
| Backend | Node.js + Express + TypeScript (`server.ts` monolítico) |
| Banco de dados | Supabase (PostgreSQL) |
| Autenticação | Supabase Auth |
| Storage | Supabase Storage (fotos de imóveis e perfis) |
| IA — texto | Google Gemini 2.0 Flash Lite |
| IA — agente | OpenRouter (multi-tenant, chave por corretor) |
| Pagamentos | Asaas (checkout + webhooks recorrentes) |
| WhatsApp | Z-PRO (multi-tenant) + UAZAPI (provider) |
| Automação | N8N (agente IA + entrega de credenciais) |
| Deploy | Fly.io — região GRU (São Paulo) |
| Runtime | `tsx` (TypeScript sem etapa de build) |

---

## Arquitetura

```
Corretor
  └─ Signup → Asaas checkout → PAYMENT_CONFIRMED webhook
       └─ imobiflow.fly.dev (Express)
            ├─ Cria tenant isolado no Z-PRO   (POST /tenants)
            ├─ Cria usuário admin no tenant   (POST /userTenants)
            ├─ Cria canal WhatsApp uazapi      (POST /whatsappTenants)
            ├─ Cria API Config com UUID        (POST /api-config)
            ├─ Ativa Bots IA (N8N) no tenant  (PUT /settings/n8n)
            ├─ Salva webhook URL no canal      (PUT /whatsapp/:id)
            └─ Dispara webhook → N8N
                 └─ N8N envia credenciais ao corretor via WhatsApp/e-mail

Corretor recebe login + URL + bearerToken
  └─ Loga no Z-PRO → escaneia QR → WhatsApp conectado → agente IA ativo
```

---

## Funcionalidades

### Para o corretor
- Cadastro com e-mail auto-confirmado (via Supabase Admin API)
- Dashboard responsivo (mobile + desktop) — métricas, gráfico de leads, CRM
- Criação de imóveis com até 15 fotos, campos detalhados e slug único
- Landing page exclusiva por imóvel (`/p/[slug]`) — captura leads sem autenticação
- IA para aprimorar descrições (Gemini 2.0 Flash Lite)
- Perfil profissional completo (bio, foto, citação, métricas de vendas)
- Agenda de visitas agendadas via agente IA
- Recuperação de senha via WhatsApp (link de reset por UAZAPI)

### Para o administrador
- Painel `/admin` com lista de todos os corretores
- Bloquear / ativar corretor manualmente
- Disparar re-provisionamento Z-PRO
- Atualizar credenciais Z-PRO diretamente
- Visualizar status de assinatura Asaas

### Agente IA WhatsApp
- N8N processa mensagens recebidas pelo Z-PRO
- Interpreta intenção do cliente (agendamento, dúvidas, interesse)
- Agenda visitas salvando na tabela `agenda` via API interna
- Responde automaticamente via Z-PRO

### Proxy LLM multi-tenant
- Cada corretor configura sua própria chave OpenRouter
- N8N chama `POST /api/proxy/llm/:brokerPhone/chat/completions`
- Token `INTERNAL_PROXY_TOKEN` protege o endpoint
- Chaves armazenadas com AES-256-GCM no Supabase

---

## Fluxo de Provisionamento (7 passos automáticos)

Disparado automaticamente pelo webhook `PAYMENT_CONFIRMED` do Asaas:

| Passo | Ação | Endpoint Z-PRO |
|---|---|---|
| 1 | Cria tenant isolado | `POST /tenants` |
| 2 | Cria usuário admin no tenant | `POST /userTenants` |
| 3 | Obtém tenant token (forjado localmente) | `forgeTenantJwt()` |
| 4 | Cria canal WhatsApp (uazapi) | `POST /whatsappTenants` |
| 5 | Cria API Config vinculada ao canal | `POST /api-config` |
| 6 | Ativa Bots IA (n8n + n8nAllTickets) | `PUT /settings/:key` |
| 7 | Salva URL do webhook N8N no canal | `PUT /whatsapp/:id` |

Após os 7 passos o webhook de provisionamento é disparado ao N8N com:

```json
{
  "event": "broker_provisioned",
  "broker": { "id", "name", "email", "phone" },
  "zpro_login": { "url", "email", "username", "password" },
  "zpro": {
    "tenant_id", "channel_id", "channel_name", "channel_type",
    "url": "https://appback.../v2/api/external/{uuid}",
    "bearerToken": "..."
  }
}
```

---

## Rotas do Backend

### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/signup` | Cadastro + auto-confirmação + login |
| POST | `/api/auth/login` | Login com e-mail e senha |
| POST | `/api/auth/forgot-password` | Envia link de reset via WhatsApp |
| POST | `/api/auth/reset-password` | Valida token e redefine senha |

### Corretor
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/brokers/me` | Perfil do corretor autenticado |
| POST | `/api/brokers/settings` | Salvar perfil e configurações |
| POST | `/api/brokers/upload-photo` | Upload de foto de perfil |

### Imóveis
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/properties` | Listar imóveis do corretor |
| POST | `/api/properties` | Criar / editar imóvel (upsert) |
| DELETE | `/api/properties/:id` | Excluir imóvel |
| PATCH | `/api/properties/:id/status` | Atualizar status (disponível/vendido/alugado) |
| GET | `/api/properties/:slug` | Dados da landing page (público, sem autenticação) |

### Leads e Agenda
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/leads` | Todos os leads do corretor |
| GET | `/api/leads/recent` | Últimos 5 leads |
| POST | `/api/leads` | Capturar lead via landing page (público) |
| PATCH | `/api/leads/:id/status` | Atualizar status do lead |
| GET | `/api/agenda/visits` | Visitas agendadas (agenda + leads legados) |

### Dashboard e IA
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dashboard/metrics` | Métricas (imóveis, leads, visitas) |
| GET | `/api/dashboard/charts` | Gráfico de leads por mês |
| POST | `/api/ai/enhance-text` | Aprimorar texto com Gemini |

### Pagamentos e WhatsApp
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/checkout` | Criar cobrança Asaas |
| GET | `/api/subscription` | Status da assinatura |
| GET | `/api/whatsapp/status` | Status e QR Code do WhatsApp |
| POST | `/api/whatsapp/send-message` | Enviar mensagem via N8N |

### Webhooks
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/webhooks/asaas` | Webhook Asaas (pagamentos e assinaturas) |
| POST | `/api/webhooks/asaas/test` | Simular webhook Asaas (testes) |

### Admin
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/brokers` | Listar todos os corretores |
| POST | `/api/admin/brokers/:id/block` | Bloquear corretor |
| POST | `/api/admin/brokers/:id/unblock` | Desbloquear corretor |
| POST | `/api/admin/brokers/:id/provision` | Disparar provisionamento Z-PRO |
| PATCH | `/api/admin/brokers/:id/zpro-credentials` | Atualizar credenciais Z-PRO |

### Proxy LLM
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/proxy/llm/:brokerPhone/chat/completions` | Proxy OpenRouter por corretor |

---

## Banco de Dados (Supabase)

### Tabelas

| Tabela | Descrição |
|---|---|
| `brokers` | Perfil, status de assinatura, credenciais Z-PRO e configurações |
| `properties` | Imóveis com slug, fotos (JSON), status e detalhes |
| `leads` | Leads capturados via landing page |
| `agenda` | Visitas agendadas via agente IA N8N |
| `subscriptions` | Histórico de pagamentos Asaas |
| `webhook_logs` | Log completo de todos os webhooks recebidos e disparados |
| `password_reset_tokens` | Tokens de recuperação de senha (TTL 15 min) |

### Campos relevantes em `brokers`

| Campo | Tipo | Descrição |
|---|---|---|
| `status` | text | `pendente` / `ativo` / `inativo` |
| `plan` | text | `mensal` / `anual` |
| `valid_until` | timestamptz | Validade da assinatura |
| `is_admin` | boolean | Acesso ao painel admin |
| `zpro_tenant_id` | text | ID do tenant no Z-PRO |
| `zpro_channel_id` | text | ID do canal WhatsApp no Z-PRO |
| `zpro_password` | text | Senha gerada para login no Z-PRO |
| `zpro_username` | text | Username gerado para o Z-PRO |
| `zpro_user_email` | text | E-mail usado no login Z-PRO |
| `zpro_api_key` | text | Bearer token da API Config |
| `zpro_api_url` | text | URL externa `/v2/api/external/{uuid}` |
| `provisioning_status` | text | Estado do provisionamento |
| `broker_address` | jsonb | Perfil profissional (bio, foto, citação, etc.) |
| `openrouter_api_key_enc` | text | Chave OpenRouter criptografada (AES-256-GCM) |

### Row Level Security (RLS)
- `agenda`, `subscriptions`, `webhook_logs` — RLS habilitado
- Backend usa `service_role` key (bypass RLS)
- Queries do frontend passam exclusivamente pelo Express

---

## Integração Z-PRO — Detalhes Técnicos

### Autenticação
- **Super Admin JWT**: forjado localmente via `forgeSuperAdminJwt()` com `ZPRO_JWT_SECRET`
  - Typo intencional do Z-PRO: campo `usarname` (não `username`)
  - Preferido ao `ZPRO_ADMIN_TOKEN` pois não expira
- **Tenant JWT**: forjado via `forgeTenantJwt(tenantId, userId, email)` para operações por tenant

### Bugs conhecidos do Z-PRO (com workarounds)

| Bug | Sintoma | Fix aplicado |
|---|---|---|
| Status null no cadastro | Login retorna `OUT_RANGE` | Incluir `status: 'active'` no POST /userTenants |
| `restrictedUser` string truthy | Login retorna `OUT_RANGE` | Usar `restrictedUser: false` (boolean) |
| GET /tenants/:id ignora o :id | Retorna o tenant do JWT | Usar GET /tenants e filtrar por id |
| GET /users/:id com super admin | Retorna `ERR_NO_USER_FOUND_8` | Usar tenant JWT para buscar usuários |
| PUT /whatsapp/:id retorna 500 | Dados são salvos mesmo assim | Verificar com GET após o PUT |
| PUT /settings sem tenantId no body | Retorna 500, não salva | Incluir `tenantId` no body |

### Endpoints confirmados

```
POST /tenants                 → cria tenant isolado
POST /userTenants             → cria usuário no tenant (NÃO use POST /users)
POST /whatsappTenants         → cria canal WhatsApp
POST /api-config              → cria API Config com UUID (painel api-service)
PUT  /settings/:key           → configura setting com {key, value, tenantId}
PUT  /whatsapp/:id            → atualiza canal (body mínimo obrigatório)
POST /auth/login              → login do corretor
GET  /tenantApi               → lista APIs simples do tenant
GET  /api-config              → lista API Configs do tenant (com UUID e URL externa)
DELETE /api-config/:uuid      → remove API Config
```

---

## Asaas — Webhooks processados

| Evento | Ação |
|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | Ativa corretor + dispara provisionamento Z-PRO |
| `PAYMENT_OVERDUE` | Marca assinatura como vencida |
| `PAYMENT_DELETED` | Remove pagamento registrado |
| `SUBSCRIPTION_DELETED` / `SUBSCRIPTION_INACTIVATED` | Inativa corretor |

Configurar no Asaas: `https://imobiflow.fly.dev/api/webhooks/asaas`

---

## Segurança

### O que está protegido
- `.env` no `.gitignore` — nunca versionado
- Senhas dos corretores armazenadas pelo Supabase Auth (bcrypt)
- Chaves OpenRouter criptografadas com AES-256-GCM no banco
- `service_role` key usada apenas no backend
- Endpoint admin exige `is_admin: true` via `x-user-id` header

### Aviso de histórico git
Um commit antigo contém o `UAZAPI_TOKEN` hardcoded como fallback. O arquivo atual usa `|| ""` (sem fallback). Se o repositório for público, **rotacione o token UAZAPI**.

### Boas práticas
- Gere `INTERNAL_PROXY_TOKEN` com `openssl rand -hex 24`
- Gere `LLM_PROXY_ENC_KEY` com `openssl rand -hex 32`
- `ZPRO_JWT_SECRET` permite forjar qualquer JWT Z-PRO — proteja com o mesmo cuidado da senha root

---

## Design — Liquid Glass (iOS 26 / macOS Tahoe)

| Elemento | Estilo Tailwind |
|---|---|
| Fundo global | `bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900` |
| Cards / Painéis | `backdrop-blur-xl bg-white/10 border border-white/15` |
| Sidebar desktop | `backdrop-blur-2xl bg-white/8 border-r border-white/12` |
| Header | `backdrop-blur-2xl bg-white/8 border-b border-white/10` |
| Modais | `backdrop-blur-2xl bg-white/12 border border-white/20` |

**Responsividade:** sidebar em drawer no mobile, layout de 2–3 colunas no tablet, sidebar fixa no desktop.

---

## Rodar Localmente

```bash
# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env
# Preencher o .env com os valores reais

# Iniciar (backend Express + frontend Vite juntos na porta 3000)
npm run dev
```

O Vite roda como middleware do Express — não é necessário processo separado.

**Memória:** se o servidor cravar silenciosamente ao processar imagens, use:
```bash
node --max-old-space-size=1024 node_modules/.bin/tsx server.ts
```

---

## Deploy (Fly.io)

```bash
# Primeiro deploy
fly launch

# Re-deploy
fly deploy

# Ver logs em tempo real
fly logs

# Configurar secrets (equivalente ao .env em produção)
fly secrets set ZPRO_JWT_SECRET="..." ASAAS_API_KEY="..." ...
```

App em produção: `https://imobiflow.fly.dev`

---

## Estrutura de Pastas

```
imob.criate/
├── server.ts                    # Backend completo (Express + toda lógica de negócio)
├── src/
│   ├── App.tsx                  # Roteamento + proteção por status de assinatura
│   ├── pages/
│   │   ├── Dashboard.tsx        # CRM principal (responsivo, Liquid Glass)
│   │   ├── Login.tsx
│   │   ├── Signup.tsx
│   │   ├── PaymentPending.tsx   # Tela de checkout Asaas
│   │   ├── PaymentSuccess.tsx   # Confirmação de pagamento
│   │   ├── PropertyLanding.tsx  # Landing page pública do imóvel
│   │   ├── Admin.tsx            # Painel administrativo
│   │   ├── ForgotPassword.tsx   # Recuperação de senha
│   │   ├── ResetPassword.tsx    # Redefinição de senha via token
│   │   └── WhatsAppSetup.tsx    # QR Code e status WhatsApp
│   ├── components/
│   │   ├── PropertyForm.tsx     # Modal de cadastro/edição de imóvel
│   │   ├── MagicWandTextarea.tsx # Campo com IA integrada (Gemini)
│   │   └── AISettings.tsx       # Configurações de IA do corretor
│   └── services/
│       ├── auth.ts              # Gerenciamento de sessão JWT
│       └── gemini.ts
├── .env                         # Variáveis locais (NÃO versionado)
├── .env.example                 # Template de variáveis (versionado)
├── .gitignore
├── fly.toml                     # Configuração Fly.io
└── package.json
```

---

## Variáveis de Ambiente

Veja `.env.example` para a lista completa com descrições. Variáveis obrigatórias em produção:

```
VITE_SUPABASE_URL / SUPABASE_URL
VITE_SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_ANON_KEY
APP_URL
ASAAS_API_KEY + ASAAS_ENV
ZPRO_ADMIN_URL + ZPRO_JWT_SECRET
UAZAPI_TOKEN
PROVISIONING_WEBHOOK_URL
N8N_WEBHOOK_URL
INTERNAL_PROXY_TOKEN
LLM_PROXY_ENC_KEY
```
