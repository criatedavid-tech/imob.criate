-- Controle hibrido de cobrancas de locacao:
-- - conciliacao periodica com o Asaas;
-- - baixa/reabertura manual auditavel;
-- - boleto externo armazenado em bucket privado.

BEGIN;

ALTER TABLE public.imf_rental_payments
  ADD COLUMN IF NOT EXISTS manual_status TEXT,
  ADD COLUMN IF NOT EXISTS manual_status_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_status_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS status_source TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS asaas_last_status TEXT,
  ADD COLUMN IF NOT EXISTS asaas_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boleto_file_path TEXT,
  ADD COLUMN IF NOT EXISTS boleto_file_name TEXT,
  ADD COLUMN IF NOT EXISTS boleto_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boleto_imported_by_user_id UUID;

ALTER TABLE public.imf_rental_payments
  DROP CONSTRAINT IF EXISTS imf_rental_payments_manual_status_check,
  ADD CONSTRAINT imf_rental_payments_manual_status_check
    CHECK (manual_status IS NULL OR manual_status IN ('paid', 'unpaid')),
  DROP CONSTRAINT IF EXISTS imf_rental_payments_status_source_check,
  ADD CONSTRAINT imf_rental_payments_status_source_check
    CHECK (status_source IN ('system', 'asaas', 'manual')),
  DROP CONSTRAINT IF EXISTS imf_rental_payments_boleto_file_name_check,
  ADD CONSTRAINT imf_rental_payments_boleto_file_name_check
    CHECK (boleto_file_name IS NULL OR char_length(boleto_file_name) <= 180);

CREATE INDEX IF NOT EXISTS idx_rental_payments_asaas_reconciliation
  ON public.imf_rental_payments (status, asaas_checked_at)
  WHERE source = 'asaas' AND asaas_payment_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imf-rental-bills',
  'imf-rental-bills',
  FALSE,
  6291456,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
