-- WhatsApp Pai: identifica o numero central para que a inbox comercial grave
-- suas respostas como conversa interna, sem encaminha-las para a IA de leads.

BEGIN;

ALTER TABLE public.imf_platform_instances
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

UPDATE public.imf_platform_instances
SET phone_normalized = '556299982218'
WHERE key = 'pai'
  AND phone_normalized IS NULL;

-- Protege imediatamente tickets que ja existiam antes desta migration.
-- O worker tambem reforca ai_active=false em toda nova mensagem do canal.
UPDATE public.imf_conversation_tickets
SET ai_active = FALSE,
    human_takeover_at = COALESCE(human_takeover_at, NOW()),
    updated_at = NOW()
WHERE customer_phone = '556299982218'
  AND ai_active IS DISTINCT FROM FALSE;

COMMIT;
