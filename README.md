# ImobiFlow

Plataforma B2B SaaS para o mercado imobiliário brasileiro — corretor autônomo, imobiliária ou incorporadora, todos servidos pelo mesmo produto. A proposta: **"pague e, minutos depois, tenha um funcionário de IA no seu WhatsApp"** — não um sistema que você opera, um agente que você supervisiona.

> Este é o app **v2** (`imobiflow-v2.fly.dev`, branch `v2`) — o projeto principal e alvo de todo desenvolvimento ativo desde 2026-07-13. O app v1 (`imobiflow.fly.dev`, branch `main`) existe só como rede de segurança e não recebe mais features. Detalhe técnico completo e histórico de decisões em [`DOCUMENTACAO.md`](./DOCUMENTACAO.md).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 + Vite 6 + Framer Motion |
| Backend | Node.js + Express + TypeScript, modularizado sob `server/` (rodado via `tsx`, sem etapa de build) |
| Banco de dados | Supabase (PostgreSQL) — instância compartilhada com outros produtos da Criate, tabelas núcleo com prefixo `imf_` |
| Autenticação | Supabase Auth (JWT real — nunca confia em header de identidade) |
| Storage | Supabase Storage (fotos de imóveis) |
| IA — agente/texto | OpenRouter (`gpt-4o-mini`) |
| IA — voz | Google Gemini (`gemini-2.0-flash`, multimodal) transcreve áudio gravado no navegador |
| WhatsApp | UAZAPI nativa — provisionamento direto por corretor/membro, sem intermediário |
| Automação do agente do WhatsApp | N8N (`212n8n.criate.online`) — conversa com o cliente final, separado do Assistente interno do app |
| Pagamentos | Asaas (checkout + assinatura recorrente + cobrança de excedente) |
| Deploy | Fly.io — app `imobiflow-v2`, região `gru` (São Paulo), deploy manual (`fly deploy --remote-only`) |

---

## A ideia central: um agente, não um painel

O diferencial do produto é a **Assistente IA** (`src/experience/CommandBar.tsx` + `server/services/agent.ts`) — uma barra de comando em linguagem natural que substitui boa parte da navegação por telas. O corretor fala (digitando, colando ou **por voz**) e o agente decide e executa: cadastra imóvel, agenda/cancela/remarca visita (avisando o cliente por WhatsApp se pedido), manda mensagem, cadastra lead, consulta a agenda, navega pra qualquer área do sistema. Cada resposta pode:

- **Responder, navegar e consultar diretamente** em qualquer modo,
- **Propor e esperar confirmação** para toda mutação, inclusive no modo
  *piloto* (proteção contra prompt injection),
- Ou simplesmente responder, sem ação nenhuma.

Fotos podem ser anexadas na própria conversa (sobem pro Storage antes de qualquer coisa; o modelo nunca "vê" a imagem, só sabe que existe um anexo). O histórico da conversa é persistido por usuário (`imf_agent_log`) e sobrevive a fechar o chat ou recarregar a página — com um botão "Nova conversa" pra recomeçar do zero quando quiser.

**Importante:** este agente interno (o "cérebro" que o corretor usa dentro do app) é **diferente** do agente que atende os *clientes finais* pelo WhatsApp — esse roda inteiramente no N8N (`212n8n.criate.online`), lendo o catálogo real do corretor via API e agendando/cancelando visitas com o fuso de Brasília sempre correto.

---

## As 3 personas, as mesmas telas

Corretor autônomo, imobiliária e incorporadora usam a **mesma arquitetura de superfícies** (`src/experience/`), que se adapta ao porte da conta:

| Superfície fixa | Papel |
|---|---|
| **Hoje** | Cockpit/briefing — a tela que abre |
| **Conversas** | Inbox unificada do WhatsApp (abas IA atendendo / aguardando você / encerrado), com handover humano |
| **Carteira** | Imóveis (ou empreendimentos/unidades, no dialeto da incorporadora) |
| **Negócios** | Funil de leads |
| **Agenda** | Visitas agendadas via IA ou manualmente |
| **Contatos** | Contatos capturados automaticamente do WhatsApp (nome do perfil detectado) |

Módulos que acendem por porte de conta: **Locação** (contratos, cobrança de aluguel via Asaas), **Lançamentos** (unidades, reservas, vitrine pública), **Financeiro**, **Equipe** (múltiplos membros por conta, cada um podendo ter WhatsApp próprio ou compartilhado), **Relatórios**, **Divulgação** (landing pages públicas por imóvel).

---

## Estrutura de pastas

```
imob.criate/
├── server.ts                       # Bootstrap do Express (monta os routers, cron jobs)
├── server/
│   ├── config.ts                   # Todas as env vars
│   ├── supabase.ts                 # Cliente Supabase (service_role)
│   ├── lib/                        # crypto, http e infraestrutura compartilhada
│   ├── middleware/                 # auth (requireUser/getBrokerId/isBrokerOwner), validate (zod)
│   ├── services/
│   │   ├── agent.ts                # O "cérebro" do Assistente IA — snapshot da conta + Gemini/OpenRouter
│   │   ├── uazapi.ts                # Envio/recebimento WhatsApp e roteamento por instância
│   │   ├── billing.ts / rentalBilling.ts
│   │   ├── followup.ts             # Reengajamento automático de leads silenciosos
│   │   └── provisioning.ts         # Provisiona instância UAZAPI no signup/convite
│   └── routes/                     # Um arquivo por domínio: auth, brokers, properties, agent, ai,
│                                    # agenda, leads, contacts, equipe, locacao, lancamentos,
│                                    # financeiro, relatorios, vitrine, conversations, admin, billing...
├── src/
│   ├── experience/                 # A UI real (v2): CommandBar, ExperienceShell, *Area.tsx por superfície
│   ├── components/                 # PropertyForm, MagicWandTextarea (formulário manual + IA de texto)
│   ├── pages/                      # Login, Signup, Dashboard (shell), Admin, PropertyLanding, etc.
│   ├── services/                   # auth.ts (sessão JWT)
│   └── lib/                        # money.ts (máscara de preço), phone.ts, document.ts (CPF/CNPJ)
├── supabase/migrations/            # SQL versionado (rodado manualmente no Supabase, não automático)
├── .env.example                    # Template de variáveis (versionado)
├── fly.toml                        # App "imobiflow-v2", região gru
└── DOCUMENTACAO.md                 # Fonte de verdade técnica — arquitetura, decisões, histórico de bugs
```

---

## Banco de dados (Supabase)

Instância **compartilhada** com outros produtos da Criate — tabelas núcleo deste projeto usam prefixo `imf_` (`imf_brokers`, `imf_properties`, `imf_agenda`, `imf_leads`... também `leads`, `followup_conversations` sem prefixo, legado). **Sempre filtrar por `broker_id` derivado do JWT** — o backend usa `service_role` (ignora RLS), então isolamento multi-tenant é responsabilidade do código de aplicação em toda rota.

Lista completa de tabelas, colunas e RPCs: [`DOCUMENTACAO.md` §14.4](./DOCUMENTACAO.md).

---

## Rodar localmente

```bash
npm install
cp .env.example .env
# preencher .env com os valores reais (Supabase, Gemini, UAZAPI, Asaas, N8N...)

npm run dev      # tsx --max-old-space-size=1024 server.ts — Express + Vite juntos, porta 3000
npm test         # concorrência/lifecycle dos jobs + invariantes da topologia
npm run lint     # tsc --noEmit — sempre rodar antes de commitar
npm run build    # vite build → dist/
```

O Vite roda como middleware do Express — não precisa de processo separado.

---

## Deploy (Fly.io)

```bash
npm test && npm run lint && npm run build
fly deploy -a imobiflow-v2 --config fly.toml --remote-only
fly logs -a imobiflow-v2               # acompanhar
```

A V2 é publicada automaticamente por GitHub Actions em todo push na branch
`v2`, após testes, TypeScript, Knip e build. O Fly executa três process groups:
`web`, `worker` e `scheduler` singleton.

App em produção: `https://imobiflow-v2.fly.dev`

---

## Segurança — pontos-chave

- Autenticação sempre via JWT do Supabase Auth validado no backend (`requireUser`) — nenhuma rota confia em header de identidade do cliente.
- Rotas internas chamadas pelo N8N exigem `Authorization: Bearer INTERNAL_PROXY_TOKEN`.
- Webhook inbound da UAZAPI exige `body.token === uazapi_instance_token` da instância.
- `.env` no `.gitignore` — nunca versionado.
- Detalhe completo de auditorias de segurança e itens pendentes: `DOCUMENTACAO.md` §14.16+ (hardening) e memória `project_imobiflow_security`.

---

## Onde ler mais

- [`DOCUMENTACAO.md`](./DOCUMENTACAO.md) — arquitetura completa, modelo de dados, todos os endpoints, decisões arquiteturais, e um changelog técnico detalhado de cada rodada de trabalho (o que quebrou, causa raiz, o que foi corrigido).
- `UX_MASTERPLAN.md` — roteiro de produto por trás da arquitetura de superfícies/personas.
