-- Controle de chaves: isolamento e integridade dos novos registros.
--
-- A aplicacao acessa esta tabela somente pelo backend com service_role. O
-- navegador nao precisa (nem deve) consultar ou alterar quem esta com a chave.
ALTER TABLE public.imf_property_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_property_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_property_keys TO service_role;

-- NOT VALID preserva os registros de teste legados, inclusive telefones que
-- entraram antes de existir validacao. Mesmo assim, o PostgreSQL passa a
-- exigir as regras abaixo em todo INSERT/UPDATE novo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'imf_property_keys_holder_name_check'
      AND conrelid = 'public.imf_property_keys'::regclass
  ) THEN
    ALTER TABLE public.imf_property_keys
      ADD CONSTRAINT imf_property_keys_holder_name_check
      CHECK (char_length(btrim(holder_name)) BETWEEN 2 AND 120) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'imf_property_keys_phone_check'
      AND conrelid = 'public.imf_property_keys'::regclass
  ) THEN
    ALTER TABLE public.imf_property_keys
      ADD CONSTRAINT imf_property_keys_phone_check
      CHECK (holder_phone IS NULL OR holder_phone ~ '^55[1-9][0-9][2-9][0-9]{7}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'imf_property_keys_purpose_check'
      AND conrelid = 'public.imf_property_keys'::regclass
  ) THEN
    ALTER TABLE public.imf_property_keys
      ADD CONSTRAINT imf_property_keys_purpose_check
      CHECK (purpose IN ('visita', 'vistoria', 'obra', 'outro')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'imf_property_keys_due_at_check'
      AND conrelid = 'public.imf_property_keys'::regclass
  ) THEN
    ALTER TABLE public.imf_property_keys
      ADD CONSTRAINT imf_property_keys_due_at_check
      CHECK (due_at IS NOT NULL AND due_at > taken_at) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'imf_property_keys_returned_at_check'
      AND conrelid = 'public.imf_property_keys'::regclass
  ) THEN
    ALTER TABLE public.imf_property_keys
      ADD CONSTRAINT imf_property_keys_returned_at_check
      CHECK (returned_at IS NULL OR returned_at >= taken_at) NOT VALID;
  END IF;
END
$$;
