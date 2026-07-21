-- ============================================================
-- Notificar o corretor quando a IA de atendimento marca uma visita
-- ============================================================
-- Quando o cliente agenda uma visita conversando com a IA no WhatsApp
-- (POST /api/agenda/n8n/create), o corretor não está no loop e precisa ser
-- avisado. Duas vias, escolhidas pelo usuario: badge dentro do app + mensagem
-- de WhatsApp num numero PESSOAL (imf_brokers.notification_phone), separado do
-- numero comercial conectado a instancia UAZAPI — um numero nao consegue
-- notificar a si mesmo de forma confiavel pelo WhatsApp.
--
-- booked_by_chatbot: distingue a visita marcada pela IA de atendimento (N8N)
--   das criadas pelo Assistente IA in-app ou manualmente — as duas ultimas o
--   corretor ja viu na tela, so a do chatbot precisa de aviso. Coluna propria
--   em vez de reaproveitar `source` (que hoje ja usa 'ia' pros dois casos) pra
--   nao mexer nos filtros/relatorios existentes que agrupam por source.
--
-- broker_seen_at: limpa o badge in-app quando o corretor abre a Agenda
--   (POST /api/agenda/visits/mark-chatbot-seen). NULL = ainda nao visto.
--
-- whatsapp_notified_at: one-shot do alerta por WhatsApp — sem isso o job de
--   60s reenviaria a cada tick. Campo proprio, separado de `status`.
--
-- notification_phone: numero pessoal do corretor pra alertas internos. NULL =
--   nao configurado (o job pula o WhatsApp e so o badge in-app cobre).
--
-- NAO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

ALTER TABLE imf_agenda
  ADD COLUMN IF NOT EXISTS booked_by_chatbot BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE imf_agenda
  ADD COLUMN IF NOT EXISTS broker_seen_at TIMESTAMPTZ;

ALTER TABLE imf_agenda
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at TIMESTAMPTZ;

ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS notification_phone TEXT;

-- Indice parcial pro job de alerta: so varre visitas do chatbot ainda nao
-- avisadas por WhatsApp, ordenadas por horario.
CREATE INDEX IF NOT EXISTS idx_imf_agenda_chatbot_unnotified
  ON imf_agenda (scheduled_at)
  WHERE booked_by_chatbot AND whatsapp_notified_at IS NULL;
