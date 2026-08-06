-- ============================================================
-- Fix #2: coluna ambígua em imf_crm_ensure_default_pipeline
-- ============================================================
-- A migration 20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql
-- já corrigiu a ambiguidade no WHERE/SELECT (qualificando com o alias
-- `stage`), mas deixou passar uma segunda ocorrência: o alvo de conflito
-- do INSERT das etapas seed.
--
--   INSERT INTO public.imf_crm_pipeline_stages (...) VALUES (...)
--   ON CONFLICT (pipeline_id, position) DO NOTHING;
--
-- O alvo de um ON CONFLICT aceita expressões (não só nomes de coluna
-- crus, já que índices podem ser sobre expressões), então o Postgres
-- também aplica ali a mesma resolução de identificador que causou o
-- primeiro bug: `pipeline_id` bate tanto com a coluna de
-- imf_crm_pipeline_stages quanto com a variável de saída da função
-- (RETURNS TABLE (pipeline_id UUID, ...)). Erro 42702 (ambiguous column
-- reference), mesmo sintoma da correção anterior — só que num lugar que
-- não pode ser qualificado com alias (o alvo de conflito não aceita
-- "stage.pipeline_id").
--
-- Achado ao vivo em 06/08/2026: GET /api/crm/pipelines continuava
-- devolvendo 500 pra qualquer conta mesmo depois da correção anterior
-- estar aplicada e confirmada via pg_get_functiondef.
--
-- Fix: troca o ON CONFLICT DO NOTHING por um bloco try/catch pegando
-- unique_violation — mesmo padrão de idempotência já usado logo acima,
-- na criação do pipeline padrão, dentro da própria função. Evita
-- completamente a lista de colunas do alvo de conflito.
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
    -- ON CONFLICT (pipeline_id, position) foi trocado por try/catch: o
    -- alvo de um ON CONFLICT aceita expressões, e "pipeline_id" ali batia
    -- com a variável de saída da função — mesmo erro 42702 que a
    -- correção anterior já tinha resolvido no WHERE/SELECT, só que
    -- faltou aqui. Mesmo padrão de idempotência já usado acima na
    -- criação do pipeline.
    BEGIN
      INSERT INTO public.imf_crm_pipeline_stages (
        pipeline_id, name, position, color, stage_type, active
      ) VALUES
        (v_pipeline_id, 'Novo',       1, '#60a5fa', 'open', true),
        (v_pipeline_id, 'Em contato', 2, '#a78bfa', 'open', true),
        (v_pipeline_id, 'Visita',     3, '#f472b6', 'open', true),
        (v_pipeline_id, 'Proposta',   4, '#fb923c', 'open', true),
        (v_pipeline_id, 'Fechado',    5, '#4ade80', 'won',  true);
    EXCEPTION WHEN unique_violation THEN
      -- Outra requisição já semeou as etapas enquanto esta aguardava.
      NULL;
    END;
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
