# Arquitetura — ImobiFlow V2

## Organização do projeto

- Frontend V2 vive em `src/experience/*` — interface única `/app`, distinta
  do dashboard legado de V1.
- Backend modularizado em `server/` (rotas em `server/routes/*.ts`,
  serviços em `server/services/*.ts`); `server.ts` na raiz monta os
  routers.
- `DOCUMENTACAO.md` é a referência técnica completa (fonte de verdade
  primária). `HANDOFF.md` existe no repo mas descreve a arquitetura ANTIGA
  (V1, camada Z-PRO, `server.ts` monolítico ~2970 linhas, deploy
  `--app imobiflow`) — está superseded, não usar como referência pro V2.
  Não apagado (decisão do usuário pendente).

## Banco e modelagem

- Supabase Postgres, instância compartilhada com outros projetos do
  usuário — tabelas núcleo do ImobiFlow usam prefixo `imf_` (algumas
  tabelas mistas legadas não têm prefixo).
- `leads.status` (legado, ainda lido por relatórios/IA/integrações) é
  mantido em sincronia automática via trigger com `pipeline_stage_id`
  (nova fonte de verdade do Kanban).
- CRM: `imf_crm_pipelines` (funis por broker, um `is_default` por broker)
  + `imf_crm_pipeline_stages` (etapas ordenadas por `position`,
  `stage_type` open/won/lost). `leads.pipeline_id`/`pipeline_stage_id`
  referenciam essas tabelas.
- FKs de `leads.pipeline_id`/`pipeline_stage_id` para pipelines/etapas SEM
  CASCADE (proposital — nunca apagar lead por causa de tabela associada
  apagada). FKs de `imf_crm_pipeline_stages.pipeline_id` e
  `imf_crm_pipelines.broker_id` COM CASCADE (proposital — apagar o broker
  inteiro deve limpar tudo dele, pipelines incluídos).
- Migrations em `supabase/migrations/*.sql` — nunca executadas
  automaticamente; aplicação manual sempre.

## Autenticação e autorização

- `server/middleware/auth.ts` valida o Bearer token e resolve
  `broker_id`/`user_id` no backend a partir da sessão — nunca aceita
  `broker_id` do payload do cliente como fonte de autorização.
- Isolamento multi-tenant reforçado em cada rota (filtro pelo `broker_id`
  resolvido) + checagem de pertencimento (ex.: etapa pertence ao pipeline
  informado, pipeline pertence ao broker da sessão).
- Contas imobiliária/incorporadora podem ter membros de equipe;
  permissões diferenciam titular/admin vs. membro (ex.: membro só move
  leads que já pode acessar, não administra config de pipeline).

## APIs e integrações

- `/api/crm/*`: CRUD de pipelines e etapas + reorder.
- `/api/leads/*`: CRUD de leads + `PATCH /api/leads/:id/stage` (move no
  Kanban).
- WhatsApp: UAZAPI diretamente — sem camada Z-PRO (eliminada do V2).
  Envio via `POST /send/text` da instância, header
  `token=<API Token da instância>`.
- IA: OpenRouter — agente com ações próprias (`server/services/agent.ts`)
  + transcrição de voz.
- Pagamento: Asaas permanece ativo para assinatura SaaS do próprio ImobiFlow.
  Cobrança financeira de clientes por aluguel/reserva está desativada por
  padrão (`CLIENT_FINANCIAL_OPERATIONS_ENABLED=false` e equivalente Vite); as
  telas operacionais apenas registram e apresentam valores/status enquanto a
  flag estiver desligada.

## Padrões e estratégias adotadas

- Drag-and-drop: `@dnd-kit/core` (não a API nativa HTML5 DnD — sem suporte
  a toque no Safari iOS). `MouseSensor` (distância 8px) + `TouchSensor`
  (delay 200ms / tolerância 8px).
- Toda criação de lead (frontend, API pública, webhook, IA, rotas
  internas) recebe pipeline padrão + primeira etapa ativa atribuídos no
  BACKEND — nunca depende só do frontend.
- Exclusão/arquivamento: nunca apagar silenciosamente um recurso em uso —
  retornar 409 explicando a dependência (ex.: pipeline padrão não pode ser
  excluído sem outro padrão; pipeline/etapa com leads não pode ser
  apagado direto).
- Deploy automático via GitHub Actions a cada push em `v2`, condicionado ao
  job `validate` (`npm ci`, TypeScript, Knip e build). Continua sem gate manual
  após o push; falha técnica impede o job de deploy.
- RPCs `SECURITY DEFINER` do CRM são executáveis somente por `service_role`;
  usuário autenticado opera sempre pelas rotas Express e pelo tenant resolvido
  no backend.
