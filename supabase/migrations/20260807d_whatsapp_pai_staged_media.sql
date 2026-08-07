-- Fase 5 do WhatsApp Pai: staging de fotos enviadas antes do texto descritivo
-- do imóvel (mesmo papel do array em memória no navegador, CommandBar.tsx,
-- só que persistido — o WhatsApp entrega cada foto como uma mensagem
-- separada, sem estado de sessão entre elas).

CREATE TABLE IF NOT EXISTS imf_whatsapp_staged_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id  UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_staged_media_user
  ON imf_whatsapp_staged_media (user_id, created_at);

ALTER TABLE imf_whatsapp_staged_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON imf_whatsapp_staged_media FROM anon, authenticated;
GRANT ALL ON imf_whatsapp_staged_media TO service_role;
