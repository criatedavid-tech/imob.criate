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
| IA | Google Gemini 2.0 Flash Lite (aprimoramento de descrições) |
| Pagamentos | Asaas (checkout + webhooks) |
| WhatsApp | Z-PRO + N8N (agente IA automatizado) |
| Runtime | tsx (TypeScript direto, sem build) |

---

## Funcionalidades

### Corretor
- Cadastro com login automático (e-mail auto-confirmado via Supabase Admin API)
- Dashboard responsivo (mobile + desktop) com métricas: imóveis, leads ativos, visitas agendadas
- Gráfico de interesse dos últimos 6 meses
- Criação, edição e exclusão de imóveis com upload de até 15 fotos
- Upload de foto de perfil (Supabase Storage)
- IA para aprimorar descrições de imóveis (Gemini 2.0 Flash Lite)
- Perfil profissional completo (bio, citação, métricas de vendas)

### Imóveis
- Cada imóvel gera um `slug` único e uma landing page exclusiva em `/p/[slug]`
- Status: disponível / vendido / alugado
- Campos detalhados: quartos, banheiros, salas, cozinhas, área, piscina, varanda gourmet

### Leads
- Captura via landing page do imóvel (sem autenticação)
- CRM com status editável: Novo → Contato → Visita Agendada → Contactado → Arquivado
- Aba Agenda: visitas capturadas via N8N (tabela `agenda`) + leads legados com status `visita_agendada`

### Onboarding Automatizado (após pagamento)
1. Corretor se cadastra → status `pendente`
2. Redirecionado para checkout do Asaas
3. Asaas dispara webhook → backend recebe e valida
4. Banco atualizado: `brokers.status = 'ativo'`
5. Pagamento registrado em `subscriptions`
6. Tenant Z-PRO criado via API
7. Canal WhatsApp criado automaticamente
8. Corretor lê QR Code no app → WhatsApp conectado → agente IA N8N ativo

---

## Design — Liquid Glass (iOS 26 / macOS Tahoe)

O dashboard aplica o estilo **Liquid Glass** da Apple em todos os componentes principais:

| Elemento | Estilo |
|---|---|
| Fundo geral | `bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900` |
| Cards / Painéis | `backdrop-blur-xl bg-white/10 border border-white/15` |
| Sidebar desktop | `backdrop-blur-2xl bg-white/8 border-r border-white/12` |
| Header | `backdrop-blur-2xl bg-white/8 border-b border-white/10` |
| Modais | `backdrop-blur-2xl bg-white/12 border border-white/20` |
| Sombras | `inset 0 1px 0 rgba(255,255,255,0.25)` + drop shadow |

### Responsividade
- **Mobile** (`< md`): sidebar em drawer deslizante com hambúrguer, padding reduzido, tabelas com scroll horizontal, colunas progressivamente ocultadas
- **Tablet** (`sm`—`lg`): grades de 2 colunas, gráfico em altura reduzida
- **Desktop** (`md+`): sidebar fixa à esquerda, layout completo

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
| GET | `/api/agenda/visits` | Visitas agendadas (agenda + legado) |
| GET | `/api/dashboard/metrics` | Métricas do dashboard |
| GET | `/api/dashboard/charts` | Gráfico de leads por mês |
| POST | `/api/ai/enhance-text` | Aprimorar texto com Gemini |
| POST | `/api/checkout` | Criar cobrança Asaas |
| GET | `/api/subscription` | Status da assinatura |
| GET | `/api/whatsapp/status` | Status e QR Code do WhatsApp |
| POST | `/api/webhooks/asaas` | Webhook do Asaas (pagamento confirmado) |
| GET | `/api/properties/health` | Health check do banco |

---

## Banco de Dados (Supabase)

### Tabelas

| Tabela | Descrição |
|---|---|
| `brokers` | Perfil, status, plano e dados de integração do corretor |
| `properties` | Imóveis com slug, imagens (JSON), status e detalhes |
| `leads` | Leads capturados via landing page |
| `agenda` | Visitas agendadas via N8N / agente IA |
| `subscriptions` | Histórico de pagamentos Asaas |
| `webhook_logs` | Log de todos os webhooks recebidos |

### Campos relevantes em `brokers`
- `status` — `pendente` / `ativo` / `inativo`
- `plan`, `valid_until` — plano e validade da assinatura
- `zpro_tenant_id`, `zpro_api_key`, `zpro_channel_id` — integração WhatsApp
- `broker_address` — JSON serializado com dados do perfil profissional (bio, foto, citação, etc.)

### Campos em `leads`
- `broker_id` — FK para brokers (adicionado via migration)
- `client_name`, `client_phone` — dados do cliente
- `status` — `new` / `contato` / `visita_agendada` / `contacted` / `archived`

### Campos em `agenda`
- `broker_id`, `lead_id`, `property_id` — referências
- `scheduled_at` — data/hora da visita (timestamptz)
- `client_name`, `client_phone` — dados do visitante
- `status` — status da visita

### Row Level Security (RLS)
- `agenda`, `subscriptions`, `webhook_logs` — RLS habilitado
- Todas as rotas do backend usam `service_role` key (bypass de RLS)
- Queries do frontend passam exclusivamente pelo Express API

---

## Integração N8N — Agente IA WhatsApp

O agente N8N processa mensagens recebidas no WhatsApp via Z-PRO e:

1. Recebe o payload da mensagem via webhook
2. Usa Gemini para interpretar a intenção do cliente
3. Se for agendamento: salva na tabela `agenda` via Supabase
4. Responde automaticamente ao cliente via Z-PRO

**Campos esperados no payload Z-PRO:**
```json
{
  "startAt": "2026-05-20T14:00:00.000Z",
  "clientName": "João Silva",
  "clientPhone": "5511999999999"
}
```

**Configuração N8N:**
- Usar modo `expression` (ícone `fx`) em todos os campos dinâmicos
- Path correto: `$json.data[0].startAt` (não `$json.startAt`)

---

## Componente MagicWandTextarea

Campo de texto com botão IA integrado (botão roxo `✨ IA`):

- Envia o texto atual para `/api/ai/enhance-text`
- Recebe sugestão reescrita pelo Gemini
- Exibe painel glass com o texto sugerido
- Botões **Aplicar** (substitui o texto) ou **Descartar**
- Em caso de erro de cota: exibe botão **Tentar novamente** inline

**Modelo:** `gemini-2.0-flash-lite` (30 req/min no plano gratuito)

---

## Rodar Localmente

```bash
# Instalar dependências
npm install

# Matar processos anteriores na porta 3000 (se necessário)
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Iniciar (backend + frontend juntos na porta 3000)
cd C:\Users\Criate\imob.criate
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

# Asaas
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=

# Z-PRO
ZPRO_ADMIN_URL=
ZPRO_ADMIN_TOKEN=
```

> O arquivo `.env` **não é versionado** (protegido pelo `.gitignore`).
> Renomeie `.env.example` para `.env` e preencha as chaves.

---

## Estrutura de Pastas

```
imob.criate/
├── server.ts                    # Backend completo (Express + toda a lógica)
├── src/
│   ├── App.tsx                  # Roteamento + proteção por status de assinatura
│   ├── pages/
│   │   ├── Dashboard.tsx        # CRM principal (responsivo, Liquid Glass)
│   │   ├── Login.tsx
│   │   ├── Signup.tsx
│   │   ├── PropertyLanding.tsx  # Landing page pública do imóvel (não alterada)
│   │   ├── PaymentPending.tsx   # Tela de assinatura (Asaas)
│   │   ├── PaymentSuccess.tsx   # Confirmação de pagamento
│   │   ├── Admin.tsx            # Painel administrativo
│   │   └── WhatsAppSetup.tsx    # QR Code e status WhatsApp
│   ├── components/
│   │   ├── PropertyForm.tsx     # Modal de cadastro/edição de imóvel (glass)
│   │   ├── MagicWandTextarea.tsx # Campo com IA integrada (Gemini)
│   │   └── AISettings.tsx
│   └── services/
│       ├── auth.ts              # Gerenciamento de sessão JWT
│       └── gemini.ts
├── .env                         # Variáveis de ambiente (não versionado)
└── .gitignore
```

---

## Histórico de Mudanças Recentes

### feat/ui-redesign

#### Liquid Glass Design System
- Fundo global: gradiente `slate-900 → blue-950 → indigo-900`
- Todos os cards, painéis, modais e sidebar convertidos para `backdrop-blur + bg-white/10`
- Sombras com highlight interno (`inset 0 1px 0 rgba(255,255,255,0.25)`)
- Textos: `text-white`, `text-white/60`, `text-white/40`
- Toasts, delete modal, nav items — todos em glass

#### Dashboard Responsivo
- Sidebar: `hidden md:flex` no desktop, drawer deslizante (`motion.aside`) no mobile com hambúrguer
- Header: altura `h-16 md:h-20`, padding `px-4 md:px-10`
- Conteúdo: padding `p-4 md:p-10`, gráfico `h-56 md:h-80`
- Tabelas (Leads, Agenda): `overflow-x-auto`, colunas ocultadas progressivamente por breakpoint
- Grids: `sm:grid-cols-2 lg:grid-cols-3`

#### PropertyForm — Modal Corrigido
- Botão X fixo em header sticky (`sticky top-0 z-20`) — sempre visível
- Backdrop clicável para fechar
- Inputs dark: `bg-slate-800/90 [color-scheme:dark]` nos campos numéricos e selects
- Sem fundo branco ao clicar em Quartos, Salas, Piscina, etc.

#### MagicWandTextarea — IA Refatorada
- Botão `✨ IA` visível no tema escuro (`bg-violet-500/30 text-violet-200`)
- Painel de sugestão em fluxo normal (não `absolute`) — sem clipping pelo `overflow-hidden`
- Tema glass no painel de sugestão
- Botão **Tentar novamente** inline ao dar erro de cota
- Modelo: `gemini-2.0-flash` → `gemini-2.0-flash-lite` (30 RPM no free tier)

#### Supabase — Migrations
- `leads`: adicionados `broker_id`, `client_name`, `client_phone`
- `agenda`: tabela criada com `broker_id`, `lead_id`, `property_id`, `scheduled_at`, `client_name`, `client_phone`
- RLS habilitado em `agenda`, `subscriptions`, `webhook_logs`
