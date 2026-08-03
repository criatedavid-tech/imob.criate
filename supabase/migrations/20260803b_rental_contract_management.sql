-- Evolucao do modulo de Locacao: termos contratuais completos e controle de
-- pagamentos realizados fora do ImobiFlow. Esta migracao nao cria carteira,
-- saldo, split ou custodia para a Criate.

BEGIN;

ALTER TABLE public.imf_rental_contracts
  ADD COLUMN IF NOT EXISTS rental_type TEXT NOT NULL DEFAULT 'residencial',
  ADD COLUMN IF NOT EXISTS administration_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS monthly_interest_percent NUMERIC(5,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS guarantee_type TEXT NOT NULL DEFAULT 'sem_garantia',
  ADD COLUMN IF NOT EXISTS guarantee_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guarantee_notes TEXT,
  ADD COLUMN IF NOT EXISTS iptu_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iptu_payer TEXT NOT NULL DEFAULT 'proprietario',
  ADD COLUMN IF NOT EXISTS condominium_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS condominium_payer TEXT NOT NULL DEFAULT 'inquilino',
  ADD COLUMN IF NOT EXISTS fire_insurance_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fire_insurance_payer TEXT NOT NULL DEFAULT 'proprietario',
  ADD COLUMN IF NOT EXISTS other_charges_description TEXT,
  ADD COLUMN IF NOT EXISTS other_charges_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_payer TEXT NOT NULL DEFAULT 'inquilino',
  ADD COLUMN IF NOT EXISTS adjustment_index TEXT NOT NULL DEFAULT 'sem_reajuste',
  ADD COLUMN IF NOT EXISTS adjustment_interval_months INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS next_adjustment_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_rental_type_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_rental_type_check
      CHECK (rental_type IN ('residencial', 'comercial', 'temporada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_percentage_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_percentage_check
      CHECK (
        administration_fee_percent BETWEEN 0 AND 100
        AND late_fee_percent BETWEEN 0 AND 100
        AND monthly_interest_percent BETWEEN 0 AND 100
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_guarantee_type_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_guarantee_type_check
      CHECK (guarantee_type IN ('sem_garantia', 'caucao_dinheiro', 'fiador', 'seguro_fianca', 'cessao_fiduciaria'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_guarantee_amount_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_guarantee_amount_check
      CHECK (
        guarantee_amount_cents >= 0
        AND (
          guarantee_type <> 'caucao_dinheiro'
          OR guarantee_amount_cents::BIGINT <= rent_amount_cents::BIGINT * 3
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_expenses_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_expenses_check
      CHECK (
        iptu_amount_cents >= 0
        AND condominium_amount_cents >= 0
        AND fire_insurance_amount_cents >= 0
        AND other_charges_cents >= 0
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_expense_payers_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_expense_payers_check
      CHECK (
        iptu_payer IN ('inquilino', 'proprietario')
        AND condominium_payer IN ('inquilino', 'proprietario')
        AND fire_insurance_payer IN ('inquilino', 'proprietario')
        AND other_charges_payer IN ('inquilino', 'proprietario')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_adjustment_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_adjustment_check
      CHECK (
        adjustment_index IN ('sem_reajuste', 'ipca', 'igpm', 'outro')
        AND adjustment_interval_months BETWEEN 1 AND 60
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imf_rental_contracts_dates_check') THEN
    ALTER TABLE public.imf_rental_contracts ADD CONSTRAINT imf_rental_contracts_dates_check
      CHECK (end_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

ALTER TABLE public.imf_rental_payments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'external',
  ADD COLUMN IF NOT EXISTS rent_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS charges_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Registros anteriores com identificador Asaas continuam identificados como
-- integracao; novas competencias manuais usam source=external.
UPDATE public.imf_rental_payments
SET source = 'asaas'
WHERE asaas_payment_id IS NOT NULL;

UPDATE public.imf_rental_payments
SET
  rent_amount_cents = COALESCE(rent_amount_cents, amount_cents),
  amount_paid_cents = CASE WHEN status = 'paid' THEN amount_cents ELSE amount_paid_cents END,
  line_items = CASE
    WHEN line_items = '[]'::jsonb THEN jsonb_build_array(
      jsonb_build_object('code', 'rent', 'label', 'Aluguel', 'amount_cents', amount_cents)
    )
    ELSE line_items
  END;

ALTER TABLE public.imf_rental_payments
  ALTER COLUMN rent_amount_cents SET NOT NULL;

ALTER TABLE public.imf_rental_payments
  DROP CONSTRAINT IF EXISTS imf_rental_payments_status_check;

ALTER TABLE public.imf_rental_payments
  ADD CONSTRAINT imf_rental_payments_status_check
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'negotiated', 'canceled', 'failed')),
  ADD CONSTRAINT imf_rental_payments_source_check
    CHECK (source IN ('external', 'asaas')),
  ADD CONSTRAINT imf_rental_payments_amounts_check
    CHECK (
      rent_amount_cents >= 0
      AND charges_cents >= 0
      AND discount_cents >= 0
      AND amount_cents >= 0
      AND amount_paid_cents >= 0
      AND amount_paid_cents <= amount_cents
    ),
  ADD CONSTRAINT imf_rental_payments_line_items_check
    CHECK (jsonb_typeof(line_items) = 'array');

CREATE TABLE IF NOT EXISTS public.imf_rental_payment_receipts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES public.imf_rental_contracts(id) ON DELETE RESTRICT,
  payment_id            UUID NOT NULL REFERENCES public.imf_rental_payments(id) ON DELETE RESTRICT,
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method        TEXT NOT NULL CHECK (payment_method IN ('pix', 'transferencia', 'boleto', 'dinheiro', 'cartao', 'outro')),
  received_at           TIMESTAMPTZ NOT NULL,
  notes                 TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  recorded_by_user_id   UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_receipts_payment_created
  ON public.imf_rental_payment_receipts (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_receipts_contract_received
  ON public.imf_rental_payment_receipts (contract_id, received_at DESC);

ALTER TABLE public.imf_rental_payment_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'imf_rental_payment_receipts'
      AND policyname = 'broker_own_rental_payment_receipts'
  ) THEN
    CREATE POLICY broker_own_rental_payment_receipts
      ON public.imf_rental_payment_receipts
      FOR ALL
      USING (
        contract_id IN (
          SELECT c.id
          FROM public.imf_rental_contracts c
          WHERE c.broker_id IN (
            SELECT b.id FROM public.imf_brokers b WHERE b.user_id = auth.uid()
          )
        )
      )
      WITH CHECK (
        contract_id IN (
          SELECT c.id
          FROM public.imf_rental_contracts c
          WHERE c.broker_id IN (
            SELECT b.id FROM public.imf_brokers b WHERE b.user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

REVOKE ALL ON TABLE public.imf_rental_payment_receipts FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.imf_rental_payment_receipts TO service_role;

-- Toda mutacao passa pelas rotas autenticadas do backend. Isso evita que um
-- cliente Supabase altere diretamente valores, status ou termos contratuais.
REVOKE ALL ON TABLE public.imf_rental_contracts FROM anon, authenticated;
REVOKE ALL ON TABLE public.imf_rental_payments FROM anon, authenticated;
GRANT ALL ON TABLE public.imf_rental_contracts TO service_role;
GRANT ALL ON TABLE public.imf_rental_payments TO service_role;

-- Registra um recebimento externo e atualiza a competencia na mesma transacao.
-- O backend ja validou o JWT e passa broker/usuario autenticados; a funcao
-- repete a verificacao de escopo no banco e bloqueia pagamento acima do saldo.
CREATE OR REPLACE FUNCTION public.imf_record_external_rental_receipt(
  p_broker_id UUID,
  p_contract_id UUID,
  p_payment_id UUID,
  p_amount_cents INTEGER,
  p_payment_method TEXT,
  p_received_at TIMESTAMPTZ,
  p_notes TEXT,
  p_actor_user_id UUID
)
RETURNS public.imf_rental_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.imf_rental_payments%ROWTYPE;
  v_new_paid INTEGER;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'O valor recebido deve ser maior que zero.';
  END IF;

  IF p_payment_method NOT IN ('pix', 'transferencia', 'boleto', 'dinheiro', 'cartao', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento invalida.';
  END IF;

  SELECT p.* INTO v_payment
  FROM public.imf_rental_payments p
  JOIN public.imf_rental_contracts c ON c.id = p.contract_id
  WHERE p.id = p_payment_id
    AND p.contract_id = p_contract_id
    AND c.broker_id = p_broker_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competencia nao encontrada.';
  END IF;

  IF v_payment.source <> 'external' THEN
    RAISE EXCEPTION 'Pagamentos de integracao nao podem ser confirmados manualmente.';
  END IF;

  IF v_payment.status IN ('canceled', 'failed') THEN
    RAISE EXCEPTION 'Esta competencia nao aceita novos recebimentos.';
  END IF;

  v_new_paid := v_payment.amount_paid_cents + p_amount_cents;
  IF v_new_paid > v_payment.amount_cents THEN
    RAISE EXCEPTION 'O valor recebido supera o saldo da competencia.';
  END IF;

  INSERT INTO public.imf_rental_payment_receipts (
    contract_id, payment_id, amount_cents, payment_method,
    received_at, notes, recorded_by_user_id
  ) VALUES (
    p_contract_id, p_payment_id, p_amount_cents, p_payment_method,
    p_received_at, NULLIF(btrim(p_notes), ''), p_actor_user_id
  );

  UPDATE public.imf_rental_payments
  SET
    amount_paid_cents = v_new_paid,
    status = CASE WHEN v_new_paid = amount_cents THEN 'paid' ELSE 'partial' END,
    paid_at = CASE WHEN v_new_paid = amount_cents THEN p_received_at ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_record_external_rental_receipt(UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_record_external_rental_receipt(UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ, TEXT, UUID) TO service_role;

COMMIT;
