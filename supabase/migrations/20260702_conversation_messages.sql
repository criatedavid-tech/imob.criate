-- ─── Migração: mensagens de conversa nativas ──────────────────────────────
-- Rodar no Supabase SQL Editor do projeto umvbrahsqvqeondwtikm
--
-- Contexto: o ImobiFlow nunca guardou o texto de nenhuma mensagem de WhatsApp
-- em lugar nenhum. Esta tabela é o
-- primeiro armazenamento de conteúdo real de conversa do ImobiFlow, base tanto
-- da tela "Conversas" e do transporte nativo de WhatsApp.

CREATE TABLE IF NOT EXISTS imf_conversation_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id           UUID NOT NULL REFERENCES imf_brokers(id),
  customer_phone      TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('customer', 'ai', 'broker_manual')),
  body                TEXT,
  media_url           TEXT,
  media_type          TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência contra retry de webhook (UAZAPI reenvia se não receber 200 a tempo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_msg_provider_id
  ON imf_conversation_messages (broker_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Padrão de consulta: lista de conversas (última msg por telefone) + thread de uma conversa
CREATE INDEX IF NOT EXISTS idx_conv_msg_broker_phone_time
  ON imf_conversation_messages (broker_id, customer_phone, created_at DESC);

ALTER TABLE imf_conversation_messages ENABLE ROW LEVEL SECURITY;
-- service_role (backend) ignora RLS — policy é defesa em profundidade, mesmo
-- padrão usado em 20260630_billing_lock_and_rls.sql.
CREATE POLICY "broker_own_conversation_messages" ON imf_conversation_messages
  FOR ALL
  USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));

-- Estado local que suspende follow-up quando o atendimento humano assume.
ALTER TABLE followup_conversations
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'open'
    CHECK (conversation_status IN ('open', 'closed'));

-- Credenciais da instância UAZAPI por corretor.
-- isso (tokenAPI/wabaId); o ImobiFlow nunca precisou saber até agora.
ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token TEXT;
