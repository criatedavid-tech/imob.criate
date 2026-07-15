-- Lançamentos — histórico de reservas e sinal via PIX/Asaas.
-- A unidade mantém somente o estado atual; cada tentativa financeira fica nesta
-- tabela para auditoria, idempotência e processamento de webhook.

CREATE TABLE IF NOT EXISTS imf_unit_reservations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id             UUID NOT NULL REFERENCES imf_brokers(id),
  unit_id               UUID NOT NULL REFERENCES imf_units(id),
  created_by_user_id    UUID NOT NULL,
  request_key           UUID NOT NULL,
  buyer_name            TEXT NOT NULL,
  buyer_phone           TEXT,
  buyer_document_last4  TEXT NOT NULL CHECK (buyer_document_last4 ~ '^\d{4}$'),
  -- Compatibilidade de schema: contém somente 7 zeros + os 4 dígitos finais,
  -- nunca o CPF/CNPJ real. Pode ser removida numa migração futura controlada.
  buyer_cpf_cnpj        TEXT NOT NULL CHECK (buyer_cpf_cnpj ~ '^0{7}\d{4}$'),
  signal_amount_cents   BIGINT NOT NULL CHECK (signal_amount_cents > 0),
  status                TEXT NOT NULL DEFAULT 'creating' CHECK (status IN (
                          'creating', 'pending', 'paid', 'overdue',
                          'payment_failed', 'cancelled', 'expired',
                          'completed', 'refunded'
                        )),
  reserved_until        TIMESTAMPTZ,
  asaas_customer_id     TEXT,
  asaas_payment_id      TEXT UNIQUE,
  due_date              DATE,
  pix_qr_code           TEXT,
  pix_copy_paste        TEXT,
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broker_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_unit_reservations_broker_created
  ON imf_unit_reservations (broker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_reservations_unit_created
  ON imf_unit_reservations (unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_reservations_asaas_payment
  ON imf_unit_reservations (asaas_payment_id);

-- Uma unidade não pode ter duas reservas financeiras ativas ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_reservations_one_active_per_unit
  ON imf_unit_reservations (unit_id)
  WHERE status IN ('creating', 'pending', 'paid', 'overdue', 'payment_failed');

ALTER TABLE imf_unit_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'imf_unit_reservations'
      AND policyname = 'broker_own_unit_reservations'
  ) THEN
    CREATE POLICY "broker_own_unit_reservations" ON imf_unit_reservations
      FOR ALL
      USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()))
      WITH CHECK (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));
  END IF;
END $$;

-- O backend usa service_role e aplica isolamento/autorização antes de cada
-- operação. Não há acesso direto do navegador a esta tabela.
REVOKE ALL ON TABLE imf_unit_reservations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE imf_unit_reservations TO service_role;
