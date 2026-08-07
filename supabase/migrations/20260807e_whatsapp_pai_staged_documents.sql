-- WhatsApp Pai - Fase 7: documentos como contexto temporario de comando.
-- O arquivo bruto nao e persistido. Somente o texto extraido, limitado no
-- backend, fica disponivel para o proximo comando do mesmo usuario/tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS imf_whatsapp_staged_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 180),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/xml',
    'application/json',
    'application/xml'
  )),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  extracted_text TEXT NOT NULL CHECK (char_length(extracted_text) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_staged_documents_user
  ON imf_whatsapp_staged_documents (user_id, created_at);

ALTER TABLE imf_whatsapp_staged_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON imf_whatsapp_staged_documents FROM anon, authenticated;
GRANT ALL ON imf_whatsapp_staged_documents TO service_role;

COMMIT;
