# Arquitetura — ImobiFlow V2

## Aplicação

- Frontend V2: `src/experience/*`, interface única em `/app`.
- Backend: `server/routes/*.ts` + `server/services/*.ts`; `server.ts` monta os
  routers.
- `DOCUMENTACAO.md` é a referência técnica completa da V2.

## Autenticação e multi-tenant

- `server/middleware/auth.ts` valida o Bearer token e resolve `user_id` e
  `broker_id` no servidor.
- Toda rota com `service_role` aplica filtro de tenant e pertencimento.
- Titular administra configurações e pipelines; membros operam apenas recursos
  permitidos e veem Pipelines em modo leitura.
- RPCs `SECURITY DEFINER` do CRM são exclusivas da `service_role`; clientes
  autenticados acessam as rotas Express.

## Banco e CRM

- Supabase compartilhado; núcleo ImobiFlow usa prefixo `imf_`. Tabelas legadas
  sem prefixo ainda incluem `leads`, `broker_agents`, `followup_config` e
  `webhook_logs`.
- CRM: `imf_crm_pipelines` e `imf_crm_pipeline_stages`; cada broker tem um
  pipeline padrão e etapas ordenadas com `stage_type=open|won|lost`.
- `leads.pipeline_id` e `pipeline_stage_id` são a fonte do Kanban.
  `leads.status`/`closed_at` permanecem sincronizados por trigger para
  relatórios e integrações legadas.
- Pipelines/etapas ligados a leads não são apagados silenciosamente. FKs de
  leads não usam CASCADE; pipelines e etapas usam CASCADE somente na exclusão
  integral do broker.
- Mutações críticas do CRM usam RPCs transacionais; a migration
  `20260720b_crm_security_hardening.sql` está aplicada e verificada.

## WhatsApp e agente externo

- A V2 usa UAZAPI diretamente, sem intermediário de mensagens.
- Inbound: `POST /api/wpp-shim/inbound/:instanceId`; mensagens privadas de
  texto, PTT e imagem são persistidas e encaminhadas ao N8N.
- O inbound confirma a UAZAPI somente depois do INSERT em
  `imf_webhook_inbox`. Claims atômicos com lease processam cada conversa em
  ordem; `imf_webhook_outbox` repassa ao N8N com retry e DLQ. O contrato é
  at-least-once e inclui `event_id` estável para deduplicação no workflow.
- O Fly usa três process groups: `web` executa `server.ts` e recebe HTTP;
  `worker` executa `webhook-worker.ts`, processa inbox/outbox e converte
  áudio/imagem; `scheduler` executa `scheduler-worker.ts` e concentra os jobs
  periódicos. O serviço HTTP é ligado somente a `web`. Claims com
  `SKIP LOCKED` permitem aumentar `worker`; `scheduler` permanece singleton.
- Áudio e imagem são baixados em base64 pela UAZAPI e convertidos em texto pelo
  OpenRouter antes do N8N. Base64/URLs temporárias não são persistidos. Vídeo,
  documento, sticker e mídia de grupos permanecem fora do escopo.
- Falhas multimodais geram fallback; `provider_message_id` evita duplicação.
- O N8N obtém configuração por `GET /api/brokers/:id/agent`, autenticado com
  `INTERNAL_PROXY_TOKEN`.
- Nome público: `imf_brokers.ai_name`; instruções complementares:
  `broker_agents.system_prompt`.
- Prompt padrão versionado: `PROMPT-AGENTE-WHATSAPP.md`. Regras protegidas
  prevalecem sobre personalizações do corretor. A instalação no N8N é manual.
- Ordem de deploy e consultas operacionais: `WEBHOOK_QUEUE_ROLLOUT.md`.

## Assistente interno do app

- `server/services/agent.ts` atende comandos do corretor dentro do ImobiFlow,
  separado do agente externo de WhatsApp.
- Usa OpenRouter e snapshot autorizado do tenant. Regras fixas ficam no
  `system`; snapshot, mensagens de clientes e demais textos variáveis seguem
  num bloco JSON `UNTRUSTED_ACCOUNT_CONTEXT`, separado e limitado.
- A saída do modelo passa por `server/security/agentGuardrails.ts` (Zod
  estrito, sem campos extras). `answer`, `navigate` e `query_agenda` podem
  seguir direto; toda criação, alteração, cancelamento ou envio exige
  confirmação humana, inclusive quando a interface está em modo piloto.
- Duas ações agendadas: `create_reminder` (lembrete em `imf_agenda`, sem
  enviar nada) e `schedule_followup` (grava em `imf_agent_scheduled_followups`
  e um job de 60s em `server/services/agentScheduledFollowups.ts` manda o
  WhatsApp real quando o prazo vence). Prazo relativo ("24h", "2 dias") nunca é
  calculado pelo modelo — só número+unidade; o `due_at` é determinístico em
  código.
- As duas têm tela própria: área **Lembretes** (`src/experience/
  LembretesArea.tsx`, 3 personas), separada da Agenda. `imf_agenda.event_type`
  (`'visita'|'lembrete'`) distingue lembrete de visita real; todo consumidor
  que conta/lista visitas (snapshot do Assistente IA, Relatórios, Dashboard
  1.0, lista do agente externo de WhatsApp) filtra `event_type='visita'`.

## Frontend e mobile

- Kanban usa `@dnd-kit/core`, `MouseSensor` e `TouchSensor`; confirmado em
  Android e iPhone.
- Upload mobile usa `input[type=file]` transparente sobre o ícone, pois cliques
  programáticos e inputs ocultos falham no Chrome Android.
- Transcrição aceita data URL de áudio com base64 válido e deriva o formato do
  conteúdo; não confia no MIME informado pelo navegador.

## Financeiro e deploy

- Asaas cobra apenas a assinatura SaaS.
- Operações financeiras dos clientes ficam desligadas por
  `CLIENT_FINANCIAL_OPERATIONS_ENABLED=false` e flag Vite equivalente; telas
  apenas registram e exibem valores/status.
- Push em `v2` executa GitHub Actions: `npm ci`, testes automatizados,
  TypeScript, Knip, build e
  deploy no Fly. `flyctl` local está bloqueado pelo Windows Smart App Control.
- `PUBLIC_APP_URL=https://imobiflow-v2.fly.dev` é a única origem pública e é
  versionada no `fly.toml`; links e webhooks não dependem de secret de URL.
- A topologia de transição mantém uma Machine `web` (1 GB), uma `worker`
  (1 GB) e uma `scheduler` (512 MB) ativas. O workflow reafirma
  `scheduler=1`. A web permanece em uma instância até teste de carga e Redis
  distribuído; os jobs já não impedem escala horizontal da API.
- `SCALABILITY_TEST_PLAN.md` define baseline, proteção contra carga acidental
  em produção, cenários e critérios para subir de 100 a milhares de contas.
