# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; HEAD publicado e sincronizado com `origin/v2`:
  `28de500`.
- **Working tree NÃO está limpo**: pacote local da aba Lembretes (ver seção
  abaixo), ainda sem commit/push/deploy.
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
- leitura via backend confirmou `imf_webhook_inbox` e
  `imf_webhook_outbox` acessíveis, ambas vazias e sem itens `dead`.

## Pacote local pendente: aba Lembretes (2026-07-21)

Nova área `src/experience/LembretesArea.tsx` (3 personas), separada da
Agenda a pedido do usuário: lista `create_reminder` (com concluir/apagar) e
`schedule_followup` (com cancelar enquanto `pending`), hoje sem nenhuma UI.
Precisou de coluna nova `imf_agenda.event_type` (`'visita'|'lembrete'`) pra
impedir que lembrete contaminasse contagens de visita real em 4 lugares
(snapshot do Assistente IA, Relatórios, KPI do Dashboard 1.0, lista do
agente externo de WhatsApp) — todos já filtrados.

Falta, em ordem:

1. Aplicar manualmente `supabase/migrations/20260721c_agenda_event_type.sql`
   no Supabase (sem ela `schedule_followup`/`create_reminder` continuam
   funcionando, mas os NOVOS filtros `.eq('event_type','visita')` quebram —
   a coluna precisa existir antes do deploy deste código).
2. Autorizar commit/push (dispara deploy automático).
3. QA ao vivo: criar um lembrete e um follow-up pela IA, conferir os dois na
   aba Lembretes, concluir/apagar um lembrete, cancelar um follow-up
   pendente, e confirmar que a Agenda (calendário) parou de mostrar
   lembretes.

## Sequência obrigatória (fila de webhooks)

1. Fazer smoke com uma mensagem textual real.
2. Confirmar inbox e outbox em `completed`.
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
