# ImobiFlow V2 — referência atual do projeto

> Estado consolidado do código da branch `v2` em 2026-07-20.
>
> O registro cronológico completo, com decisões, incidentes, comandos, releases e
> investigações anteriores, foi preservado integralmente em
> [HISTORICO_DETALHADO.md](./HISTORICO_DETALHADO.md). Consulte-o quando precisar
> reconstruir por que uma decisão foi tomada. Este arquivo descreve somente como
> o sistema está estruturado e o que é verdade agora.

## 1. Produto, escopo e ambientes

O ImobiFlow é uma plataforma imobiliária multi-tenant com três experiências no
mesmo produto:

- **Corretor:** operação individual de carteira, leads, conversas e agenda.
- **Imobiliária:** operação de equipe, locação, financeiro e cobrança própria.
- **Incorporadora:** operação de equipe, lançamentos, reservas, documentos e
  financeiro.

Ambientes que não devem ser confundidos:

| Ambiente | Endereço | Papel |
| --- | --- | --- |
| V2 | `https://imobiflow-v2.fly.dev/app` | produto que substituirá a V1 |
| Dashboard 1.0 dentro da V2 | `https://imobiflow-v2.fly.dev/` | interface legada ainda roteada e suportada |
| V1 | `https://imobiflow.fly.dev/` | aplicação anterior; não alterar durante trabalhos na V2 |

A branch de trabalho e publicação da V2 é `v2`. A branch `main` e o app Fly
`imobiflow` pertencem à V1 e ficam fora do escopo.

### Estado conhecido de produção

O deploy vigente confirmado é publicado automaticamente pelo workflow
`deploy-v2.yml` a partir do commit `729b000` (branch `v2` — última rodada:
correções mobile do Assistente IA — áudio iOS, anexo de foto Android,
webhook de entrada do WhatsApp — sobre o hardening de segurança do CRM em
`84497c3`; ver "Assistente IA e Follow-Up" e seção 6). Smoke de `/`, `/app`
e `/login` respondeu HTTP 200 em 2026-07-20. Número exato da release Fly não
confirmado nesta entrada — `flyctl` local está bloqueado por política de
Application Control (Smart App Control) do Windows nesta máquina; consultar
`fly status -a imobiflow-v2` ou o painel Fly quando disponível.

Desde 20/07/2026, **todo `git push origin v2` publica automaticamente** em
`imobiflow-v2.fly.dev` via GitHub Actions (`.github/workflows/deploy-v2.yml`,
gatilho `push`, secret `FLY_API_TOKEN_V2` — separado do `FLY_API_TOKEN` da
v1). Não existe mais um passo manual de deploy nem uma revisão entre commit
e publicação: `npx tsc --noEmit`/`npm run build`/`git diff --check` precisam
rodar **antes** do commit, não depois. Motivo da mudança: o `flyctl` local
pode ficar bloqueado por política de Application Control (Smart App Control)
do Windows — o CI builda e publica 100% nos runners do GitHub, sem depender
de nada local.

O produto está funcional e sem usuários ativos registrados, mas **não deve ser
declarado 100% pronto para lançamento** enquanto os QAs autenticados e as
credenciais listadas na seção 15 não forem concluídos.

## 2. Arquitetura atual

```text
Navegador
  React 19 + React Router + Tailwind CSS 4 + Vite
       │ HTTPS / JSON
       ▼
Servidor único Node.js
  Express 4 + TypeScript/tsx
  autenticação, autorização, domínio, jobs e SPA estática
       │ service_role somente no backend
       ▼
Supabase
  Auth + PostgreSQL + Storage privado
       │
       ├── UAZAPI ── WhatsApp por conta/membro
       ├── N8N ───── automação e agente
       ├── OpenRouter/proxy LLM
       ├── Asaas ─── assinatura, aluguel e sinal PIX
       ├── Redis ─── rate limit distribuído, se configurado
       └── Sentry ── observabilidade, se configurado
```

### Stack

- frontend: React 19, React Router 7, Tailwind CSS 4, Motion e Lucide;
- build/dev: Vite 6, TypeScript 5.8 e `tsx`;
- backend: Express 4, Zod, Helmet e `express-rate-limit`;
- dados/autenticação: Supabase Auth, PostgreSQL e Supabase Storage;
- infraestrutura opcional: Redis/ioredis e Sentry;
- produção: container Docker no Fly.io, porta interna 3000.

### Entradas e organização

| Caminho | Responsabilidade |
| --- | --- |
| `server.ts` | bootstrap Express, headers, routers, jobs e entrega do SPA |
| `server/config.ts` | leitura centralizada das variáveis de ambiente |
| `server/middleware/auth.ts` | JWT, tenant e distinção titular/membro |
| `server/routes/` | endpoints separados por domínio |
| `server/services/` | billing, WhatsApp, IA, reservas, jobs e integrações |
| `src/App.tsx` | rotas públicas, privadas, Dashboard 1.0 e cockpit V2 |
| `src/experience/` | shell e áreas manuais da experiência V2 |
| `src/pages/Dashboard.tsx` | Dashboard 1.0; continua vivo na rota `/` |
| `supabase/migrations/` | evolução versionada do schema compartilhado |
| `fly.toml` / `Dockerfile` | execução e publicação da V2 no Fly |

## 3. Convenções obrigatórias

- Novas tabelas do ImobiFlow devem usar o prefixo `imf_`, pois o projeto
  Supabase é compartilhado. Existem tabelas históricas sem esse prefixo, como
  `leads` e `followup_conversations`; isso não autoriza criar novas exceções.
- Valores monetários persistidos usam centavos inteiros (`*_cents`). Conversão
  para reais pertence à apresentação ou à borda da integração.
- Datas persistidas usam ISO/UTC. Regras de calendário de Relatórios usam
  `America/Sao_Paulo` explicitamente.
- A identidade vem exclusivamente do JWT Supabase validado. Nunca confiar em
  `x-user-id`, IDs recebidos do frontend ou parâmetros de tenant sem conferir
  posse no backend.
- Toda consulta autenticada deve começar pelo `brokerId` resolvido pelo
  backend e aplicar o escopo de titular/membro apropriado.
- Segredos ficam apenas no ambiente ou criptografados. Nunca colocar
  `service_role`, tokens UAZAPI, chaves Asaas/OpenRouter ou `.env` real no Git.
- Migrations não são executadas automaticamente pelo deploy. Aplicar e
  verificar o SQL antes de publicar código que dependa do novo schema.
- A V1, o Dashboard 1.0 e migrations antigas não são alvos de limpeza
  automática. Remoção exige decisão de produto e QA específico.

## 4. Autenticação, contas e isolamento multi-tenant

### Modelo de conta

- `imf_brokers` representa a conta/tenant e guarda o titular em `user_id`.
- `imf_broker_members` vincula usuários da equipe ao `broker_id`. Contas
  antigas são autocuradas pelo `getBrokerId`, que cria a membership do titular.
- `account_type` fixa a persona da conta em `corretor`, `imobiliaria` ou
  `incorporadora`. Um administrador pode alternar visualmente entre personas
  para QA, sem mudar a natureza dos dados da conta.
- `is_admin` libera o painel administrativo global; isso é diferente de ser o
  titular de uma conta.

### Regras de visibilidade

- O titular (`imf_brokers.user_id`) vê o consolidado de sua conta.
- Em Carteira, Leads, Agenda e Conversas, membros são filtrados por
  `owner_user_id` e só podem ver ou alterar o que lhes pertence.
- Operações de equipe e áreas financeiras conferem permissões e/ou titularidade
  no backend; esconder um botão no frontend não é autorização.
- Dados de locação consolidados não são mostrados a membros nos Relatórios,
  pois os contratos atuais não possuem autoria individual confiável.
- Documentos de reserva são privados e dependem de posse, `financial_access`
  e URL assinada de curta duração.

O backend usa a `SUPABASE_SERVICE_ROLE_KEY`, que ignora RLS. Portanto, RLS é
defesa adicional; o filtro explícito em cada rota continua obrigatório.

## 5. Personas e módulos

| Área | Corretor | Imobiliária | Incorporadora |
| --- | :---: | :---: | :---: |
| Hoje | sim | sim | sim |
| Conversas | sim | sim | sim |
| Assistente IA | sim | sim | sim |
| Carteira | sim | sim | sim |
| Leads | sim | sim | sim |
| Agenda | sim | sim | sim |
| Contatos | sim | sim | sim |
| Locação | — | sim | — |
| Lançamentos | — | — | sim |
| Financeiro | — | sim | sim |
| Equipe | — | sim | sim |
| Divulgação | sim | sim | sim |
| Relatórios | sim | sim | sim |
| Config | sim | sim | sim |

### Situação funcional por domínio

- **Hoje:** indicadores da operação real por persona.
- **Conversas:** caixa por status, histórico, resposta humana, liga/desliga IA,
  responsável, fila, tags, notas e exclusão definitiva de um ticket/ciclo
  (`DELETE /api/conversas/:ticketId`, com mensagens/tags/notas em cascata).
  Nome do contato (de `imf_contacts`, auto-salvo no primeiro inbound) exibido
  na lista e no cabeçalho. Tags têm gerenciamento próprio (criar, renomear,
  trocar cor, apagar — botão "Gerenciar tags", `PATCH`/`DELETE
  /api/conversas/tags/:id`). Botão "Criar lead" cadastra o contato da
  conversa como lead (nome + telefone), sem imóvel de interesse ainda —
  idempotente, não duplica se já existir um lead com o telefone
  (`POST /api/conversas/:ticketId/create-lead`).
- **Assistente IA:** nome, instruções e Follow-Up Inteligente em área própria.
  Config não contém mais campos de IA na V2.
- **Carteira:** imóveis, estados, imagens, landing pública e vitrine.
- **CRM (antiga "Leads", tela em `NegociosArea.tsx`, chave interna
  `negocios` inalterada):** duas abas, Kanban e Pipelines — ver detalhamento
  na seção 6 ("CRM: pipelines e etapas"). Criação, edição e exclusão
  definitiva de lead (`DELETE /api/leads/:id`) continuam como antes. Lead
  nem sempre tem imóvel — os criados a partir de uma conversa ficam
  escopados direto por `broker_id` (`property_id` null); os do fluxo
  tradicional (landing/cadastro manual) continuam escopados via o imóvel.
  Migration `20260717b_crm_pipelines.sql` aplicada; deployado na release v94
  (ver seção 6 "CRM: pipelines e etapas" e seção 14).
- **Agenda:** visitas e calendário com criação, alteração e cancelamento.
- **Contatos:** CRUD e salvamento automático a partir de conversas.
- **Locação:** contratos, vencimentos, valores para acompanhamento e exclusão
  definitiva de contrato com as cobranças associadas em cascata
  (`DELETE /api/locacao/contracts/:id`). A criação de boleto/PIX do cliente
  está desativada por padrão.
- **Lançamentos:** empreendimentos, unidades, simulador, reserva operacional,
  documentos privados e venda. O PIX de sinal está desativado por padrão.
  Exclusão de unidade/empreendimento só é bloqueada quando existe reserva
  com pagamento confirmado (`paid_at`); reservas sem pagamento real são
  removidas em cascata junto (documentos no Storage e no banco inclusos).
- **Financeiro:** consolidação de locação e vendas; valores grandes possuem
  quebra de linha para não vazar do card.
- **Equipe:** convites, membros, metas, ranking, permissões, opção de
  WhatsApp compartilhado ou próprio e revogação de convite pendente ainda não
  aceito (`GET`/`DELETE /api/equipe/invites/:id`, só o titular). O limite de
  WhatsApp próprio (`member_limit`) é self-service desde 17/07 —
  `GET`/`PATCH /api/equipe/whatsapp-slots`, só o titular altera, cobrado como
  add-on por slot (`MEMBER_WHATSAPP_SLOT_PRICE`, valor ainda fictício) — não
  se aplica a corretor (não tem Equipe). Selecionável já no checkout
  (`PaymentPending.tsx`) ou depois em Config.
- **Divulgação:** links e vitrines públicas.
- **Relatórios:** métricas determinísticas de 3, 6 ou 12 meses.
- **Config:** perfil, WhatsApp, plano, uso/excedentes, termos, chave Asaas para
  imobiliária/incorporadora e saída.

## 6. Fluxos ponta a ponta importantes

### Cadastro, pagamento e ativação

1. O cadastro cria o usuário no Supabase Auth e a linha `imf_brokers`, com a
   persona escolhida e status inicial `pendente`.
2. Usuário pendente é enviado para `/payment`.
3. Checkout e assinatura usam a conta Asaas global da Criate.
4. O webhook Asaas valida idempotência, atualiza a assinatura e ativa a conta.
5. Ativação por pagamento ou pelo Admin dispara a autocura do WhatsApp.
6. O acesso ao cockpit depende de sessão válida e status de assinatura.

O billing possui trava, idempotência, fila `imf_billing_reconciliations` e job
de reconciliação para operações externas que não concluíram de forma atômica.

### WhatsApp nativo UAZAPI

- Cada conta possui uma instância UAZAPI; um membro pode compartilhar a da
  conta ou ter instância própria.
- `ensureBrokerInstance` e `ensureMemberInstance` fazem autocura quando não há
  token e usam trava comparar-e-trocar para evitar provisionamento duplicado.
- O status e o connect chamam a autocura; a ativação manual do Admin também.
- A instância recebe webhook direto em
  `/api/wpp-shim/inbound/:instanceId`; o fluxo ativo não provisiona Z-PRO.
- É possível conectar por QR code ou código de pareamento. O telefone completo
  brasileiro é normalizado sem remover o nono dígito nesse fluxo.
- Desconectar chama `/instance/disconnect` sem apagar a instância, permitindo
  parear outro número e preservar token/webhook.
- Falhas de provisionamento são expostas à UI com retry, em vez de deixar o
  usuário indefinidamente no estado “configurando”.

### Ciclos de ticket e histórico de conversas

O trabalho local posterior à release v87 introduz um ID nativo por atendimento:

- `imf_conversation_tickets.id` é um UUID único por ticket;
- mensagens, tags e notas apontam para `ticket_id`, evitando misturar ciclos
  diferentes do mesmo telefone;
- enquanto o ticket estiver `pending` ou `open`, novas mensagens reutilizam o
  mesmo UUID;
- depois de `closed`, o ticket fica imutável e a próxima mensagem do cliente
  abre outro UUID em `pending`;
- `followup_conversations` continua como ponte operacional do ticket atual por
  telefone, para preservar o scheduler de follow-up;
- a tela Conversas lista tickets ativos e históricos e mostra um código curto
  derivado do UUID; o UUID completo permanece no banco/API;
- respostas atrasadas da IA são recusadas se o ticket estiver encerrado ou em
  atendimento humano.

A migration `20260717_conversation_ticket_cycles.sql` faz o backfill. Como não
é possível inferir com segurança os limites de ciclos históricos antigos, todo
o conteúdo legado de um telefone é associado a um ticket inicial. A separação
exata por ciclo passa a valer a partir da publicação desta implementação.

**Estado:** migration aplicada e verificada manualmente no Supabase em
17/07/2026. Tabela, colunas e índice retornaram `true`; conversas, mensagens,
tags e notas sem `ticket_id` retornaram zero. O código dependente foi publicado
no commit `d50e938` e na release Fly v88. Validação concluída com
`npx tsc --noEmit`, `npx knip`, `npm run build`, `git diff --check`, health
check e smoke HTTP 200 em `/`, `/login` e `/app`.

`UAZAPI_PLATFORM_SESSION` não é a instância individual do corretor. Ela é a
sessão da plataforma usada para mensagens como recuperação de senha por
WhatsApp e continua sendo uma credencial operacional pendente de confirmação
no Fly.

### CRM: pipelines e etapas (fase 1)

Transforma a área visualmente chamada "Leads" em "CRM". A chave interna
`negocios`, o componente `NegociosArea.tsx`, a tabela `leads` e os endpoints
`/api/leads` continuam existindo — a mudança é de apresentação e de modelo de
estágios, não uma reescrita.

**Estado:** migration `20260717b_crm_pipelines.sql` aplicada manualmente no
Supabase da branch `v2` em 17/07/2026; código publicado no commit `77769f0`
e na release Fly **v94** (imagem
`registry.fly.io/imobiflow-v2:deployment-01KXS0VH92QETBWY6BGGY3ZQS5`,
manifesto `sha256:0928b4fe2ccf8b60a5652110680b3f9d26157eec8537b70098042d816bbff847`,
máquina `08075edf911368` em `gru`, health check 1/1). Validação:
`npx tsc --noEmit`, `npx knip`, `npm run build`, `git diff --check` e smoke
HTTP 200 em `/`, `/app` e `/login`. Ambiente sem clientes reais; QA
autenticado completo (isolamento entre dois tenants, comportamento de
`closed_at`) ainda pendente.

Em 20/07/2026 foi preparada e executada manualmente a migration corretiva
`20260720b_crm_security_hardening.sql` (execução informada pelo usuário;
verificação pós-migration aprovada). Ela fecha a
execução pública da RPC `SECURITY DEFINER` de reorder, rejeita listas
duplicadas/incompletas, preserva a ordem por ordinality, torna autocura/troca
de padrão/edição e remoção de etapa transacionais e impede associar lead novo
a etapa ou pipeline arquivado. O backend tem compatibilidade temporária quando
as RPCs novas ainda não existem, mas esta migration deve ser executada e
verificada antes do próximo commit/push que publique esse código.

**O que existe agora:**

- `NegociosArea.tsx` ganhou duas abas: **Kanban** (o funil, agora com
  colunas dinâmicas) e **Pipelines** (`PipelinesManager.tsx` — CRUD de
  pipelines e etapas).
- As colunas do Kanban deixam de ser o array fixo `new/contato/visita/
  proposta/fechado` e passam a vir das etapas do pipeline selecionado
  (seletor no topo, pipeline padrão pré-selecionado). Drag-and-drop e
  botões de avançar/voltar continuam, agora sobre a lista dinâmica.
  Arrastar usa `@dnd-kit/core` (não mais a API nativa HTML5 Drag and
  Drop) — ver "Drag-and-drop cross-platform" abaixo.
- Cada broker pode ter vários pipelines; exatamente um é o padrão
  (`is_default`). Cada pipeline tem etapas ordenadas (`position`), cada
  etapa tem um `stage_type` semântico: `open` (em andamento), `won`
  (ganho) ou `lost` (perdido).
- Todo lead novo — interface, landing pública, agente de IA, "Criar lead"
  a partir de conversa — recebe automaticamente o pipeline padrão do
  broker e a primeira etapa ativa dele (`resolveNewLeadStage`/
  `ensureDefaultPipeline` em `server/services/crmPipelines.ts`). Contas
  criadas depois da migration (que não passaram pelo backfill) recebem o
  pipeline padrão na primeira chamada, por autocura — mesmo princípio do
  `getBrokerId`.
- A aba Pipelines é leitura para membros. Só o titular recebe na resposta
  `can_manage=true` e vê controles de criação, edição, reorder, arquivamento e
  exclusão; o backend continua sendo a barreira definitiva com
  `isBrokerOwner`.

**Modelo de dados novo** (`supabase/migrations/20260717b_crm_pipelines.sql`,
detalhada na seção 14): tabelas `imf_crm_pipelines` e
`imf_crm_pipeline_stages`; colunas `leads.pipeline_id` e
`leads.pipeline_stage_id`. Sem `ON DELETE CASCADE` em nenhuma FK que chegue
em `leads` — apagar pipeline/etapa com lead associado é sempre bloqueado
(409) tanto na API quanto, como reforço estrutural, pelo próprio Postgres
(RESTRICT).

**Endpoints novos** (`server/routes/crmPipelines.ts`, montado em
`server.ts`; todos atrás de `requireUser`, mutações exigem titular via
`isBrokerOwner`):

| Endpoint | Quem pode |
| --- | --- |
| `GET /api/crm/pipelines` | qualquer membro do broker (autocura o pipeline padrão antes de listar) |
| `POST /api/crm/pipelines` | só titular |
| `PATCH /api/crm/pipelines/:id` | só titular |
| `DELETE /api/crm/pipelines/:id` | só titular — 409 se for o padrão ou se tiver leads |
| `POST /api/crm/pipelines/:id/stages` | só titular |
| `PATCH /api/crm/stages/:id` | só titular — `active:false` com leads exige `reassign_to_stage_id` ou retorna 409 |
| `DELETE /api/crm/stages/:id` | só titular — mesma regra de 409, via `?reassign_to_stage_id=` |
| `PATCH /api/crm/pipelines/:id/stages/reorder` | só titular — RPC `imf_crm_reorder_stages`, reatribui posição de forma atômica |
| `PATCH /api/leads/:id/stage` (em `leads.ts`) | titular ou membro dono do lead — mesma regra de posse do `/status` |

`broker_id` nunca é aceito do corpo da requisição em nenhum destes — sempre
resolvido via `getBrokerId(userId)`. `pipeline_id` de um lead nunca é
aceito solto: é sempre derivado do `stage_id` pelo trigger no banco.

**Compatibilidade com `leads.status`/`closed_at`:** um trigger
(`trg_imf_sync_lead_pipeline_stage`, dispara em INSERT e em UPDATE que
toque `pipeline_stage_id`) mantém os dois campos legados em sincronia a
partir do `stage_type` da etapa atual:

- `won` → `status='fechado'`, `closed_at` preenchido só se ainda nulo;
- `lost` → `status='perdido'` (valor novo — nenhuma métrica existente lê
  `status==='fechado'` diretamente, todas usam `closed_at IS NOT NULL`,
  então isso não quebra relatórios/metas/ranking; o único efeito colateral
  conhecido é que o gráfico de distribuição por etapa de Relatórios, que
  não conhece `'perdido'`, bucketiza esses leads em "new" — cosmético,
  não afeta contagem de fechados);
- `open` → `closed_at` limpo ao trocar de etapa; `status` normalizado pra
  `new` se não for um dos 4 valores legados de "em andamento".

O endpoint legado `PATCH /api/leads/:id/status` continua existindo para
chamadores externos. Quando o lead já pertence ao CRM, ele também resolve uma
etapa ativa compatível dentro do mesmo pipeline e atualiza
`pipeline_stage_id`; assim o status legado não diverge da coluna do Kanban.
Para pipelines personalizados sem os nomes históricos, preserva a etapa
`open` atual (ou usa a primeira ativa). O Kanban atual usa `/stage`.

Consumidores revisados e confirmados sem regressão: `server/routes/
relatorios.ts` (funil, negócios fechados, conversão — tudo via `closed_at`
ou com fallback gracioso pra valor desconhecido), `server/routes/
equipe.ts` (meta do mês e ranking, 100% via `closed_at`), `server/
services/agent.ts` (snapshot da IA lê `status` cru, sem hardcode dos 5
valores), `server/routes/dashboard.ts` (Dashboard 1.0 legado, não tocado).

**Drag-and-drop cross-platform (20/07/2026):** a primeira versão do Kanban
usava a API nativa HTML5 Drag and Drop (`draggable`/`onDragStart`/
`onDragOver`/`onDrop`). Essa API nunca teve suporte a toque no Safari iOS —
lacuna do WebKit, não específica deste app — então arrastar funcionava no
desktop e no Chrome Android (que tem uma camada de compatibilidade própria),
mas não no iPhone. Substituída por `@dnd-kit/core`, que unifica mouse/toque/
caneta via Pointer/Touch Events:

- `MouseSensor` ativa por distância (8px — resposta imediata, como antes);
  `TouchSensor` ativa por delay (200ms + tolerância de 8px) — sem isso, um
  gesto de rolar a tela (a lista de colunas rola na horizontal, cada coluna
  pode rolar na vertical) seria interpretado como início de arrasto. Mesmo
  padrão do exemplo oficial "Multiple Containers" da biblioteca.
- `DragOverlay` mostra uma cópia do card seguindo o dedo/cursor durante o
  arrasto; o card original fica semitransparente no lugar.
- Toda a lane (não só os cards) é zona de soltar — inclui o vão vazio.
- Os botões de avançar/voltar/editar/apagar dentro do card continuam
  funcionando normalmente (um toque sem movimento nunca cruza o limiar de
  ativação, então nunca vira arrasto).
- Validado localmente: sensor de mouse testado ponta a ponta (evento real
  de `mousedown`+`mousemove` incremental+`mouseup`, via conta descartável) —
  moveu o lead e persistiu via `PATCH /api/leads/:id/stage`. `TouchSensor` é
  o mesmo mecanismo da biblioteca, só que ouvindo eventos de toque.
  **Confirmado pelo usuário em 20/07/2026: arrastar funciona em dispositivo
  Android e iPhone reais.** Bug considerado resolvido.

**Efeito colateral corrigido — exclusão de conta pelo admin:**
`DELETE /api/admin/brokers/:id` apaga a linha de `imf_brokers` confiando em
CASCADE pra limpar o resto (`server/routes/admin.ts`). `imf_crm_pipelines`/
`imf_crm_pipeline_stages` foram criadas sem CASCADE de propósito (proteger
contra apagar UM pipeline/etapa com leads ainda vinculados), o que quebrou
esse fluxo mais amplo — a exclusão da conta inteira passou a falhar com
violação de FK, e o código nem checava o erro desse delete (reportaria
sucesso mesmo assim). Corrigido em duas frentes: migration
`20260720_crm_pipelines_broker_cascade.sql` adiciona `ON DELETE CASCADE`
só nessas duas FKs (seguro especificamente pro caso "apagar o broker
inteiro", já que os leads dele já cascadeiam junto via `imf_properties`/
`leads` → `imf_brokers`, então nada fica órfão); e `admin.ts` agora verifica
o erro do delete antes de responder `success`. Migration aplicada e
verificada em 20/07/2026 (ver tabela de migrations).

**Limitações da fase 1:** sem Dashboard/Calendário/Ações do CRM (fica pra
depois, conforme pedido); reorder de etapa é por botões ↑/↓ na aba
Pipelines, não drag-and-drop; mover lead entre pipelines diferentes é
permitido tecnicamente (mesmo broker, sem risco de isolamento) mas não tem
UI dedicada; o gráfico de distribuição por etapa em Relatórios não
distingue "perdido" de "novo" (ver acima).

**Risco a confirmar com o usuário antes de aplicar a migration:** o
backfill (seção 7.3 do SQL) associa cada lead existente à etapa
correspondente ao `status` atual. Para qualquer lead com `status='fechado'`
mas `closed_at` historicamente nulo (inconsistência pré-existente, se
houver), o trigger preenche `closed_at = now()` no momento da migration —
mesma estratégia de estimativa já usada em `imf_units.sold_at`
(migration `20260716d`). Isso pode fazer relatórios de períodos passados
passarem a contar esse negócio como fechado "hoje" em vez de silenciosamente
ignorado como antes. Não é possível recuperar a data real retroativamente;
sinalizando aqui em vez de decidir sozinho, conforme pedido.

### Assistente IA e Follow-Up

- A V2 usa a área `assistente-ia` nas três personas.
- Nome e instruções vêm de `imf_brokers`/`broker_agents`; Follow-Up usa sua
  configuração própria.
- O Follow-Up tem toggle, três intervalos e três mensagens, enviados em ordem
  por um scheduler de 60 segundos.
- A UI nova foi implementada dentro de `AssistenteIAArea`. Os componentes
  `AISettings.tsx` e `FollowUpSettings.tsx` permanecem para o Dashboard 1.0.
- O proxy LLM usa chave OpenRouter do tenant quando configurada e fallback
  global da Criate. Segredos por tenant são criptografados com
  `LLM_PROXY_ENC_KEY`.

**Fix — áudio (iOS) e anexo de foto (Android) no Assistente IA (20/07/2026):**
Dois bugs distintos, um por plataforma, no `CommandBar.tsx`:

1. *iOS — transcrição rejeitava com "Dados inválidos.":* `POST
   /api/ai/transcribe` validava o `mimeType` do navegador com um regex
   estrito de allowlist. O Safari iOS reporta o formato de jeito
   imprevisível (`audio/mp4;codecs="mp4a.40.2"`, às vezes com espaço após
   o `;`), caindo direto na falha de schema. A validação estrita de
   formato não protegia nada de real — a proteção efetiva é o payload
   base64 válido + o limite de tamanho. Reescrito `server/routes/ai.ts`:
   o `mimeType` virou dica opcional (sem regex de allowlist); a validação
   passou a ser "é um data URL de áudio + base64 válido"
   (`AUDIO_DATA_URL_HEADER`); e o `format` enviado ao provedor é derivado
   do tipo real do áudio (`resolveAudioFormat`), preferindo o declarado no
   próprio data URL. Não-áudio continua barrado.
2. *Android — seletor de foto não abria (confirmado resolvido em aparelho
   real após 3 tentativas):* o problema tinha duas frentes distintas.
   - **Chrome Android real:** o `<input type="file">` estava com
     `display:none` (acionado por um botão via `.click()` programático, e
     depois por um `<label>`). Testado em campo, o Chrome Android **não
     abre** o seletor de um input `display:none` por nenhum desses
     caminhos. Solução final que funcionou: o input fica **transparente
     por cima do ícone** de clipe (`absolute inset-0 opacity-0`, ícone
     como irmão num wrapper `relative`) — o toque cai direto no próprio
     input, sem `<label>`, sem `.click()`, sem `display:none`. É o padrão
     canônico de upload da web. **Usar o mesmo padrão em qualquer upload
     mobile futuro.**
   - **Navegador embutido do WhatsApp (WebView Android):** não implementa
     o seletor de arquivo — nenhum código abre a galeria lá (no iOS o
     WebView implementa, por isso funcionava no iPhone). O `CommandBar`
     detecta esse ambiente (`/Android/` + marcador `; wv)` no user agent —
     Chrome/Samsung/Firefox/iOS reais não têm) e, ao tocar no clipe,
     mostra a dica "abra no Chrome" em vez de um toque sem efeito.

**Fix — WhatsApp de entrada não chegava no V2 (webhook apontando pro Z-PRO
morto, 20/07/2026):** contas provisionadas na era Z-PRO tinham o webhook da
instância UAZAPI ainda apontando pra `appback.criate.online/uazapi-webhook/…`
(backend Z-PRO desativado) em vez de
`…/api/wpp-shim/inbound/:instanceId` do V2. Com a instância `connected`, o
UAZAPI entregava os eventos pro Z-PRO e o V2 nunca via a mensagem — a
conversa ficava "Sem mensagens registradas" (diagnóstico: zero registros em
`webhook_logs` source `uazapi`, que loga TODO evento ANTES de validar).
Corrigido com self-heal: `setUazapiWebhook(token, instanceId)` extraído como
helper exportado em `provisioning.ts`, `resolveManagedInstance` passou a
devolver o `instanceId` da instância já existente, e
`POST /api/brokers/whatsapp/connect` reafirma o webhook correto a cada
conexão. Assim qualquer instância legada se autocura ao reconectar. A
instância afetada teve o webhook re-apontado manualmente na hora; confirmado
pelo usuário que a mensagem de entrada voltou a chegar no painel.

### Asaas e limite do escopo financeiro

O produto separa dois fluxos financeiros:

1. **Assinatura do ImobiFlow:** sempre usa `ASAAS_API_KEY` global da Criate.
   O valor não é mais fixo: `SUBSCRIPTION_VALUE` + `member_limit × MEMBER_WHATSAPP_SLOT_PRICE`
   (WhatsApp próprio de equipe, self-service — ver seção 5/Equipe). O job
   horário de excedente (`prepareOverageBilling`) resincroniza esse valor no
   Asaas antes de cada renovação, então mudar `member_limit` não precisa
   chamar o Asaas na hora — a cobrança nova entra sozinha no próximo ciclo.
2. **Dinheiro do cliente da imobiliária/incorporadora:** a implementação
   histórica de aluguel e sinal PIX permanece preservada, mas bloqueada no
   backend e escondida no frontend por padrão.

`CLIENT_FINANCIAL_OPERATIONS_ENABLED` e
`VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED` precisam ser explicitamente `true`
para reativar os dois lados. No estado normal, novas cobranças de aluguel,
reservas PIX e alterações da chave Asaas do cliente recebem bloqueio de
produto. Leitura histórica, contratos, reservas sem cobrança, documentos e
billing da assinatura continuam funcionando.

Em 17/07/2026, esta desativação foi publicada na produção V2 pelo commit
`e63ce86` e pela release Fly **v87**. A imagem ativa é
`registry.fly.io/imobiflow-v2:deployment-01KXR5C1SYXWKKWDFH6ZW8RYZ8`, com
manifesto `sha256:e731425d992d2ba1bc0ddc26c6ae2eea2804d1fd07f09485be8a7c5201688e4c`.

A estrutura de chave própria continua criptografada no banco apenas para
compatibilidade/reversibilidade; ela não aparece na Config enquanto a flag do
frontend estiver desligada.

## 7. Lançamentos — fases entregues

### Fase 1 — simulador

- cadastro de empreendimento e unidades;
- simulação de entrada, prazo e parcelas;
- estados de disponibilidade da unidade.

### Fase 2 — reserva financeira (implementada, atualmente desativada)

- reserva de unidade com sinal PIX no Asaas;
- unicidade de reserva ativa por unidade;
- idempotência e expiração automática;
- webhook confirma pagamento;
- cobrança usa a credencial Asaas resolvida para o broker.

O fluxo acima foi preservado para histórico, mas novas chamadas são bloqueadas
pela flag de operações financeiras de clientes. O caminho vigente é **Reservar
unidade**, sem criação de cobrança.

### Fase 3 — documentos e gate de venda

- checklist de documentos por reserva;
- upload em bucket privado `imf-reservation-documents`;
- status `pendente`, `enviado`, `aprovado` e `rejeitado`;
- download por URL assinada após autorização;
- trilha de envio e revisão;
- venda bloqueada quando existem documentos não aprovados;
- compatibilidade: reserva sem nenhum documento continua vendável.

As migrations `20260716c_reservation_documents.sql`,
`20260716d_report_period_metrics.sql` e
`20260716e_broker_asaas_key.sql` foram registradas como aplicadas manualmente.
Mesmo assim, o QA autenticado da Fase 3 ainda precisa cobrir isolamento entre
tenants e todo o ciclo rejeitar → reenviar → aprovar → vender.

## 8. Relatórios — definição das métricas

O endpoint é `GET /api/relatorios/summary?months=3|6|12`. A janela começa em
00:00 de São Paulo no primeiro dia do primeiro mês incluído e termina no
instante da consulta.

| Métrica | Definição |
| --- | --- |
| Leads captados | `created_at` dentro da janela |
| Leads por mês | mesma coorte agrupada pelo mês de criação |
| Distribuição no funil | estágio atual da coorte, não histórico de transições |
| Negócios fechados | `closed_at` na janela, mesmo se captado antes |
| Conversão | captados na janela que fecharam na janela ÷ captados na janela |
| VGV vendido | soma de `imf_units.price_cents` com `sold_at` na janela |
| Aluguéis recebidos | pagamentos `paid` com `paid_at` na janela; titular apenas |
| Carteira mensal ativa | soma atual dos contratos ativos; é snapshot, não acumulado |
| Visitas realizadas | agenda com status `realizado` na janela |
| Visitas válidas | eventos não cancelados e não futuros na janela |

O resumo é determinístico e não é calculado por LLM. Para membros, leads,
fechamentos, vendas e visitas são filtrados pelo usuário. `sold_at` é mantido
por trigger e pelos caminhos da interface/agente; o backfill histórico usa
`updated_at`/`created_at` como estimativa para vendas anteriores à migration.

## 9. Modelo de dados essencial

| Domínio | Tabelas principais |
| --- | --- |
| Conta/equipe | `imf_brokers`, `imf_broker_members`, `imf_broker_invites` |
| Imóveis/leads | `imf_properties`, `leads`, `imf_contacts` |
| CRM (pipelines) | `imf_crm_pipelines`, `imf_crm_pipeline_stages` (+ `leads.pipeline_id`/`pipeline_stage_id`) — schema-base e hardening `20260720b` aplicados e verificados |
| Agenda | `imf_agenda` |
| Conversas | `imf_conversation_tickets`, `followup_conversations`, `imf_conversation_messages`, `imf_conversation_tags`, `imf_conversation_tag_links`, `imf_conversation_notes` |
| Locação | `imf_rental_contracts`, `imf_rental_payments` |
| Lançamentos | `imf_developments`, `imf_units`, `imf_unit_reservations`, `imf_reservation_documents` |
| Billing SaaS | assinaturas, uso/excedentes, `imf_billing_lock`, `imf_billing_reconciliations` |
| Agente | `broker_agents` e histórico do agente |
| Auditoria | `webhook_logs` com retenção operacional de 90 dias |

O schema real inclui estruturas históricas criadas antes das migrations
versionadas. Antes de escrever uma migration, conferir tanto os SQLs do repo
quanto o schema efetivo no Supabase.

## 10. Superfície da API

Os routers são montados diretamente em `server.ts`. Grupos principais:

- `/api/auth/*`: cadastro, login, refresh, reset e entrada em equipe;
- `/api/brokers/*`: perfil, agente, termos, WhatsApp, Asaas e foto;
- `/api/properties/*`, `/api/leads/*`, `/api/agenda/*`, `/api/contacts/*`;
- `/api/crm/*`: pipelines e etapas do CRM (schema-base e hardening aplicados e verificados, ver seções 6/14);
- `/api/conversas/*` e `/api/wpp-shim/*`;
- `/api/followup/*`, `/api/ai/*`, `/api/agent/*`, `/api/proxy/llm`;
- `/api/locacao/*`, `/api/lancamentos/*`, `/api/financeiro/*`;
- `/api/equipe/*`, `/api/relatorios/*` e `/api/dashboard/*`;
- `/api/checkout`, `/api/subscription`, `/api/billing/*` e webhooks Asaas;
- `/api/admin/*`: administração global protegida por `requireAdmin`;
- `/api/vitrine/*` e páginas públicas de imóveis/lançamentos.

Rotas destinadas a N8N ou webhooks não usam o JWT de usuário, mas devem
validar o segredo/tipo de autenticação próprio da integração. Ao criar endpoint
novo, não copiar uma rota pública como modelo para uma operação autenticada.

## 11. Segurança e operação

Controles existentes:

- JWT Supabase validado no backend, com cache curto de 60 segundos;
- `requireUser`, `requireAdmin`, resolução de tenant e checagens de posse;
- RLS e policies nas tabelas migradas, além do filtro explícito do servidor;
- Helmet, HSTS, frame protection, `nosniff` e Permissions-Policy;
- CSP em **report-only**, reportando em `/api/csp-report`;
- `Cache-Control: no-store` em toda `/api`;
- limite global de JSON/urlencoded em 10 MB;
- rate limit em autenticação, checkout, IA e webhooks;
- Redis opcional para rate limit distribuído; sem `REDIS_URL`, o contador é
  local por VM;
- validação Zod em fluxos críticos;
- criptografia AES-256-GCM para chaves OpenRouter/Asaas por tenant;
- Storage privado e URL assinada para documentos de reserva;
- idempotência e reconciliação nos fluxos de cobrança;
- Sentry opcional e retenção de 90 dias dos logs de webhook.

Pendências de segurança/infraestrutura:

- dependências corrigidas em 20/07/2026 com upgrades compatíveis no lockfile e
  `tsx` 4.23.1; `npm audit` online passou com **0 vulnerabilidades**. Repetir o
  audit periodicamente e antes de lançamento;
- observar relatórios reais da CSP e, após QA, decidir a passagem de
  `reportOnly: true` para bloqueio;
- configurar Redis antes de escalar para várias máquinas, ou aceitar
  explicitamente rate limit por VM;
- confirmar rotação, mínimo privilégio e presença de todos os secrets no Fly;
- fazer testes de isolamento com dois tenants reais e titular/membro;
- adicionar uma suíte automatizada de regressão; hoje não há script `test`.

## 12. Jobs em background

| Job | Intervalo | Função |
| --- | --- | --- |
| Follow-Up | 60 s | dispara a sequência configurada |
| Preparação de excedentes | 1 h + boot | prepara cobrança do próximo ciclo |
| Reconciliação financeira | 5 min + boot | reprocessa intenções monetárias pendentes |
| Expiração de reserva PIX | 60 s + boot | libera reservas vencidas e cancela cobrança |
| Retenção de webhook logs | 24 h + boot | remove logs com mais de 90 dias |

Esses jobs rodam dentro de cada processo Express. Antes de aumentar o número de
máquinas, revisar garantias de idempotência e concorrência de todos eles.

## 13. Variáveis de ambiente

### Obrigatórias para o servidor

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_ANON_KEY` no build do frontend
- `APP_URL`

### Por integração

- Asaas: `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`,
  `SUBSCRIPTION_VALUE`, `PLAN_INCLUDED_TICKETS`, `PLAN_OVERAGE_PRICE`;
- limite de produto: `CLIENT_FINANCIAL_OPERATIONS_ENABLED=false` e
  `VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED=false`;
- UAZAPI: `UAZAPI_HOST`, `UAZAPI_TOKEN`, `UAZAPI_PLATFORM_SESSION`;
- N8N/IA: `N8N_WEBHOOK_URL`, `INTERNAL_PROXY_TOKEN`,
  `LLM_PROXY_ENC_KEY`, `OPENROUTER_API_KEY`;
- operação: `REDIS_URL`, `SENTRY_DSN`, `NODE_ENV`.

`server/config.ts` aceita a URL Supabase pública como fallback conhecido, mas
recusa iniciar sem `SUPABASE_SERVICE_ROLE_KEY`. Não criar fallback `VITE_*`
para a service role: prefixos Vite podem ser expostos ao navegador.

## 14. Migrations e estado do banco

Migrations mais recentes confirmadas manualmente no histórico:

| Migration | Estado registrado | Dependência funcional |
| --- | --- | --- |
| `20260716a_billing_reconciliation.sql` | aplicada | reconciliação de billing |
| `20260716b_performance_indexes.sql` | aplicada | índices e retenção |
| `20260716c_reservation_documents.sql` | aplicada | Fase 3 e bucket privado |
| `20260716d_report_period_metrics.sql` | aplicada e verificada | `sold_at`, índice, trigger e Relatórios |
| `20260716e_broker_asaas_key.sql` | aplicada | chave Asaas por conta |
| `20260717_conversation_ticket_cycles.sql` | aplicada e verificada | UUID por ticket e histórico separado por ciclo |
| `20260717b_crm_pipelines.sql` | aplicada | pipelines/etapas do CRM; código dependente (`/api/crm/*`, `PATCH /api/leads/:id/stage`) deployado na release v94 |
| `20260720_crm_pipelines_broker_cascade.sql` | aplicada e verificada | corrige exclusão de conta pelo admin (CASCADE em `imf_crm_pipelines`/`imf_crm_pipeline_stages`) — ver seção 6 |
| `20260720b_crm_security_hardening.sql` | aplicada e verificada | restringe RPCs à `service_role`, valida reorder e torna mutações críticas do CRM transacionais |

A verificação de `20260716d` confirmou coluna, índice e trigger presentes e
zero unidades vendidas sem `sold_at`. A execução manual do SQL não substitui a
checagem do ambiente antes de um novo deploy.

`20260717b_crm_pipelines.sql` foi aplicada manualmente no Supabase da branch
`v2` em 17/07/2026, antes da release v94. O código de criação de lead ainda
degrada com segurança (cai no fluxo antigo, sem pipeline) caso as tabelas do
CRM não existam num ambiente futuro — ver `resolveNewLeadStage` em
`server/services/crmPipelines.ts`.

`20260720_crm_pipelines_broker_cascade.sql` foi aplicada manualmente no
Supabase da branch `v2` em 20/07/2026. Verificada com um teste descartável
(broker + pipeline + etapa criados via service_role, depois `DELETE FROM
imf_brokers` — mesma chamada que `admin.ts` faz): sem erro de FK, e
pipeline/etapa confirmados removidos junto, atomicamente. `DELETE
/api/admin/brokers/:id` está restaurado pra qualquer conta, inclusive as
que já têm pipeline criado.

`20260720b_crm_security_hardening.sql` foi executada manualmente pelo usuário
em 20/07/2026. A consulta pós-migration confirmou as seis funções presentes,
`search_path=public`, cinco RPCs `SECURITY DEFINER`, `EXECUTE=false` para
`anon`/`authenticated`, `EXECUTE=true` para `service_role` nas RPCs e trigger
`trg_imf_sync_lead_pipeline_stage` instalado; todas as seis linhas retornaram
`resultado=OK`. A publicação do código foi autorizada pelo usuário em
20/07/2026 e é rastreada pelo workflow automático da branch `v2`; o QA
funcional do CRM permanece como etapa imediatamente posterior ao deploy. O
arquivo usa `BEGIN`/`COMMIT`: qualquer erro durante a aplicação desfaz o bloco
completo, evitando hardening parcial.

## 15. Pendências e critérios de lançamento

### Bloqueadores antes de credenciais reais

- Confirmar no Fly a `UAZAPI_PLATFORM_SESSION`; sem ela, recuperação de senha
  por WhatsApp não envia mensagem.
- Confirmar secrets de produção de Supabase, UAZAPI, Asaas, webhook Asaas,
  N8N, proxy LLM, criptografia, Sentry e Redis conforme a topologia escolhida.
- Não trocar `ASAAS_ENV`/chaves reais antes do QA completo em sandbox.
- Confirmar qual commit/imagem está efetivamente no app `imobiflow-v2`.

### QA autenticado obrigatório

1. Repetir os fluxos nas três personas: corretor, imobiliária e incorporadora.
2. Usar pelo menos dois tenants e, em um deles, titular + membro.
3. Provar ausência de vazamento em imóveis, leads, agenda, conversas, contatos,
   relatórios, equipe, locação, financeiro, lançamentos e documentos.
4. Validar WhatsApp: autocura, QR, código, disconnect, troca de número,
   compartilhado e instância própria de membro.
5. Validar Assistente IA separado da Config e os três Follow-Ups.
6. Em Conversas, encerrar um ticket e enviar nova mensagem pelo mesmo número;
   confirmar UUID novo, histórico separado e impossibilidade de reabrir ou
   responder no ticket encerrado.
7. Validar Asaas próprio em sandbox: salvar, mascarar, trocar, remover e
   confirmar que aluguel/reserva usam a conta certa; assinatura deve continuar
   na conta global.
8. Validar Lançamentos Fase 3: upload, autorização, URL assinada, rejeição,
   reenvio, aprovação e bloqueio/liberação da venda.
9. Conferir manualmente cada métrica de 3/6/12 meses com dados conhecidos para
   titular e membro.
10. Fazer smoke de `/`, `/app`, login, pagamento, admin, páginas públicas e
   responsividade desktop/mobile.
11. Inspecionar logs, CSP reports, Sentry, jobs e webhooks sem erro.

### Testes funcionais da IA — planejados (roteiro definido em 20/07/2026)

Cenários ponta a ponta pra validar o agente de IA em uso real, ainda não
executados:

- [ ] **Teste 1 — cadastro assistido por IA:** usuário manda fotos e fala a
  descrição do imóvel; o app cadastra o imóvel e gera o site; IA responde
  corretamente perguntas feitas sobre esse imóvel específico.
- [ ] **Teste 2 — atendimento a partir de anúncio:** cliente vê o anúncio,
  pergunta disponibilidade e manda print (imagem) do anúncio; IA precisa
  compreender o print e conduzir o atendimento.
- [ ] **Teste 3 — follow-up:** pedir pra IA lembrar de fazer follow-up, ou
  confirmar que ela mesma dispara sozinha (conforme configuração ativa).

### Checklist técnico por alteração

```powershell
npx knip
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Na branch `v2`, o checklist acima roda **antes do commit**: `git push origin
v2` publica sozinho via GitHub Actions (seção 1), sem revisão manual depois.
Migrations continuam exigindo aplicação manual à parte (nunca automática).
Depois do push: conferir o run em `gh run list --workflow=deploy-v2.yml` (ou
a aba Actions no GitHub) e o smoke HTTP, e guardar release/commit/smoke no
histórico.

## 16. Limpeza de código morto — 2026-07-17

Knip foi adicionado como dependência de desenvolvimento e configurado em
`knip.json` para analisar `server/**/*.ts` e `src/**/*.{ts,tsx}`. As raízes de
entrada continuam descobertas pelos scripts do pacote e pelo Vite.

Remoções de confiança alta, verificadas manualmente:

- arquivo legado `src/lib/supabase.ts`, sem importações;
- dependência `@anthropic-ai/sdk`, sem uso;
- `autoprefixer`, sem configuração PostCSS nem referência;
- cópia duplicada de `vite` em `devDependencies`; a dependência viva foi
  preservada em `dependencies`;
- export público desnecessário de `redisClient`, `verifyAccessToken`,
  `BR_LOCAL_MAX_LEN` e do tipo `User`; todos continuam vivos internamente;
- interface `BrokerSettings`, sem uso real.

O relatório final do Knip ficou limpo. TypeScript, build e whitespace também
passaram após as remoções.

### Itens duvidosos deliberadamente preservados

- `tailwindcss`: o Knip indicou como dependência não usada, mas ela é carregada
  por `@import "tailwindcss"` e pelo plugin `@tailwindcss/vite`;
- routers do Express: alcançados dinamicamente pelo bootstrap;
- páginas lazy do React e áreas selecionadas por string;
- migrations e tabelas históricas;
- Dashboard 1.0 e `AISettings.tsx`/`FollowUpSettings.tsx`;
- campos `zpro_*` ainda existentes no schema/Admin, embora o provisionamento
  ativo seja UAZAPI nativo;
- secrets Z-PRO antigos eventualmente presentes no Fly: são inertes no código,
  mas removê-los é alteração de produção e exige autorização específica.

## 17. Fontes de verdade e manutenção deste documento

Quando houver divergência, use esta ordem:

1. código e migrations da branch que será publicada;
2. schema/secrets efetivamente verificados no ambiente alvo;
3. este documento de estado atual;
4. [HISTORICO_DETALHADO.md](./HISTORICO_DETALHADO.md) para contexto e decisões;
5. demais guias (`README.md`, `HANDOFF.md`, `UX_MASTERPLAN.md` e guias de
   onboarding/workflows), que podem ter escopo específico ou conteúdo antigo.

Após cada mudança funcional, atualize aqui somente a verdade vigente. Registre
passo a passo, incidentes, commits e releases no histórico detalhado, evitando
transformar novamente esta referência em um changelog.
