# Arquitetura — ImobiFlow V2

## Aplicação

- Frontend V2: `src/experience/*`, interface única em `/app`.
- Backend: `server/routes/*.ts` + `server/services/*.ts`; `server.ts` monta os
  routers.
- `DOCUMENTACAO.md` é a referência técnica completa. `HANDOFF.md` descreve a
  arquitetura antiga V1/Z-PRO e não é fonte de verdade da V2.

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

- UAZAPI substituiu integralmente Z-PRO na V2.
- Inbound: `POST /api/wpp-shim/inbound/:instanceId`; mensagens privadas de
  texto, PTT e imagem são persistidas e encaminhadas ao N8N.
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

## Assistente interno do app

- `server/services/agent.ts` atende comandos do corretor dentro do ImobiFlow,
  separado do agente externo de WhatsApp.
- Usa OpenRouter, snapshot autorizado do tenant e ações estruturadas. A
  autonomia do app controla mutações; IDs nunca são inventados.
- Duas ações agendadas: `create_reminder` (lembrete na Agenda existente, sem
  enviar nada) e `schedule_followup` (grava em `imf_agent_scheduled_followups`
  e um job de 60s em `server/services/agentScheduledFollowups.ts` manda o
  WhatsApp real quando o prazo vence). Prazo relativo ("24h", "2 dias") nunca é
  calculado pelo modelo — só número+unidade; o `due_at` é determinístico em
  código.

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
- Push em `v2` executa GitHub Actions: `npm ci`, TypeScript, Knip, build e
  deploy no Fly. `flyctl` local está bloqueado pelo Windows Smart App Control.
