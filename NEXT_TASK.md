# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; base publicada `5700f81`.
- Working tree contém a limpeza do transporte antigo e a migration aditiva
  exclusiva da V2 já aplicada e verificada no Supabase.
- O n8n não foi acessado nem alterado nesta etapa.

## Ordem obrigatória para concluir a limpeza

1. Validar e publicar o código da working tree.
2. Confirmar produção e o fluxo de uma mensagem real.
3. Executar a busca global final de resíduos.

A migration só adiciona `source_ticket_id` e `claim_due_followups_v2`. A função
e as colunas compartilhadas anteriores permanecem intactas para a V1 congelada.
Aplicada manualmente pelo usuário em 21/07/2026; a inspeção do schema confirmou
as duas colunas neutras e a nova RPC, sem executar o claim.

Os secrets residuais já foram removidos do Fly; o app permaneceu HTTP 200 e o
webhook UAZAPI continuou apontando para o domínio V2.

## Bug crítico encontrado: CRM/Pipelines fora do ar (2026-07-21)

Investigado a partir de um erro relatado pelo usuário na aba Negócios ("Erro
ao carregar pipelines."). Causa: coluna ambígua (42702) em
`imf_crm_ensure_default_pipeline` — `RETURNS TABLE (pipeline_id UUID, ...)`
cria uma variável de saída `pipeline_id`, e uma consulta no corpo da função
referenciava a coluna real de `imf_crm_pipeline_stages` sem alias. Como essa
consulta é a própria condição de um `IF` (roda sempre), a função falhava em
100% das chamadas de `GET /api/crm/pipelines`, pra qualquer broker, desde que
`20260720b_crm_security_hardening.sql` foi aplicada (20/07/2026) — só
percebido agora por falta de QA autenticado ao vivo da tela.

Correção publicada:

- migration `supabase/migrations/20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql`
  aplicada manualmente pelo usuário no Supabase;
- commit `7f25b31` (só a migration — a documentação já tinha entrado junto
  no commit anterior do Codex, `5ff6b00`, por causa da mesma árvore
  compartilhada); GitHub Actions run `29854511196` aprovado;
- smoke `/`, `/login`, `/app` HTTP 200 após o deploy.

## Badge de lembrete vencido no sino; WhatsApp pro corretor adiado (2026-07-21)

Usuário pediu duas formas de alertar sobre lembrete vencido. Implementado só
o badge (`ManualRail.tsx`, `useDueReminderCount` + `RailIcon`, poll de 60s em
`GET /api/agenda/visits?event_type=lembrete` já existente — sem rota nova,
sem migration). `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados.

**Adiado:** alerta por WhatsApp pro número do corretor (`imf_brokers.phone`),
que reaproveitaria `agentScheduledFollowups.ts`. Adiado porque esse arquivo e
todo o transporte WhatsApp estão em refatoração ativa e não commitada do
Codex (seção "Limpeza total do transporte antigo" abaixo) — implementar
agora seria construir sobre uma abstração prestes a mudar de nome/forma.

Pendente: commit/push do badge (mesma fila do CRM — aguardar o Codex
publicar a limpeza de transporte primeiro) e, depois que essa limpeza
publicar, implementar o alerta por WhatsApp reaproveitando o novo
`server/services/uazapi.ts`.

## Pacote publicado: inbox/outbox duráveis

Implementado:

- migration `supabase/migrations/20260721b_webhook_inbox_outbox.sql`;
- serviço `server/services/inboundWebhookQueue.ts`;
- webhook UAZAPI confirma HTTP 200 somente depois do INSERT na inbox;
- falha de persistência retorna 503 para o provedor tentar novamente;
- claim atômico em batch com `FOR UPDATE SKIP LOCKED`;
- lease recuperável depois de crash;
- ordem preservada por corretor + conversa;
- retry com backoff e estado terminal `dead`;
- outbox para o n8n com header/campo `event_id`;
- índices de lookup por `uazapi_instance_id`;
- runbook `WEBHOOK_QUEUE_ROLLOUT.md`.

Validações locais aprovadas:

- `npm run lint`;
- `npx knip`;
- `npm run build`;
- `git diff --check`.

Publicação confirmada:

- commit `28de500` em `v2`;
- GitHub Actions run `29840243877` aprovado (validação + deploy Fly);
- `/`, `/login` e `/app` responderam HTTP 200 após o deploy;
- inbox/outbox sem itens `pending`, `processing` ou `dead` após o deploy.

Banco já preparado:

- migration `20260721b_webhook_inbox_outbox.sql` aplicada manualmente em
  21/07/2026;
- smoke real confirmou inbox/outbox `completed` em uma tentativa, entrega ao
  n8n em cerca de 0,3 s e zero itens `pending`, `processing` ou `dead`.

## Pacote publicado: worker separado (2026-07-21)

- `webhook-worker.ts` executa exclusivamente os ticks da inbox/outbox;
- `server.ts` e `POST /api/wpp-shim/inbound/:instanceId` apenas persistem;
- removido o gatilho em memória que ainda processava a fila na API;
- `fly.toml` define os grupos `web` e `worker`; HTTP pertence somente a `web`;
- `SIGTERM`/`SIGINT` interrompem novos ciclos e drenam o ativo antes de sair;
- TypeScript, Knip, build, TOML e `git diff --check` aprovados localmente;
- nenhuma migration nova e nenhuma alteração no n8n.
- commit `e42c765` e GitHub Actions run `29852566289` aprovados;
- smoke HTTP 200 e filas sem itens problemáticos após o deploy.

Correção publicada: o primeiro rollout criou duas `web` pela HA padrão; o
commit `45b41e0` passou a usar `--ha=false` e reafirmar `web=1`. GitHub Actions
run `29853031218` aprovado e uma Machine web removida. Topologia final: uma
`web` ativa, uma `worker` ativa e uma standby parada do worker. Smoke HTTP 200
e filas sem itens problemáticos.

## Pacote publicado: aba Lembretes (2026-07-21)

Nova área `src/experience/LembretesArea.tsx` (3 personas), separada da
Agenda a pedido do usuário: lista `create_reminder` (com concluir/apagar) e
`schedule_followup` (com cancelar enquanto `pending`), hoje sem nenhuma UI.
Precisou de coluna nova `imf_agenda.event_type` (`'visita'|'lembrete'`) pra
impedir que lembrete contaminasse contagens de visita real em 4 lugares
(snapshot do Assistente IA, Relatórios, KPI do Dashboard 1.0, lista do
agente externo de WhatsApp) — todos já filtrados.

Publicação confirmada:

- migration `20260721c_agenda_event_type.sql` aplicada e coluna verificada;
- código `a023d78` e documentação `0916b8a` publicados;
- GitHub Actions run `29851172091` aprovado.

Falta apenas QA ao vivo: criar um lembrete e um follow-up pela IA, conferir os
dois na aba Lembretes, concluir/apagar um lembrete, cancelar um follow-up
pendente e confirmar que a Agenda não mostra lembretes.

## Sequência obrigatória (fila de webhooks)

1. **Concluído:** fazer smoke com uma mensagem textual real.
2. **Concluído:** confirmar inbox e outbox em `completed` e fila sem erros.
3. Reenviar o mesmo evento e confirmar ausência de mensagem duplicada.
4. Interromper/reiniciar um worker durante o processamento e confirmar
   recuperação do lease.
5. Implementar no workflow n8n deduplicação pelo `event_id` antes de qualquer
   envio ou mutação externa.

## Critério de conclusão desta etapa

- Nenhum ACK antes da persistência.
- Nenhuma mensagem duplicada no banco.
- Falha temporária do n8n mantém a outbox pendente e recuperável.
- Eventos que excedem o limite de tentativas aparecem em `dead`.
- Métricas/consultas mostram que a fila volta a zero após o smoke.
- Rollback não exige apagar inbox/outbox.

## Evolução seguinte

Depois de validar esta entrega:

1. repetir o smoke com uma nova mensagem real após a separação do worker;
2. implementar métricas e alertas de idade da fila/DLQ;
3. substituir polling da tela Conversas por Realtime/SSE;
4. configurar n8n em queue mode e dimensionar workers com teste de carga;
5. executar cenários de 2, 10 e 50 mensagens por segundo;
6. retirar os schedulers restantes de `server.ts` antes de escalar `web`.

## Pendências anteriores que permanecem

- Instalar manualmente o prompt vigente de `PROMPT-AGENTE-WHATSAPP.md` no n8n.
- Fazer QA de nome, instruções personalizadas, agenda, PTT e imagem.
- Confirmar isolamento titular/membro e human takeover em produção.
