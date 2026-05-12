# ImobiFlow

Plataforma SaaS para corretores de imóveis com CRM, landing pages automáticas e agente IA no WhatsApp.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 |
| Backend | Node.js + Express + TypeScript (`server.ts`) |
| Banco de dados | Supabase (PostgreSQL) |
| Autenticação | Supabase Auth |
| Storage | Supabase Storage (fotos dos corretores) |
| IA | Google Gemini 2.0 Flash (aprimoramento de descrições) |
| Pagamentos | Stripe (checkout + webhooks) |
| WhatsApp | Z-PRO + UAZapi (criação automática de tenant e canal) |
| E-mail | Nodemailer (SMTP) |
| Runtime | tsx (TypeScript direto, sem build) |

---

## Funcionalidades

### Corretor
- Cadastro com login automático (e-mail auto-confirmado via Supabase Admin API)
- Dashboard com métricas: imóveis, leads ativos, visitas agendadas
- Gráfico de interesse dos últimos 6 meses
- Criação, edição e exclusão de imóveis
- Upload de foto de perfil (Supabase Storage)
- IA para aprimorar descrições de imóveis (Gemini)

### Imóveis
- Cada imóvel gera um `slug` único e uma landing page exclusiva em `/p/[slug]`
- Link salvo no banco (`properties.link`)
- Status: disponível / vendido / alugado

### Leads
- Captura via landing page do imóvel (sem autenticação)
- Visualização no CRM com status editável
- Aba Agenda: filtra leads com status `visita_agendada` ou `agendado`

### Onboarding Automatizado (após pagamento)
1. Corretor se cadastra → status `pendente`
2. Redirecionado para checkout do Stripe
3. Stripe dispara webhook → backend recebe e valida
4. Banco atualizado: `brokers.status = 'ativo'`
5. Pagamento registrado em `subscriptions`
6. Tenant Z-PRO criado via API
7. Canal WhatsApp criado via UAZapi
8. E-mail de boas-vindas enviado com todos os acessos
9. Corretor lê QR Code no app → WhatsApp conectado → agente IA ativo

---

## Rotas do Backend

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/signup` | Cadastro + auto-confirmação + login |
| POST | `/api/auth/login` | Login |
| GET | `/api/brokers/me` | Perfil do corretor |
| POST | `/api/brokers/settings` | Salvar perfil |
| POST | `/api/brokers/upload-photo` | Upload de foto |
| GET | `/api/properties` | Listar imóveis |
| POST | `/api/properties` | Criar / editar imóvel (upsert) |
| DELETE | `/api/properties/:id` | Excluir imóvel |
| PATCH | `/api/properties/:id/status` | Atualizar status do imóvel |
| GET | `/api/properties/:slug` | Dados da landing page (público) |
| GET | `/api/leads` | Todos os leads do corretor |
| GET | `/api/leads/recent` | Últimos 5 leads |
| POST | `/api/leads` | Capturar lead via landing page (público) |
| PATCH | `/api/leads/:id/status` | Atualizar status do lead |
| GET | `/api/agenda/visits` | Visitas agendadas |
| GET | `/api/dashboard/metrics` | Métricas do dashboard |
| GET | `/api/dashboard/charts` | Gráfico de leads por mês |
| POST | `/api/ai/enhance-text` | Aprimorar texto com Gemini |
| POST | `/api/checkout` | Criar sessão Stripe |
| GET | `/api/subscription` | Status da assinatura |
| GET | `/api/whatsapp/status` | Status e QR Code do WhatsApp |
| POST | `/api/webhooks/stripe` | Webhook do Stripe (assinado) |
| POST | `/api/webhooks/stripe/test` | Simular webhook (apenas dev) |
| GET | `/api/properties/health` | Health check do banco |

---

## Banco de Dados (Supabase)

### Tabelas do projeto

| Tabela | Descrição |
|---|---|
| `brokers` | Perfil, status, dados Stripe e Z-PRO do corretor |
| `properties` | Imóveis com slug, link, imagens e status |
| `leads` | Leads capturados via landing page |
| `subscriptions` | Histórico de pagamentos |
| `webhook_logs` | Log de todos os webhooks recebidos |

### Campos relevantes em `brokers`
- `status` — `pendente` / `ativo` / `inativo`
- `stripe_customer_id`, `stripe_subscription_id`, `plan`, `valid_until`
- `zpro_tenant_id`, `zpro_api_key`, `zpro_channel_id`, `zpro_qr_code`

---

## Rodar Localmente

```bash
# Instalar dependências
npm install

# Iniciar (backend + frontend juntos na porta 3000)
npm run dev
```

O Vite roda como middleware do Express — não é necessário iniciar separado.

---

## Variáveis de Ambiente (`.env`)

```env
# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_SERVICE_ROLE_KEY=

# Google Gemini
GEMINI_API_KEY=

# URL pública do app
APP_URL=http://localhost:3000

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=

# Z-PRO
ZPRO_ADMIN_URL=
ZPRO_ADMIN_TOKEN=

# UAZapi
UAZAPI_URL=
UAZAPI_TOKEN=

# E-mail (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=ImobiFlow <noreply@imobiflow.com>
```

> O arquivo `.env` **não é versionado** (protegido pelo `.gitignore`).
> Renomeie `.env.example` para `.env` e preencha as chaves.

---

## Estrutura de Pastas

```
imob.criate/
├── server.ts              # Backend completo (Express + toda a lógica)
├── src/
│   ├── App.tsx            # Roteamento + proteção por status
│   ├── pages/
│   │   ├── Dashboard.tsx       # CRM principal
│   │   ├── Login.tsx
│   │   ├── Signup.tsx
│   │   ├── PropertyLanding.tsx # Landing page pública do imóvel
│   │   ├── PaymentPending.tsx  # Tela de assinatura
│   │   ├── PaymentSuccess.tsx  # Confirmação de pagamento
│   │   └── WhatsAppSetup.tsx   # QR Code e status WhatsApp
│   ├── components/
│   │   ├── PropertyForm.tsx    # Formulário de imóvel
│   │   ├── MagicWandTextarea.tsx # Campo com IA integrada
│   │   └── AISettings.tsx
│   └── services/
│       ├── auth.ts        # Gerenciamento de sessão
│       └── gemini.ts
├── .env                   # Variáveis de ambiente (não versionado)
└── .gitignore
```
