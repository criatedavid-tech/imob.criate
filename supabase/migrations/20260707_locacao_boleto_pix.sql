-- Cobrança real de aluguel (boleto/PIX via Asaas), mesmo padrão já usado pela
-- assinatura do ImobiFlow (server/services/billing.ts). Destrava, pela
-- primeira vez, um sinal real de pagamento — a base pra inadimplência de
-- verdade em Financeiro (Etapa 8) e boletos em Locação (Etapa 6).

-- Asaas exige CPF/CNPJ pra criar cliente — contrato antigo não tinha esse
-- campo porque não cobrava de verdade ainda.
ALTER TABLE imf_rental_contracts
  ADD COLUMN IF NOT EXISTS tenant_cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

CREATE TABLE IF NOT EXISTS imf_rental_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       UUID NOT NULL REFERENCES imf_rental_contracts(id) ON DELETE CASCADE,
  reference_month   DATE NOT NULL, -- sempre dia 1 do mês cobrado
  asaas_payment_id  TEXT,
  billing_type      TEXT NOT NULL DEFAULT 'BOLETO',
  amount_cents      INTEGER NOT NULL,
  due_date          DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'failed')),
  boleto_url        TEXT,
  pix_qr_code       TEXT,
  pix_copy_paste    TEXT,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_rental_payments_contract ON imf_rental_payments (contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_asaas_id ON imf_rental_payments (asaas_payment_id);

ALTER TABLE imf_rental_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broker_own_rental_payments" ON imf_rental_payments
  FOR ALL
  USING (contract_id IN (
    SELECT id FROM imf_rental_contracts WHERE broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid())
  ));
