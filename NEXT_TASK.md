# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; HEAD publicado e sincronizado com `origin/v2`:
  `e42c765`.
- **Working tree NÃO está limpo**: correção do workflow para manter `web=1` e
  suas atualizações documentais permanecem locais.
- O n8n não foi acessado nem alterado nesta etapa.

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

Correção pendente: o primeiro rollout criou duas `web` pela HA padrão. Publicar
o workflow local que usa `--ha=false` e reafirma `web=1`, pois os schedulers
legados do Express ainda não podem rodar em duas Machines.

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

1. publicar e validar o process group de worker já implementado localmente;
2. implementar métricas e alertas de idade da fila/DLQ;
3. substituir polling da tela Conversas por Realtime/SSE;
4. configurar n8n em queue mode e dimensionar workers com teste de carga;
5. executar cenários de 2, 10 e 50 mensagens por segundo;
6. retirar os schedulers restantes de `server.ts` antes de escalar `web`.

## Pendências anteriores que permanecem

- Instalar manualmente o prompt vigente de `PROMPT-AGENTE-WHATSAPP.md` no n8n.
- Fazer QA de nome, instruções personalizadas, agenda, PTT e imagem.
- Confirmar isolamento titular/membro e human takeover em produção.
