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
- Smoke real aprovado em 21/07/2026: inbox `completed` em uma tentativa e
  outbox `completed` cerca de 0,3 s depois, sem erro; eco `fromMe` ignorado e
  zero itens `pending`, `processing` ou `dead`. O incidente anterior era a
  URL da UAZAPI ainda apontada ao backend legado; a instância foi corrigida e
  o usuário confirmou a chegada de uma nova mensagem no V2.
- Continua pendente deduplicar `event_id` no workflow N8N.

## Worker separado publicado (2026-07-21)

- Worker da fila separado da API: `webhook-worker.ts` executa inbox/outbox,
  `server.ts` e o endpoint UAZAPI apenas persistem, e o gatilho em memória foi
  removido. `fly.toml` define `web`/`worker`, associa HTTP somente a `web` e
  concede 30 s para desligamento; o worker para novos ciclos e aguarda o ciclo
  ativo por até 25 s. Sem migration e sem alteração no n8n.
- Validações locais aprovadas: `npm run lint`, `npx knip`, `npm run build`,
  parse do `fly.toml` e `git diff --check`.
- Publicado no commit `e42c765`; GitHub Actions run `29852566289` aprovou
  validação e deploy. Smoke `/`, `/login` e `/app` HTTP 200; filas sem itens
  `pending`, `processing` ou `dead`.
- O primeiro rollout criou duas Machines `web` pela HA padrão do Fly. Como os
  schedulers restantes do Express não podem rodar duplicados com segurança, a
  correção local adiciona `--ha=false` e `flyctl scale count web=1` ao workflow.

## Aba Lembretes publicada (2026-07-21)

- Nova aba **Lembretes** na experiência V2 (3 personas), separada da Agenda a
  pedido do usuário (evita misturar visita real com lembrete/follow-up
  agendado na mesma tela): `src/experience/LembretesArea.tsx`, registrada em
  `engine.ts`/`ManualRail.tsx`/`ExperienceShell.tsx` e em `AREAS_BY_PERSONA`
  (`server/services/agent.ts`, pra ação `navigate` reconhecer a área nova).
  Lista os `create_reminder` (agora com "Concluir"/apagar, reaproveitando os
  endpoints já existentes `PATCH`/`DELETE /api/agenda/visits/:id`) e os
  `schedule_followup` (novos endpoints `GET`/`DELETE
  /api/agent/scheduled-followups`, com cancelamento só enquanto `pending`).
- Nova coluna `imf_agenda.event_type` (`'visita'|'lembrete'`, default
  `'visita'`) pra separar de vez lembrete de visita real — sem ela, lembrete
  contaminava "Próximas visitas"/"Visitas neste mês" do Assistente IA,
  Relatórios, o KPI do Dashboard 1.0 e a lista que o agente externo de
  WhatsApp usa pra decidir horário ocupado/livre. Todos os 4 consumidores
  ganharam o filtro `.eq('event_type','visita')`; `create_reminder` passou a
  gravar `event_type:'lembrete'` explicitamente; o resto do código (visitas
  manuais, N8N) não precisou mudar por já cair no `DEFAULT`.
- Migration `supabase/migrations/20260721c_agenda_event_type.sql` aplicada e
  coluna `event_type` verificada por leitura no Supabase.
- Validado localmente: `npx tsc --noEmit`, `npx knip` e `npm run build`
  aprovados. `git diff --check` aprovado.
- Publicada nos commits `a023d78` + `0916b8a`; GitHub Actions run
  `29851172091` aprovado.

## Concluído e publicado

- **Lembrete e follow-up agendado do Assistente IA interno** (`create_reminder`/
  `schedule_followup`, `server/services/agent.ts`): publicado nos commits
  `0e3373b`+`0b4f981`; corrigido no mesmo dia um bug real de fuso (unidade
  "minutos" tratada como "horas" no cálculo do prazo — relatado pelo usuário
  ao vivo, "5 minutos" virou "+5 horas") no commit `7a1db57`+`2378cc3`.
  GitHub Actions runs `29837571160` e `29839683334` aprovados; smoke `/`,
  `/login`, `/app` HTTP 200 nas duas rodadas. Migration
  `20260721_agent_scheduled_followups.sql` aplicada e verificada.

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
