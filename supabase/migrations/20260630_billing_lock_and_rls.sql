-- ============================================================
-- 1. LOCK DISTRIBUÍDO PARA prepareOverageBilling
--    Evita cobrança duplicada quando o Fly sobe 2+ máquinas
-- ============================================================

CREATE TABLE IF NOT EXISTS imf_billing_lock (
  lock_key   TEXT PRIMARY KEY,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Adquire lock atomicamente (DELETE expirado + INSERT ON CONFLICT)
-- Retorna TRUE se adquiriu, FALSE se outro processo já tem o lock.
CREATE OR REPLACE FUNCTION try_billing_lock(p_key TEXT DEFAULT 'billing_prep', p_ttl_seconds INT DEFAULT 7200)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  inserted_rows INT;
BEGIN
  DELETE FROM imf_billing_lock WHERE lock_key = p_key AND expires_at < NOW();

  INSERT INTO imf_billing_lock (lock_key, acquired_at, expires_at)
  VALUES (p_key, NOW(), NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  RETURN inserted_rows > 0;
END;
$$;

-- Libera o lock
CREATE OR REPLACE FUNCTION release_billing_lock(p_key TEXT DEFAULT 'billing_prep')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM imf_billing_lock WHERE lock_key = p_key;
END;
$$;

-- ============================================================
-- 2. SAFETY NET: UNIQUE em imf_overage_charges por ciclo
--    Garante que mesmo se o lock falhar, não haverá 2 linhas
--    para o mesmo corretor no mesmo ciclo de billing.
-- ============================================================

ALTER TABLE imf_overage_charges
  ADD CONSTRAINT IF NOT EXISTS uq_overage_broker_period
  UNIQUE (broker_id, billing_period_end);

-- ============================================================
-- 3. RLS NAS TABELAS DE TENANT (rede de segurança)
--    O backend usa service_role (ignora RLS), mas o RLS protege
--    contra acesso direto via anon/frontend.
-- ============================================================

-- imf_properties
ALTER TABLE imf_properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_own_properties" ON imf_properties;
CREATE POLICY "broker_own_properties" ON imf_properties
  USING (broker_id = (
    SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
  ));

-- imf_agenda
ALTER TABLE imf_agenda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_own_agenda" ON imf_agenda;
CREATE POLICY "broker_own_agenda" ON imf_agenda
  USING (broker_id = (
    SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
  ));

-- imf_overage_charges
ALTER TABLE imf_overage_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_own_charges" ON imf_overage_charges;
CREATE POLICY "broker_own_charges" ON imf_overage_charges
  USING (broker_id = (
    SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
  ));

-- imf_ticket_adjustments (se existir)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'imf_ticket_adjustments') THEN
    ALTER TABLE imf_ticket_adjustments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "broker_own_adjustments" ON imf_ticket_adjustments;
    CREATE POLICY "broker_own_adjustments" ON imf_ticket_adjustments
      USING (broker_id = (
        SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
      ));
  END IF;
END $$;

-- followup_conversations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'followup_conversations') THEN
    ALTER TABLE followup_conversations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "broker_own_followups" ON followup_conversations;
    CREATE POLICY "broker_own_followups" ON followup_conversations
      USING (broker_id = (
        SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
      ));
  END IF;
END $$;
