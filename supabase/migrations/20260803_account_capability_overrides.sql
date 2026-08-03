-- Funcoes adicionais por conta sem quebrar o account_type historico.
--
-- Ausencia de override preserva exatamente o comportamento anterior:
--   corretor      -> apenas o nucleo comum
--   imobiliaria   -> locacao, financeiro e equipe
--   incorporadora -> lancamentos, financeiro e equipe
--
-- O backend e o unico consumidor desta tabela. O navegador nunca recebe
-- acesso direto para que um cliente nao consiga liberar recursos do plano.

CREATE TABLE IF NOT EXISTS public.imf_account_capability_overrides (
  broker_id   UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  capability  TEXT NOT NULL CHECK (capability IN ('rentals', 'developments', 'finance', 'team')),
  enabled     BOOLEAN NOT NULL,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broker_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_account_capability_overrides_broker
  ON public.imf_account_capability_overrides (broker_id);

ALTER TABLE public.imf_account_capability_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_account_capability_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_account_capability_overrides TO service_role;

-- Recebe o conjunto FINAL de funcoes desejadas. Guarda somente as diferencas
-- em relacao ao tipo principal da conta, deixando a compatibilidade explicita
-- e evitando linhas redundantes. A troca e atomica.
CREATE OR REPLACE FUNCTION public.imf_set_account_capabilities(
  p_broker_id UUID,
  p_enabled_capabilities TEXT[],
  p_updated_by UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_type TEXT;
  v_capability TEXT;
  v_enabled BOOLEAN;
  v_default_enabled BOOLEAN;
  v_requested TEXT[] := COALESCE(p_enabled_capabilities, ARRAY[]::TEXT[]);
  v_allowed CONSTANT TEXT[] := ARRAY['rentals', 'developments', 'finance', 'team']::TEXT[];
BEGIN
  SELECT account_type
    INTO v_account_type
    FROM public.imf_brokers
   WHERE id = p_broker_id
   FOR UPDATE;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'Conta nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_requested) AS requested(capability)
     WHERE NOT (requested.capability = ANY(v_allowed))
  ) THEN
    RAISE EXCEPTION 'Funcao de conta invalida.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.imf_account_capability_overrides
   WHERE broker_id = p_broker_id;

  FOREACH v_capability IN ARRAY v_allowed LOOP
    v_enabled := v_capability = ANY(v_requested);
    v_default_enabled := CASE v_capability
      WHEN 'rentals' THEN v_account_type = 'imobiliaria'
      WHEN 'developments' THEN v_account_type = 'incorporadora'
      WHEN 'finance' THEN v_account_type IN ('imobiliaria', 'incorporadora')
      WHEN 'team' THEN v_account_type IN ('imobiliaria', 'incorporadora')
      ELSE FALSE
    END;

    IF v_enabled IS DISTINCT FROM v_default_enabled THEN
      INSERT INTO public.imf_account_capability_overrides (
        broker_id, capability, enabled, updated_by, updated_at
      ) VALUES (
        p_broker_id, v_capability, v_enabled, p_updated_by, NOW()
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_set_account_capabilities(UUID, TEXT[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_set_account_capabilities(UUID, TEXT[], UUID) TO service_role;
