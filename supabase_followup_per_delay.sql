-- ─── Migração: delay por follow ────────────────────────────────────────────
-- Rodar no Supabase SQL Editor do projeto umvbrahsqvqeondwtikm
--
-- ⚠️ HISTÓRICO — a função claim_due_followups() abaixo NÃO é mais a versão
-- que está rodando no banco. Em algum momento após esta migração, a função
-- foi recriada diretamente no Supabase com uma melhoria (Follow 2/3 contam
-- o atraso a partir de follow_sent_at, não de last_customer_message_at) que
-- nunca voltou pra este arquivo. Não rode este arquivo de novo — ele
-- regrediria essa melhoria. Fonte de verdade atual: 20260702_fix_claim_due_followups.sql
-- (auditoria de schema em 2026-07-02, ver DOCUMENTACAO.md §14.14).

-- 1. Adicionar colunas de delay individuais
ALTER TABLE followup_config
  ADD COLUMN IF NOT EXISTS delay_minutes_1 integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS delay_minutes_2 integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS delay_minutes_3 integer NOT NULL DEFAULT 1440;

-- 2. Migrar dados existentes (copia delay_minutes antigo para os 3 novos)
UPDATE followup_config
SET
  delay_minutes_1 = COALESCE(delay_minutes, 30),
  delay_minutes_2 = COALESCE(delay_minutes, 120),
  delay_minutes_3 = COALESCE(delay_minutes, 1440)
WHERE delay_minutes_1 = 30 AND delay_minutes_2 = 120 AND delay_minutes_3 = 1440;

-- 3. Recriar a RPC claim_due_followups com delay por índice
--    Lógica: cada follow usa seu próprio delay contado a partir de
--    last_customer_message_at (= momento em que o cliente parou de responder).
CREATE OR REPLACE FUNCTION claim_due_followups()
RETURNS TABLE (
  conversation_id uuid,
  broker_id       uuid,
  customer_phone  text,
  message_index   int,
  message         text,
  zpro_api_url    text,
  zpro_api_token  text
)
LANGUAGE sql
AS $$
  WITH claimed AS (
    UPDATE followup_conversations fc_upd
    SET
      follow_sent       = true,
      follow_sent_at    = now(),
      follow_message_index = fc_upd.follow_message_index + 1,
      updated_at        = now()
    WHERE fc_upd.id IN (
      SELECT fc.id
      FROM followup_conversations fc
      JOIN followup_config cfg ON cfg.broker_id = fc.broker_id
      WHERE
        fc.follow_sent          = false
        AND fc.ai_active        = true
        AND fc.follow_message_index < 3
        AND cfg.enabled         = true
        AND (
          (fc.follow_message_index = 0
            AND fc.last_customer_message_at + (cfg.delay_minutes_1 * INTERVAL '1 minute') <= now())
          OR
          (fc.follow_message_index = 1
            AND fc.last_customer_message_at + (cfg.delay_minutes_2 * INTERVAL '1 minute') <= now())
          OR
          (fc.follow_message_index = 2
            AND fc.last_customer_message_at + (cfg.delay_minutes_3 * INTERVAL '1 minute') <= now())
        )
      FOR UPDATE SKIP LOCKED
    )
    RETURNING fc_upd.*
  )
  SELECT
    c.id               AS conversation_id,
    c.broker_id,
    c.customer_phone,
    c.follow_message_index AS message_index,
    CASE c.follow_message_index
      WHEN 1 THEN cfg.message_1
      WHEN 2 THEN cfg.message_2
      WHEN 3 THEN cfg.message_3
    END                AS message,
    b.zpro_api_url,
    b.zpro_api_token
  FROM claimed c
  JOIN followup_config cfg ON cfg.broker_id = c.broker_id
  JOIN imf_brokers b       ON b.id = c.broker_id;
$$;
