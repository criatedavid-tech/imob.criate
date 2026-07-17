-- Ciclos reais de atendimento: cada reabertura após encerramento recebe UUID próprio.
-- followup_conversations continua sendo o estado operacional atual por telefone;
-- imf_conversation_tickets preserva todos os tickets, inclusive os encerrados.

BEGIN;

CREATE TABLE IF NOT EXISTS imf_conversation_tickets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id              UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  customer_phone         TEXT NOT NULL,
  conversation_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (conversation_status IN ('pending', 'open', 'closed')),
  ai_active              BOOLEAN NOT NULL DEFAULT TRUE,
  human_takeover_at      TIMESTAMPTZ,
  queue_id               UUID REFERENCES imf_queues(id) ON DELETE SET NULL,
  assigned_user_id       UUID,
  instance_owner_user_id UUID,
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at              TIMESTAMPTZ,
  last_activity_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_ticket_active_phone
  ON imf_conversation_tickets (broker_id, customer_phone)
  WHERE conversation_status IN ('pending', 'open');

CREATE INDEX IF NOT EXISTS idx_conversation_tickets_broker_activity
  ON imf_conversation_tickets (broker_id, last_activity_at DESC);

ALTER TABLE imf_conversation_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_members_own_conversation_tickets" ON imf_conversation_tickets;
DROP POLICY IF EXISTS "broker_owner_conversation_tickets" ON imf_conversation_tickets;
CREATE POLICY "broker_owner_conversation_tickets" ON imf_conversation_tickets
  FOR ALL
  USING (
    broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid())
  );

ALTER TABLE followup_conversations
  ADD COLUMN IF NOT EXISTS ticket_id UUID;

UPDATE followup_conversations
SET ticket_id = gen_random_uuid()
WHERE ticket_id IS NULL;

INSERT INTO imf_conversation_tickets (
  id, broker_id, customer_phone, conversation_status, ai_active,
  human_takeover_at, queue_id, assigned_user_id, instance_owner_user_id,
  opened_at, closed_at, last_activity_at, created_at, updated_at
)
SELECT
  ticket_id,
  broker_id,
  customer_phone,
  conversation_status,
  COALESCE(ai_active, TRUE),
  human_takeover_at,
  queue_id,
  assigned_user_id,
  instance_owner_user_id,
  COALESCE(last_customer_message_at, updated_at, NOW()),
  CASE WHEN conversation_status = 'closed' THEN COALESCE(updated_at, NOW()) END,
  COALESCE(last_customer_message_at, updated_at, NOW()),
  COALESCE(updated_at, NOW()),
  COALESCE(updated_at, NOW())
FROM followup_conversations
ON CONFLICT (id) DO NOTHING;

-- Sem DEFAULT proposital: o UUID precisa nascer primeiro em
-- imf_conversation_tickets. Isso também mantém compatibilidade durante a
-- janela entre a aplicação manual desta migration e o deploy do backend novo.

-- Telefones que têm conteúdo antigo, mas não possuem estado em
-- followup_conversations, recebem um ticket histórico encerrado.
WITH orphan_phones AS (
  SELECT broker_id, customer_phone FROM imf_conversation_messages
  UNION
  SELECT broker_id, customer_phone FROM imf_conversation_tag_links
  UNION
  SELECT broker_id, customer_phone FROM imf_conversation_notes
)
INSERT INTO imf_conversation_tickets (
  broker_id, customer_phone, conversation_status, ai_active,
  opened_at, closed_at, last_activity_at
)
SELECT p.broker_id, p.customer_phone, 'closed', FALSE, NOW(), NOW(), NOW()
FROM orphan_phones p
WHERE NOT EXISTS (
  SELECT 1 FROM imf_conversation_tickets t
  WHERE t.broker_id = p.broker_id AND t.customer_phone = p.customer_phone
);

ALTER TABLE imf_conversation_messages
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES imf_conversation_tickets(id) ON DELETE SET NULL;

UPDATE imf_conversation_messages m
SET ticket_id = (
  SELECT t.id
  FROM imf_conversation_tickets t
  WHERE t.broker_id = m.broker_id AND t.customer_phone = m.customer_phone
  ORDER BY t.last_activity_at DESC, t.created_at DESC
  LIMIT 1
)
WHERE m.ticket_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_messages_ticket_time
  ON imf_conversation_messages (ticket_id, created_at DESC);

ALTER TABLE imf_conversation_tag_links
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES imf_conversation_tickets(id) ON DELETE CASCADE;

UPDATE imf_conversation_tag_links l
SET ticket_id = (
  SELECT t.id
  FROM imf_conversation_tickets t
  WHERE t.broker_id = l.broker_id AND t.customer_phone = l.customer_phone
  ORDER BY t.last_activity_at DESC, t.created_at DESC
  LIMIT 1
)
WHERE l.ticket_id IS NULL;

ALTER TABLE imf_conversation_tag_links
  DROP CONSTRAINT IF EXISTS imf_conversation_tag_links_pkey;
ALTER TABLE imf_conversation_tag_links
  ALTER COLUMN ticket_id SET NOT NULL;
ALTER TABLE imf_conversation_tag_links
  ADD CONSTRAINT imf_conversation_tag_links_pkey PRIMARY KEY (ticket_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tag_links_ticket
  ON imf_conversation_tag_links (ticket_id);

ALTER TABLE imf_conversation_notes
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES imf_conversation_tickets(id) ON DELETE CASCADE;

UPDATE imf_conversation_notes n
SET ticket_id = (
  SELECT t.id
  FROM imf_conversation_tickets t
  WHERE t.broker_id = n.broker_id AND t.customer_phone = n.customer_phone
  ORDER BY t.last_activity_at DESC, t.created_at DESC
  LIMIT 1
)
WHERE n.ticket_id IS NULL;

ALTER TABLE imf_conversation_notes
  ALTER COLUMN ticket_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_notes_ticket
  ON imf_conversation_notes (ticket_id, created_at);

COMMIT;
