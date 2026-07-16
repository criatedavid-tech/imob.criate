-- Reconciliação durável de operações de billing que precisam ser repetidas
-- quando a API do Asaas falha depois de um pagamento confirmado.

CREATE TABLE IF NOT EXISTS imf_billing_reconciliations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id               UUID REFERENCES imf_brokers(id) ON DELETE SET NULL,
  action                  TEXT NOT NULL CHECK (action IN ('reset_subscription_value')),
  asaas_subscription_id   TEXT NOT NULL,
  desired_value           NUMERIC(12, 2) NOT NULL CHECK (desired_value > 0),
  desired_description     TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error              TEXT,
  next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliations_due
  ON imf_billing_reconciliations (next_attempt_at)
  WHERE status = 'pending';

-- Webhooks duplicados não podem enfileirar duas correções iguais em paralelo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_reconciliation_pending_subscription
  ON imf_billing_reconciliations (action, asaas_subscription_id)
  WHERE status = 'pending';

ALTER TABLE imf_billing_reconciliations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'imf_billing_reconciliations'
      AND policyname = 'broker_own_billing_reconciliations'
  ) THEN
    CREATE POLICY "broker_own_billing_reconciliations" ON imf_billing_reconciliations
      FOR ALL
      USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()))
      WITH CHECK (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Somente o backend service_role acessa a fila; o navegador não precisa dela.
REVOKE ALL ON TABLE imf_billing_reconciliations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE imf_billing_reconciliations TO service_role;
