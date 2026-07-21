-- ============================================================
-- Fix: coluna ambígua em imf_crm_ensure_default_pipeline
-- ============================================================
-- A 20260720b_crm_security_hardening.sql declarou a função com
-- `RETURNS TABLE (pipeline_id UUID, first_stage_id UUID)`. Isso cria
-- automaticamente uma variável de saída chamada `pipeline_id`, visível
-- em toda a função (igual a qualquer variável declarada). Uma das
-- consultas no corpo da função referenciava a coluna sem alias:
--
--   SELECT 1 FROM public.imf_crm_pipeline_stages WHERE pipeline_id = v_pipeline_id
--
-- `imf_crm_pipeline_stages` também tem uma coluna `pipeline_id`, então o
-- Postgres não consegue decidir entre a variável de saída e a coluna —
-- erro 42702 (ambiguous column reference), com o hint "It could refer to
-- either a PL/pgSQL variable or a table column."
--
-- Essa consulta roda incondicionalmente (é a condição do IF, não depende
-- de nenhum dado existir), então a função falhava em toda chamada, pra
-- todo broker. GET /api/crm/pipelines chama ensureDefaultPipeline antes
-- de listar (autocura), então a tela Negócios/CRM inteira ficava fora do
-- ar desde que a 20260720b foi aplicada — só foi percebido agora porque
-- não houve QA autenticado ao vivo da tela até 2026-07-21.
--
-- Único ajuste: qualifica a referência com o alias `stage`, no mesmo
-- padrão já usado no restante da própria função (ex.: a consulta de
-- v_first_stage_id, algumas linhas abaixo).
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.imf_crm_ensure_default_pipeline(
  p_broker_id UUID
)
RETURNS TABLE (pipeline_id UUID, first_stage_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_first_stage_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.imf_brokers WHERE id = p_broker_id) THEN
    RAISE EXCEPTION 'CRM_NOT_FOUND: broker não encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT pipeline.id
  INTO v_pipeline_id
  FROM public.imf_crm_pipelines AS pipeline
  WHERE pipeline.broker_id = p_broker_id
    AND pipeline.is_default = true
  ORDER BY pipeline.created_at ASC
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    BEGIN
      INSERT INTO public.imf_crm_pipelines (
        broker_id, name, is_default, active
      ) VALUES (
        p_broker_id, 'Funil padrão', true, true
      )
      RETURNING id INTO v_pipeline_id;
    EXCEPTION WHEN unique_violation THEN
      -- Outra requisição criou o padrão enquanto esta aguardava o índice.
      SELECT pipeline.id
      INTO v_pipeline_id
      FROM public.imf_crm_pipelines AS pipeline
      WHERE pipeline.broker_id = p_broker_id
        AND pipeline.is_default = true
      ORDER BY pipeline.created_at ASC
      LIMIT 1;
    END;
  END IF;

  UPDATE public.imf_crm_pipelines
  SET active = true,
      updated_at = now()
  WHERE id = v_pipeline_id
    AND active = false;

  IF NOT EXISTS (
    SELECT 1
    FROM public.imf_crm_pipeline_stages AS stage
    WHERE stage.pipeline_id = v_pipeline_id
  ) THEN
    INSERT INTO public.imf_crm_pipeline_stages (
      pipeline_id, name, position, color, stage_type, active
    ) VALUES
      (v_pipeline_id, 'Novo',       1, '#60a5fa', 'open', true),
      (v_pipeline_id, 'Em contato', 2, '#a78bfa', 'open', true),
      (v_pipeline_id, 'Visita',     3, '#f472b6', 'open', true),
      (v_pipeline_id, 'Proposta',   4, '#fb923c', 'open', true),
      (v_pipeline_id, 'Fechado',    5, '#4ade80', 'won',  true)
    ON CONFLICT (pipeline_id, position) DO NOTHING;
  END IF;

  SELECT stage.id
  INTO v_first_stage_id
  FROM public.imf_crm_pipeline_stages AS stage
  WHERE stage.pipeline_id = v_pipeline_id
    AND stage.active = true
  ORDER BY stage.position ASC
  LIMIT 1;

  IF v_first_stage_id IS NULL THEN
    RAISE EXCEPTION 'CRM_CONFLICT: o pipeline padrão precisa ter ao menos uma etapa ativa'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_pipeline_id, v_first_stage_id;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_crm_ensure_default_pipeline(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_crm_ensure_default_pipeline(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.imf_crm_ensure_default_pipeline(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_crm_ensure_default_pipeline(UUID) TO service_role;

COMMIT;
