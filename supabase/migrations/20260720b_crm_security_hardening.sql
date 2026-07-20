-- ============================================================
-- CRM: hardening de segurança, concorrência e atomicidade
-- ============================================================
-- Migration complementar à 20260717b_crm_pipelines.sql.
--
-- Objetivos:
-- 1. impedir chamada direta das RPCs SECURITY DEFINER por anon/authenticated;
-- 2. rejeitar listas duplicadas/incompletas no reorder;
-- 3. preservar exatamente a ordem recebida com WITH ORDINALITY;
-- 4. tornar autocura, troca de pipeline padrão e transições destrutivas
--    operações atômicas;
-- 5. impedir associação nova a etapa ou pipeline arquivado.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase e validar
-- antes de publicar o backend que passa a chamar as novas funções.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Reorder seguro e determinístico
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.imf_crm_reorder_stages(
  p_pipeline_id UUID,
  p_broker_id UUID,
  p_stage_ids UUID[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_count INTEGER;
  v_given_count INTEGER;
  v_distinct_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.imf_crm_pipelines
    WHERE id = p_pipeline_id
      AND broker_id = p_broker_id
  ) THEN
    RAISE EXCEPTION 'CRM_NOT_FOUND: pipeline não encontrado para este broker'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)
  INTO v_expected_count
  FROM public.imf_crm_pipeline_stages
  WHERE pipeline_id = p_pipeline_id;

  v_given_count := COALESCE(cardinality(p_stage_ids), 0);

  SELECT COUNT(DISTINCT stage_id)
  INTO v_distinct_count
  FROM unnest(COALESCE(p_stage_ids, ARRAY[]::UUID[])) AS supplied(stage_id);

  IF v_given_count = 0
     OR v_given_count <> v_expected_count
     OR v_distinct_count <> v_given_count THEN
    RAISE EXCEPTION 'CRM_INVALID_ORDER: a lista deve conter cada etapa exatamente uma vez'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_stage_ids) AS supplied(stage_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.imf_crm_pipeline_stages stage
      WHERE stage.id = supplied.stage_id
        AND stage.pipeline_id = p_pipeline_id
    )
  ) THEN
    RAISE EXCEPTION 'CRM_INVALID_ORDER: uma ou mais etapas não pertencem ao pipeline'
      USING ERRCODE = 'P0001';
  END IF;

  -- Libera temporariamente as posições positivas sem violar o índice único.
  UPDATE public.imf_crm_pipeline_stages
  SET position = -position - 1000000
  WHERE pipeline_id = p_pipeline_id;

  UPDATE public.imf_crm_pipeline_stages AS stage
  SET position = supplied.ordinality::INTEGER,
      updated_at = now()
  FROM unnest(p_stage_ids) WITH ORDINALITY AS supplied(stage_id, ordinality)
  WHERE stage.id = supplied.stage_id
    AND stage.pipeline_id = p_pipeline_id;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_crm_reorder_stages(UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_crm_reorder_stages(UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.imf_crm_reorder_stages(UUID, UUID, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_crm_reorder_stages(UUID, UUID, UUID[]) TO service_role;

-- ------------------------------------------------------------
-- 2. Autocura atômica do pipeline padrão
-- ------------------------------------------------------------

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
    FROM public.imf_crm_pipeline_stages
    WHERE pipeline_id = v_pipeline_id
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

-- ------------------------------------------------------------
-- 3. Troca atômica do pipeline padrão
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.imf_crm_set_default_pipeline(
  p_pipeline_id UUID,
  p_broker_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serializa trocas concorrentes dentro do mesmo broker.
  PERFORM id
  FROM public.imf_crm_pipelines
  WHERE broker_id = p_broker_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.imf_crm_pipelines
    WHERE id = p_pipeline_id
      AND broker_id = p_broker_id
  ) THEN
    RAISE EXCEPTION 'CRM_NOT_FOUND: pipeline não encontrado para este broker'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.imf_crm_pipeline_stages
    WHERE pipeline_id = p_pipeline_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'CRM_CONFLICT: o pipeline padrão precisa ter ao menos uma etapa ativa'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.imf_crm_pipelines
  SET is_default = false,
      updated_at = now()
  WHERE broker_id = p_broker_id
    AND is_default = true
    AND id <> p_pipeline_id;

  UPDATE public.imf_crm_pipelines
  SET is_default = true,
      active = true,
      updated_at = now()
  WHERE id = p_pipeline_id
    AND broker_id = p_broker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_crm_set_default_pipeline(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_crm_set_default_pipeline(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.imf_crm_set_default_pipeline(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_crm_set_default_pipeline(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 4. Arquivamento/exclusão de etapa com reatribuição atômica
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.imf_crm_transition_stage(
  p_stage_id UUID,
  p_broker_id UUID,
  p_action TEXT,
  p_reassign_to_stage_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_stage_active BOOLEAN;
  v_pipeline_active BOOLEAN;
  v_leads_count INTEGER;
BEGIN
  IF p_action NOT IN ('archive', 'delete') THEN
    RAISE EXCEPTION 'CRM_INVALID_ACTION: ação inválida'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT stage.pipeline_id, stage.active, pipeline.active
  INTO v_pipeline_id, v_stage_active, v_pipeline_active
  FROM public.imf_crm_pipeline_stages AS stage
  JOIN public.imf_crm_pipelines AS pipeline ON pipeline.id = stage.pipeline_id
  WHERE stage.id = p_stage_id
    AND pipeline.broker_id = p_broker_id
  FOR UPDATE OF stage, pipeline;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'CRM_NOT_FOUND: etapa não encontrada para este broker'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_stage_active
     AND v_pipeline_active
     AND NOT EXISTS (
       SELECT 1
       FROM public.imf_crm_pipeline_stages
       WHERE pipeline_id = v_pipeline_id
         AND id <> p_stage_id
         AND active = true
     ) THEN
    RAISE EXCEPTION 'CRM_CONFLICT: um pipeline ativo precisa ter ao menos uma etapa ativa'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_reassign_to_stage_id IS NOT NULL THEN
    IF p_reassign_to_stage_id = p_stage_id OR NOT EXISTS (
      SELECT 1
      FROM public.imf_crm_pipeline_stages
      WHERE id = p_reassign_to_stage_id
        AND pipeline_id = v_pipeline_id
        AND active = true
    ) THEN
      RAISE EXCEPTION 'CRM_INVALID_TARGET: etapa de destino inválida'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COUNT(*)
  INTO v_leads_count
  FROM public.leads
  WHERE pipeline_stage_id = p_stage_id;

  IF v_leads_count > 0 AND p_reassign_to_stage_id IS NULL THEN
    RAISE EXCEPTION 'CRM_CONFLICT: a etapa possui leads e exige reatribuição'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_reassign_to_stage_id IS NOT NULL THEN
    UPDATE public.leads
    SET pipeline_stage_id = p_reassign_to_stage_id
    WHERE pipeline_stage_id = p_stage_id;
  END IF;

  IF p_action = 'archive' THEN
    UPDATE public.imf_crm_pipeline_stages
    SET active = false,
        updated_at = now()
    WHERE id = p_stage_id;
  ELSE
    DELETE FROM public.imf_crm_pipeline_stages
    WHERE id = p_stage_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_crm_transition_stage(UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_crm_transition_stage(UUID, UUID, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.imf_crm_transition_stage(UUID, UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_crm_transition_stage(UUID, UUID, TEXT, UUID) TO service_role;

-- ------------------------------------------------------------
-- 5. Edição de etapa + ressincronização de leads na mesma transação
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.imf_crm_update_stage(
  p_stage_id UUID,
  p_broker_id UUID,
  p_name TEXT,
  p_color TEXT,
  p_stage_type TEXT,
  p_active BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_stage_type TEXT;
BEGIN
  IF NULLIF(trim(p_name), '') IS NULL OR char_length(trim(p_name)) > 80 THEN
    RAISE EXCEPTION 'CRM_INVALID_NAME: nome inválido'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_color IS NOT NULL AND char_length(trim(p_color)) > 32 THEN
    RAISE EXCEPTION 'CRM_INVALID_COLOR: cor inválida'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_stage_type NOT IN ('open', 'won', 'lost') THEN
    RAISE EXCEPTION 'CRM_INVALID_STAGE_TYPE: tipo inválido'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT stage.stage_type
  INTO v_old_stage_type
    FROM public.imf_crm_pipeline_stages AS stage
    JOIN public.imf_crm_pipelines AS pipeline ON pipeline.id = stage.pipeline_id
    WHERE stage.id = p_stage_id
      AND pipeline.broker_id = p_broker_id
    FOR UPDATE OF stage;

  IF v_old_stage_type IS NULL THEN
    RAISE EXCEPTION 'CRM_NOT_FOUND: etapa não encontrada para este broker'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.imf_crm_pipeline_stages
  SET name = trim(p_name),
      color = NULLIF(trim(p_color), ''),
      stage_type = p_stage_type,
      active = p_active,
      updated_at = now()
  WHERE id = p_stage_id;

  IF v_old_stage_type IS DISTINCT FROM p_stage_type THEN
    -- Atribuir a coluna a ela mesma dispara trg_imf_sync_lead_pipeline_stage.
    UPDATE public.leads
    SET pipeline_stage_id = p_stage_id
    WHERE pipeline_stage_id = p_stage_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_crm_update_stage(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_crm_update_stage(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.imf_crm_update_stage(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_crm_update_stage(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- ------------------------------------------------------------
-- 6. Impede associação nova a etapa/pipeline arquivado
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.imf_sync_lead_pipeline_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_stage_type TEXT;
  v_pipeline_id UUID;
  v_stage_changed BOOLEAN;
BEGIN
  IF NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stage.stage_type, stage.pipeline_id
  INTO v_stage_type, v_pipeline_id
  FROM public.imf_crm_pipeline_stages AS stage
  JOIN public.imf_crm_pipelines AS pipeline ON pipeline.id = stage.pipeline_id
  WHERE stage.id = NEW.pipeline_stage_id
    AND stage.active = true
    AND pipeline.active = true;

  IF v_stage_type IS NULL THEN
    RAISE EXCEPTION 'CRM_INVALID_STAGE: etapa ou pipeline inativo'
      USING ERRCODE = '23514';
  END IF;

  NEW.pipeline_id := v_pipeline_id;

  IF TG_OP = 'INSERT' THEN
    v_stage_changed := true;
  ELSE
    v_stage_changed := OLD.pipeline_stage_id IS DISTINCT FROM NEW.pipeline_stage_id;
  END IF;

  IF v_stage_type = 'won' THEN
    NEW.status := 'fechado';
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
  ELSIF v_stage_type = 'lost' THEN
    NEW.status := 'perdido';
    NEW.closed_at := NULL;
  ELSE
    IF v_stage_changed THEN
      NEW.closed_at := NULL;
    END IF;
    IF NEW.status IS NULL OR NEW.status NOT IN ('new', 'contato', 'visita', 'proposta') THEN
      NEW.status := 'new';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_sync_lead_pipeline_stage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_sync_lead_pipeline_stage() FROM anon;
REVOKE ALL ON FUNCTION public.imf_sync_lead_pipeline_stage() FROM authenticated;

COMMIT;
