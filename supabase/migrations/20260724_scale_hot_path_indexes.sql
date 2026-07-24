-- ── Índices de escala (auditoria de carga 2026-07-24) ───────────────────────
-- Já aplicado no projeto Supabase; versionado aqui para reprodutibilidade.
--
-- 1) FILAS: claim_imf_webhook_inbox/outbox ordenam por (created_at, id), mas o
-- único índice utilizável liderava por next_attempt_at. Sem casar com o
-- ORDER BY, o Postgres materializava e ORDENAVA todo o backlog a cada tick — o
-- LIMIT 10 não comprava nada. Isso criava espiral: backlog maior -> claim mais
-- lento -> drena menos -> backlog maior, sem recuperação automática.
create index if not exists idx_imf_webhook_inbox_fifo
  on public.imf_webhook_inbox (created_at, id)
  where status in ('pending', 'processing');

create index if not exists idx_imf_webhook_outbox_fifo
  on public.imf_webhook_outbox (created_at, id)
  where status in ('pending', 'processing');

-- 2) broker_id é o filtro mais usado do app; o Postgres não cria índice de FK
-- sozinho e nenhuma migration anterior havia adicionado nestas duas tabelas.
create index if not exists idx_properties_broker
  on public.imf_properties (broker_id);

create index if not exists idx_leads_broker
  on public.leads (broker_id);

-- 3) A dedupe de lead a partir da conversa filtra primeiro por telefone.
create index if not exists idx_leads_phone
  on public.leads (phone);

-- 4) Lista de conversas: ORDER BY created_at DESC escopado ao broker.
create index if not exists idx_conv_msg_broker_time
  on public.imf_conversation_messages (broker_id, created_at desc);

-- 5) Backfill de mídia não filtra por broker_id, então nenhum índice existente
-- servia — era full scan a cada 30 min.
create index if not exists idx_conv_msg_media_pending
  on public.imf_conversation_messages (created_at desc)
  where direction = 'in' and media_url is null;

-- 6) Billing conta tickets por período.
create index if not exists idx_ticket_events_broker_time
  on public.imf_ticket_events (broker_id, created_at);

-- 7) Alerta de lembrete roda a cada 60s sem broker_id no filtro.
create index if not exists idx_agenda_alert_pending
  on public.imf_agenda (scheduled_at)
  where event_type = 'lembrete' and status = 'pendente' and whatsapp_alert_sent_at is null;
