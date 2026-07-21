-- Preparação aditiva e isolada para a V2.
-- Aplicar manualmente ANTES do deploy do código que lê source_ticket_id.
-- É aditiva e compatível com a versão atualmente publicada.

BEGIN;

ALTER TABLE public.followup_conversations
  ADD COLUMN IF NOT EXISTS source_ticket_id TEXT;

UPDATE public.followup_conversations
SET source_ticket_id = zpro_ticket_id
WHERE source_ticket_id IS NULL
  AND zpro_ticket_id IS NOT NULL;

ALTER TABLE public.imf_ticket_events
  ADD COLUMN IF NOT EXISTS source_ticket_id TEXT;

UPDATE public.imf_ticket_events
SET source_ticket_id = zpro_ticket_id
WHERE source_ticket_id IS NULL
  AND zpro_ticket_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS imf_ticket_events_broker_source_ticket_uidx
  ON public.imf_ticket_events (broker_id, source_ticket_id);

-- A V2 recebe uma RPC própria. A função compartilhada permanece intacta para
-- que a V1 congelada continue operando sem alteração de contrato.
CREATE OR REPLACE FUNCTION public.claim_due_followups_v2()
RETURNS TABLE (
  conversation_id UUID,
  broker_id UUID,
  customer_phone TEXT,
  message_index INTEGER,
  message TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH claimed AS (
    UPDATE public.followup_conversations AS fc_upd
    SET
      follow_sent = TRUE,
      follow_sent_at = now(),
      follow_message_index = fc_upd.follow_message_index + 1,
      updated_at = now()
    WHERE fc_upd.id IN (
      SELECT fc.id
      FROM public.followup_conversations AS fc
      JOIN public.followup_config AS cfg ON cfg.broker_id = fc.broker_id
      WHERE fc.follow_sent = FALSE
        AND fc.ai_active = TRUE
        AND fc.follow_message_index < 3
        AND cfg.enabled = TRUE
        AND (
          (
            fc.follow_message_index = 0
            AND fc.last_customer_message_at
              + (cfg.delay_minutes_1 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 1
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_2 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 2
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_3 * INTERVAL '1 minute') <= now()
          )
        )
      FOR UPDATE SKIP LOCKED
    )
    RETURNING fc_upd.*
  )
  SELECT
    claimed.id AS conversation_id,
    claimed.broker_id,
    claimed.customer_phone,
    claimed.follow_message_index AS message_index,
    CASE claimed.follow_message_index
      WHEN 1 THEN cfg.message_1
      WHEN 2 THEN cfg.message_2
      WHEN 3 THEN cfg.message_3
    END AS message
  FROM claimed
  JOIN public.followup_config AS cfg ON cfg.broker_id = claimed.broker_id;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_followups_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_followups_v2() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
