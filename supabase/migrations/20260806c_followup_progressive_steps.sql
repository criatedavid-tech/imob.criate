-- Follow-Up Inteligente: de 3 passos fixos para até 8 configuráveis.
-- 100% aditivo — ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE só na RPC
-- _v2 (a V1, sem sufixo, não é tocada e continua limitada a 3 passos).
-- Aplicar manualmente no SQL Editor do Supabase.

BEGIN;

ALTER TABLE public.followup_config
  ADD COLUMN IF NOT EXISTS follow_count INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS delay_minutes_4 INTEGER,
  ADD COLUMN IF NOT EXISTS delay_minutes_5 INTEGER,
  ADD COLUMN IF NOT EXISTS delay_minutes_6 INTEGER,
  ADD COLUMN IF NOT EXISTS delay_minutes_7 INTEGER,
  ADD COLUMN IF NOT EXISTS delay_minutes_8 INTEGER,
  ADD COLUMN IF NOT EXISTS message_4 TEXT,
  ADD COLUMN IF NOT EXISTS message_5 TEXT,
  ADD COLUMN IF NOT EXISTS message_6 TEXT,
  ADD COLUMN IF NOT EXISTS message_7 TEXT,
  ADD COLUMN IF NOT EXISTS message_8 TEXT;

ALTER TABLE public.followup_config
  DROP CONSTRAINT IF EXISTS followup_config_follow_count_check;
ALTER TABLE public.followup_config
  ADD CONSTRAINT followup_config_follow_count_check CHECK (follow_count BETWEEN 1 AND 8);

-- A V2 já tinha RPC própria. A função V1 (sem sufixo, só existe no
-- Supabase) permanece intacta e continua limitada a 3 passos.
-- DROP antes do CREATE: a assinatura de retorno mudou (ganhou follow_count),
-- e o Postgres não deixa CREATE OR REPLACE trocar o tipo de retorno de uma
-- função existente (erro 42P13). Está dentro da mesma transação da migration,
-- então não existe uma janela em que a função "some" para outras conexões.
DROP FUNCTION IF EXISTS public.claim_due_followups_v2();

CREATE FUNCTION public.claim_due_followups_v2()
RETURNS TABLE (
  conversation_id UUID,
  broker_id UUID,
  customer_phone TEXT,
  message_index INTEGER,
  message TEXT,
  follow_count INTEGER
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
        AND fc.follow_message_index < cfg.follow_count
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
          OR (
            fc.follow_message_index = 3
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_4 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 4
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_5 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 5
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_6 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 6
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_7 * INTERVAL '1 minute') <= now()
          )
          OR (
            fc.follow_message_index = 7
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at
              + (cfg.delay_minutes_8 * INTERVAL '1 minute') <= now()
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
      WHEN 4 THEN cfg.message_4
      WHEN 5 THEN cfg.message_5
      WHEN 6 THEN cfg.message_6
      WHEN 7 THEN cfg.message_7
      WHEN 8 THEN cfg.message_8
    END AS message,
    cfg.follow_count
  FROM claimed
  JOIN public.followup_config AS cfg ON cfg.broker_id = claimed.broker_id;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_followups_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_followups_v2() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
