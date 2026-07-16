-- Lancamentos - backoffice de documentos das reservas financeiras.
-- Os arquivos ficam em Storage privado; esta tabela guarda somente o caminho
-- interno e os metadados necessarios para o fluxo de aprovacao.

-- Permite a FK composta abaixo garantir no proprio banco que documento e
-- reserva pertencem ao mesmo tenant, mesmo com service_role.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_reservations_id_broker
  ON imf_unit_reservations (id, broker_id);

CREATE TABLE IF NOT EXISTS imf_reservation_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id             UUID NOT NULL REFERENCES imf_brokers(id),
  reservation_id        UUID NOT NULL,
  label                 TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  status                TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
                          'pendente', 'enviado', 'aprovado', 'rejeitado'
                        )),
  file_path             TEXT,
  file_mime_type        TEXT CHECK (file_mime_type IS NULL OR file_mime_type IN (
                          'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
                        )),
  file_size_bytes       BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 6291456),
  rejection_reason      TEXT CHECK (rejection_reason IS NULL OR char_length(btrim(rejection_reason)) BETWEEN 2 AND 500),
  requested_by_user_id  UUID NOT NULL,
  reviewed_by_user_id   UUID,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at           TIMESTAMPTZ,
  reviewed_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imf_reservation_documents_same_broker_fk
    FOREIGN KEY (reservation_id, broker_id)
    REFERENCES imf_unit_reservations(id, broker_id),
  CONSTRAINT imf_reservation_documents_rejection_reason CHECK (
    (status = 'rejeitado' AND rejection_reason IS NOT NULL)
    OR (status <> 'rejeitado' AND rejection_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_reservation_documents_reservation_requested
  ON imf_reservation_documents (reservation_id, requested_at ASC);
CREATE INDEX IF NOT EXISTS idx_reservation_documents_broker_status
  ON imf_reservation_documents (broker_id, status);

ALTER TABLE imf_reservation_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'imf_reservation_documents'
      AND policyname = 'broker_own_reservation_documents'
  ) THEN
    CREATE POLICY "broker_own_reservation_documents" ON imf_reservation_documents
      FOR ALL
      USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()))
      WITH CHECK (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));
  END IF;
END $$;

-- O navegador nao acessa a tabela diretamente. O backend usa service_role e
-- confirma autenticacao, titularidade e broker_id em cada operacao.
REVOKE ALL ON TABLE imf_reservation_documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE imf_reservation_documents TO service_role;

-- Bucket exclusivo do ImobiFlow, sempre privado. Nao ha policy de acesso para
-- anon/authenticated: upload e leitura passam pelo backend com service_role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imf-reservation-documents',
  'imf-reservation-documents',
  FALSE,
  6291456,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
