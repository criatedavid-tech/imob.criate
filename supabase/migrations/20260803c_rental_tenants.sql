-- Cadastro independente de inquilinos e vinculo historico com contratos.
-- Preserva os campos tenant_* no contrato como fotografia cadastral da epoca.

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_rental_tenants (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id                UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  full_name                TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  phone                    TEXT,
  email                    TEXT,
  cpf_cnpj                 TEXT,
  birth_date               DATE,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  notes                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_tenants_broker_status
  ON public.imf_rental_tenants (broker_id, status, full_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_tenants_broker_document
  ON public.imf_rental_tenants (broker_id, cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL AND btrim(cpf_cnpj) <> '';

ALTER TABLE public.imf_rental_tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS broker_own_rental_tenants ON public.imf_rental_tenants;
CREATE POLICY broker_own_rental_tenants
  ON public.imf_rental_tenants
  FOR ALL
  USING (
    broker_id IN (
      SELECT id FROM public.imf_brokers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    broker_id IN (
      SELECT id FROM public.imf_brokers WHERE user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.imf_rental_tenants FROM anon, authenticated;
GRANT ALL ON TABLE public.imf_rental_tenants TO service_role;

ALTER TABLE public.imf_rental_contracts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.imf_rental_tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenant_history
  ON public.imf_rental_contracts (tenant_id, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_property_history
  ON public.imf_rental_contracts (broker_id, property_id, start_date DESC)
  WHERE property_id IS NOT NULL;

-- Primeiro consolida contratos que possuem CPF/CNPJ. O documento e unico por
-- conta e evita duplicar o mesmo inquilino em renovacoes de contrato.
INSERT INTO public.imf_rental_tenants (
  broker_id, full_name, phone, cpf_cnpj, status, created_at, updated_at
)
SELECT DISTINCT ON (c.broker_id, regexp_replace(c.tenant_cpf_cnpj, '\D', '', 'g'))
  c.broker_id,
  btrim(c.tenant_name),
  NULLIF(btrim(c.tenant_phone), ''),
  NULLIF(regexp_replace(c.tenant_cpf_cnpj, '\D', '', 'g'), ''),
  'ativo',
  c.created_at,
  c.updated_at
FROM public.imf_rental_contracts c
WHERE c.tenant_id IS NULL
  AND NULLIF(btrim(c.tenant_cpf_cnpj), '') IS NOT NULL
ORDER BY c.broker_id, regexp_replace(c.tenant_cpf_cnpj, '\D', '', 'g'), c.created_at DESC
ON CONFLICT (broker_id, cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL AND btrim(cpf_cnpj) <> ''
DO NOTHING;

UPDATE public.imf_rental_contracts c
SET tenant_id = t.id
FROM public.imf_rental_tenants t
WHERE c.tenant_id IS NULL
  AND t.broker_id = c.broker_id
  AND NULLIF(btrim(c.tenant_cpf_cnpj), '') IS NOT NULL
  AND t.cpf_cnpj = regexp_replace(c.tenant_cpf_cnpj, '\D', '', 'g');

-- Contratos legados sem documento sao consolidados por conta + nome + telefone.
INSERT INTO public.imf_rental_tenants (
  broker_id, full_name, phone, status, created_at, updated_at
)
SELECT DISTINCT ON (
  c.broker_id,
  lower(btrim(c.tenant_name)),
  COALESCE(NULLIF(btrim(c.tenant_phone), ''), '')
)
  c.broker_id,
  btrim(c.tenant_name),
  NULLIF(btrim(c.tenant_phone), ''),
  'ativo',
  c.created_at,
  c.updated_at
FROM public.imf_rental_contracts c
WHERE c.tenant_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.imf_rental_tenants existing
    WHERE existing.broker_id = c.broker_id
      AND lower(btrim(existing.full_name)) = lower(btrim(c.tenant_name))
      AND COALESCE(NULLIF(btrim(existing.phone), ''), '') = COALESCE(NULLIF(btrim(c.tenant_phone), ''), '')
  )
ORDER BY
  c.broker_id,
  lower(btrim(c.tenant_name)),
  COALESCE(NULLIF(btrim(c.tenant_phone), ''), ''),
  c.created_at DESC;

UPDATE public.imf_rental_contracts c
SET tenant_id = t.id
FROM public.imf_rental_tenants t
WHERE c.tenant_id IS NULL
  AND t.broker_id = c.broker_id
  AND lower(btrim(t.full_name)) = lower(btrim(c.tenant_name))
  AND COALESCE(NULLIF(btrim(t.phone), ''), '') = COALESCE(NULLIF(btrim(c.tenant_phone), ''), '');

-- Defesa no banco: um contrato nunca pode apontar para inquilino de outra conta.
-- Ao trocar o vinculo, os campos tenant_* recebem uma fotografia do cadastro.
CREATE OR REPLACE FUNCTION public.imf_validate_rental_contract_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant public.imf_rental_tenants%ROWTYPE;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_tenant
  FROM public.imf_rental_tenants
  WHERE id = NEW.tenant_id
    AND broker_id = NEW.broker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inquilino invalido para esta conta.' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    NEW.tenant_name := v_tenant.full_name;
    NEW.tenant_phone := v_tenant.phone;
    NEW.tenant_cpf_cnpj := v_tenant.cpf_cnpj;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_rental_contract_tenant ON public.imf_rental_contracts;
CREATE TRIGGER trg_validate_rental_contract_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, broker_id
  ON public.imf_rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.imf_validate_rental_contract_tenant();

REVOKE ALL ON FUNCTION public.imf_validate_rental_contract_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.imf_validate_rental_contract_tenant() TO service_role;

COMMIT;
