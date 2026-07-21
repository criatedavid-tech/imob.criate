# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; HEAD publicado e sincronizado com `origin/v2`:
  `2378cc3`.
- Working tree não está limpo: contém a primeira etapa da evolução de
  escalabilidade, ainda sem commit/push/deploy.
- O n8n não foi acessado nem alterado nesta etapa.

## Pacote local: inbox/outbox duráveis

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
- `npm run build`;
- `git diff --check`.

Banco já preparado:

- migration `20260721b_webhook_inbox_outbox.sql` aplicada manualmente em
  21/07/2026;
- leitura via backend confirmou `imf_webhook_inbox` e
  `imf_webhook_outbox` acessíveis, ambas vazias e sem itens `dead`.

## Sequência obrigatória

1. Revisar o diff local.
2. Autorizar commit/push/deploy do backend; a migration já foi aplicada.
3. Fazer smoke com uma mensagem textual real.
4. Confirmar inbox e outbox em `completed`.
5. Reenviar o mesmo evento e confirmar ausência de mensagem duplicada.
6. Interromper/reiniciar um worker durante o processamento e confirmar
   recuperação do lease.
7. Implementar no workflow n8n deduplicação pelo `event_id` antes de qualquer
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

1. mover os ticks para um process group de workers separado da API;
2. retirar áudio/imagem do processo web;
3. substituir polling da tela Conversas por Realtime/SSE;
4. implementar métricas e alertas de idade da fila;
5. configurar n8n em queue mode e dimensionar workers com teste de carga;
6. executar cenários de 2, 10 e 50 mensagens por segundo.

## Pendências anteriores que permanecem

- Instalar manualmente o prompt vigente de `PROMPT-AGENTE-WHATSAPP.md` no n8n.
- Fazer QA de nome, instruções personalizadas, agenda, PTT e imagem.
- Confirmar isolamento titular/membro e human takeover em produção.
