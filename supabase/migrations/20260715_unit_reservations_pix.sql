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

-- Cria o registro histórico e trava a unidade na mesma transação. O
-- CPF/CNPJ completo nunca chega ao banco: somente os 4 dígitos finais são
-- persistidos; o documento completo existe apenas em memória durante a chamada
-- à Asaas.
CREATE OR REPLACE FUNCTION imf_create_unit_reservation(
  p_broker_id UUID,
  p_unit_id UUID,
  p_created_by_user_id UUID,
  p_request_key UUID,
  p_buyer_name TEXT,
  p_buyer_phone TEXT,
  p_buyer_document_last4 TEXT,
  p_signal_amount_cents BIGINT,
  p_reserved_until TIMESTAMPTZ
)
RETURNS imf_unit_reservations
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_unit imf_units%ROWTYPE;
  v_reservation imf_unit_reservations%ROWTYPE;
BEGIN
  SELECT u.* INTO v_unit
  FROM imf_units u
  JOIN imf_developments d ON d.id = u.development_id
  WHERE u.id = p_unit_id AND d.broker_id = p_broker_id
  FOR UPDATE OF u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidade não encontrada ou acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_unit.status <> 'disponivel' THEN
    RAISE EXCEPTION 'A unidade não está disponível.' USING ERRCODE = '55000';
  END IF;
  IF v_unit.price_cents IS NOT NULL AND v_unit.price_cents > 0
     AND p_signal_amount_cents > v_unit.price_cents THEN
    RAISE EXCEPTION 'O sinal não pode superar o preço da unidade.' USING ERRCODE = '22003';
  END IF;

  INSERT INTO imf_unit_reservations (
    broker_id, unit_id, created_by_user_id, request_key, buyer_name,
    buyer_phone, buyer_document_last4, signal_amount_cents, status,
    reserved_until
  ) VALUES (
    p_broker_id, p_unit_id, p_created_by_user_id, p_request_key,
    btrim(p_buyer_name), NULLIF(btrim(p_buyer_phone), ''),
    p_buyer_document_last4, p_signal_amount_cents, 'creating',
    p_reserved_until
  ) RETURNING * INTO v_reservation;

  UPDATE imf_units SET
    status = 'reservado',
    buyer_name = btrim(p_buyer_name),
    buyer_phone = NULLIF(btrim(p_buyer_phone), ''),
    reserved_until = p_reserved_until,
    updated_at = NOW()
  WHERE id = p_unit_id;

  RETURN v_reservation;
END;
$$;

REVOKE ALL ON FUNCTION imf_create_unit_reservation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION imf_create_unit_reservation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ) TO service_role;
