# Estado do projeto

## Fila durável de webhooks publicada (2026-07-21)

- `POST /api/wpp-shim/inbound/:instanceId` não confirma mais antes de guardar
  o evento: autenticação da instância + INSERT na inbox precedem o HTTP 200;
  falha de banco responde 503 para provocar retry da UAZAPI.
- `server/services/inboundWebhookQueue.ts` processa inbox/outbox em batches,
  preserva ordem por conversa, recupera leases após crash, aplica retry com
  backoff e move poison messages para `dead` após o limite de tentativas.
- O payload do N8N foi preservado e ganhou `event_id` estável. Migration:
  `supabase/migrations/20260721b_webhook_inbox_outbox.sql`.
- `npm run lint`, `npm run build` e `git diff --check` aprovados localmente.
- Migration aplicada manualmente e verificada por leitura em 21/07/2026: as
  duas tabelas estão acessíveis pelo backend, vazias e sem itens `dead`.
- Publicado no commit `28de500`; GitHub Actions run `29840243877` aprovou
  TypeScript, Knip, build e deploy Fly. Smoke pós-deploy: `/`, `/login` e
  `/app` HTTP 200; inbox/outbox sem itens `pending`, `processing` ou `dead`.
- Falta o smoke com mensagem real e deduplicar `event_id` no workflow N8N.

## Implementado localmente, aguardando autorização de commit (2026-07-21)

- Duas ações novas no Assistente IA interno (`server/services/agent.ts`):
  `create_reminder` (cria um lembrete em `imf_agenda`, sem enviar nada ao
  cliente — ex.: "me lembre em 48h de fazer follow-up pro fulano") e
  `schedule_followup` (agenda o envio REAL de um WhatsApp pra daqui a
  horas/dias — ex.: "envie em 24h um follow-up pro fulano"), via tabela nova
  `imf_agent_scheduled_followups` + job de 60s em
  `server/services/agentScheduledFollowups.ts` (registrado em `server.ts`).
- Migration `supabase/migrations/20260721_agent_scheduled_followups.sql`
  **aplicada e verificada em 21/07/2026** (tabela, RLS e policy confirmados
  `true` na consulta pós-migration). `create_reminder` funciona
  independentemente (só usa `imf_agenda`, já existente); `schedule_followup`
  já tem a tabela pronta no banco, mas só funciona em produção depois do
  código ser commitado/publicado.
- Validado localmente: `npx tsc --noEmit`, `npx knip`, `npm run build` e
  `git diff --check` aprovados. Sem QA ao vivo (precisa de instância UAZAPI
  real pra confirmar o envio agendado de fato saindo).
- Sem commit/push/deploy — aguardando autorização explícita.

## Concluído e publicado

- CRM substituiu Leads: Kanban + gerenciamento de pipelines/etapas por broker;
  compatibilidade com `leads.status` preservada. Releases iniciais v94/v95.
- Drag-and-drop migrado para `@dnd-kit/core` e confirmado em Android/iPhone.
- Hardening do CRM aplicado e verificado: RPCs transacionais restritas à
  `service_role`, reorder validado, etapa/pipeline inativo bloqueado, UI de
  membro somente leitura e exclusão integral do broker com CASCADE correto.
- Operações financeiras dos clientes desativadas; locação/financeiro exibem
  apenas registros e valores. Asaas continua apenas para assinatura SaaS.
- Correções mobile confirmadas: áudio iOS, seletor de fotos Android e aviso para
  WebView sem suporte.
- Webhook UAZAPI ganhou self-heal ao reconectar instâncias legadas.
- Inbound privado de PTT e imagem implementado: download UAZAPI, transcrição ou
  visão OpenRouter, persistência textual, deduplicação e fallback. Publicado no
  commit `5d096ef`; GitHub Actions run `29781792572` aprovado; `/`, `/login` e
  `/app` retornaram HTTP 200.
- Assistente interno (`server/services/agent.ts`, ação `send_message`) para de
  narrar a própria ação em mensagens ao cliente ("estou fazendo um
  follow-up..."). Regra explícita + exemplo no prompt; validado com chamada
  real ao modelo em `autonomy=manual` (ação só proposta, nunca enviada).
  Publicado no commit `c372ccc`; smoke `/`, `/login`, `/app` HTTP 200.

## Pacote publicado nesta sessão

- Novo `PROMPT-AGENTE-WHATSAPP.md`: respostas de 1–3 frases, uma pergunta por
  vez, linguagem natural e transparente, catálogo tratado como dado, agenda
  protegida e personalização subordinada às regras do produto.
- `GET /api/brokers/:id/agent` passa a priorizar `imf_brokers.ai_name`, definido
  na tela Assistente IA, com fallback para `broker_agents.agent_name` e
  `Juliana`.
- `ai_name` é validado como texto, normalizado e limitado a 60 caracteres.
- `DOCUMENTACAO.md` e os arquivos PMP foram atualizados.
- Validações locais aprovadas: `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`.
- Nenhuma migration criada. Pacote publicado no commit `069db64`; GitHub
  Actions run `29832355248` aprovado; `/`, `/login` e `/app` retornaram HTTP
  200. O N8N não foi alterado porque a instância exige uma sessão autenticada.

## Pendências de QA

- Instalar manualmente o novo prompt no N8N e testar nome/instruções do corretor.
- Testar PTT e imagem novos em conversa privada após o deploy já publicado.
- Confirmar isolamento titular/membro e operações críticas do CRM em produção.
- Validar IA desativada/human takeover e ausência de duplicação/vazamento nos
  logs.

## Limitações conhecidas

- A instância N8N exige sessão autenticada com acesso de edição; instalação do
  prompt permanece manual.
- Vídeo, documento, sticker e mídia de grupos não são processados pelo agente.
- `flyctl` local bloqueado; deploy ocorre pelo GitHub Actions.
- Testes físicos mobile dependem do usuário.
