-- Etapa 6 (Locação) e Etapa 7 (Lançamentos) do UX_MASTERPLAN.md — núcleo real,
-- sem as partes que dependem de integração externa ainda não feita (boleto/
-- PIX/DIMOB/vistoria/backoffice de documentos ficam para uma rodada futura).

-- ─── Locação: contrato de aluguel ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS imf_rental_contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id         UUID NOT NULL REFERENCES imf_brokers(id),
  property_id       UUID REFERENCES imf_properties(id) ON DELETE SET NULL,
  tenant_name       TEXT NOT NULL,
  tenant_phone      TEXT,
  owner_name        TEXT NOT NULL,
  owner_phone       TEXT,
  rent_amount_cents INTEGER NOT NULL,
  due_day           INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date        DATE NOT NULL,
  end_date          DATE,
  status            TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_broker ON imf_rental_contracts (broker_id, status);

ALTER TABLE imf_rental_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broker_own_rental_contracts" ON imf_rental_contracts
  FOR ALL
  USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));

-- ─── Lançamentos: empreendimento + unidades ────────────────────────────────
CREATE TABLE IF NOT EXISTS imf_developments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   UUID NOT NULL REFERENCES imf_brokers(id),
  name        TEXT NOT NULL,
  location    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_developments_broker ON imf_developments (broker_id);

ALTER TABLE imf_developments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broker_own_developments" ON imf_developments
  FOR ALL
  USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS imf_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id  UUID NOT NULL REFERENCES imf_developments(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  price_cents     BIGINT,
  status          TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'reservado', 'vendido')),
  reserved_until  TIMESTAMPTZ,
  buyer_name      TEXT,
  buyer_phone     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (development_id, code)
);

CREATE INDEX IF NOT EXISTS idx_units_development ON imf_units (development_id);

ALTER TABLE imf_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broker_own_units" ON imf_units
  FOR ALL
  USING (development_id IN (
    SELECT id FROM imf_developments WHERE broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid())
  ));
