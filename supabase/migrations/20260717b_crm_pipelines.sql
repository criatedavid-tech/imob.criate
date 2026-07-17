-- ============================================================
-- CRM: pipelines e etapas configuráveis por broker
-- ============================================================
-- "Leads" vira "CRM" na interface. O Kanban deixa de ter colunas fixas
-- (new/contato/visita/proposta/fechado) e passa a ler as etapas do
-- pipeline selecionado. leads.status e leads.closed_at continuam
-- existindo e são mantidos em sincronia automaticamente (trigger no
-- fim deste arquivo), pois relatórios, metas/ranking de equipe e o
-- agente de IA ainda os leem diretamente — ver DOCUMENTACAO.md.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Rodar manualmente contra o Supabase
-- da branch v2 e validar antes de qualquer deploy que dependa deste
-- schema. Idempotente: seguro reexecutar (todo CREATE/ALTER usa
-- IF NOT EXISTS/OR REPLACE e o backfill só toca linhas ainda não
-- migradas).
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABELAS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS imf_crm_pipelines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   UUID NOT NULL REFERENCES imf_brokers(id),
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imf_crm_pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES imf_crm_pipelines(id),
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  color       TEXT,
  stage_type  TEXT NOT NULL DEFAULT 'open' CHECK (stage_type IN ('open', 'won', 'lost')),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE imf_crm_pipelines IS 'Funis de vendas configuráveis por broker (CRM). Cada broker tem exatamente um pipeline padrão (is_default).';
COMMENT ON TABLE imf_crm_pipeline_stages IS 'Etapas (colunas do Kanban) de um pipeline. stage_type governa o efeito em leads.status/closed_at via trigger.';
COMMENT ON COLUMN imf_crm_pipeline_stages.stage_type IS 'open = em andamento; won = negócio ganho (seta closed_at); lost = negócio perdido (não conta como fechado).';

-- ------------------------------------------------------------
-- 2. ÍNDICES E UNICIDADE
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_imf_crm_pipelines_broker
  ON imf_crm_pipelines (broker_id);

-- No máximo um pipeline padrão por broker (independente de active, pra
-- nunca ficar sem "o" padrão só por estar arquivado momentaneamente).
CREATE UNIQUE INDEX IF NOT EXISTS ux_imf_crm_pipelines_default_per_broker
  ON imf_crm_pipelines (broker_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_imf_crm_pipeline_stages_pipeline
  ON imf_crm_pipeline_stages (pipeline_id, position);

-- Protege a integridade de posição mesmo se algum caminho futuro não
-- passar pela RPC de reorder abaixo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_imf_crm_pipeline_stages_position
  ON imf_crm_pipeline_stages (pipeline_id, position);

-- ------------------------------------------------------------
-- 3. COLUNAS NOVAS EM leads
-- ------------------------------------------------------------
-- Sem ON DELETE CASCADE: apagar um pipeline/etapa NUNCA pode apagar
-- leads de tabela associada. A ausência de CASCADE faz o Postgres
-- recusar (RESTRICT) a exclusão de um pipeline/etapa ainda referenciado
-- por algum lead — reforço estrutural além da checagem 409 da API.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES imf_crm_pipelines(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage_id UUID REFERENCES imf_crm_pipeline_stages(id);

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_id ON leads (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage_id ON leads (pipeline_stage_id);

COMMENT ON COLUMN leads.pipeline_id IS 'Sempre derivado de pipeline_stage_id pelo trigger imf_sync_lead_pipeline_stage — nunca confiar em valor enviado solto pelo cliente.';
COMMENT ON COLUMN leads.pipeline_stage_id IS 'Etapa atual do lead no CRM. Fonte de verdade do Kanban; leads.status é mantido como espelho de compatibilidade.';

-- ------------------------------------------------------------
-- 4. RLS (rede de segurança — o backend usa service_role e ignora
--    RLS; isto só protege contra acesso direto via anon/frontend,
--    mesmo padrão de imf_properties em 20260630_billing_lock_and_rls.sql)
-- ------------------------------------------------------------

ALTER TABLE imf_crm_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_own_crm_pipelines" ON imf_crm_pipelines;
CREATE POLICY "broker_own_crm_pipelines" ON imf_crm_pipelines
  USING (broker_id = (
    SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
  ));

ALTER TABLE imf_crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broker_own_crm_pipeline_stages" ON imf_crm_pipeline_stages;
CREATE POLICY "broker_own_crm_pipeline_stages" ON imf_crm_pipeline_stages
  USING (pipeline_id IN (
    SELECT id FROM imf_crm_pipelines WHERE broker_id = (
      SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
    )
  ));

-- ------------------------------------------------------------
-- 5. RPC: reorder atômico de etapas
-- ------------------------------------------------------------
-- Recebe a lista COMPLETA de stage_ids do pipeline, na nova ordem, e
-- reatribui position=1..N num único statement. p_broker_id é sempre
-- resolvido pelo backend (getBrokerId), nunca recebido do frontend cru.
-- Desloca pra posições negativas antes de reatribuir as definitivas pra
-- nunca colidir com ux_imf_crm_pipeline_stages_position no meio do caminho.

CREATE OR REPLACE FUNCTION imf_crm_reorder_stages(
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
  v_expected_count INT;
  v_given_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM imf_crm_pipelines WHERE id = p_pipeline_id AND broker_id = p_broker_id
  ) THEN
    RAISE EXCEPTION 'pipeline % não encontrado para este broker', p_pipeline_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_expected_count FROM imf_crm_pipeline_stages WHERE pipeline_id = p_pipeline_id;
  v_given_count := COALESCE(array_length(p_stage_ids, 1), 0);

  IF v_given_count = 0 OR v_given_count <> v_expected_count THEN
    RAISE EXCEPTION 'lista de etapas não bate com o pipeline (esperado %, recebido %)', v_expected_count, v_given_count USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_stage_ids) AS sid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM imf_crm_pipeline_stages s WHERE s.id = sid.id AND s.pipeline_id = p_pipeline_id
    )
  ) THEN
    RAISE EXCEPTION 'uma ou mais etapas não pertencem a este pipeline' USING ERRCODE = 'P0001';
  END IF;

  UPDATE imf_crm_pipeline_stages
  SET position = -position - 1000000
  WHERE pipeline_id = p_pipeline_id;

  UPDATE imf_crm_pipeline_stages s
  SET position = t.new_position,
      updated_at = now()
  FROM (
    SELECT id, ROW_NUMBER() OVER () AS new_position
    FROM unnest(p_stage_ids) AS id
  ) AS t
  WHERE s.id = t.id;
END;
$$;

-- ------------------------------------------------------------
-- 6. TRIGGER: mantém leads.status/closed_at em sincronia com o
--    stage_type da etapa atual (mesmo princípio de
--    imf_sync_unit_sale_metadata em 20260716d_report_period_metrics.sql)
-- ------------------------------------------------------------
-- Dispara em INSERT e em UPDATE que toque pipeline_stage_id — nunca em
-- UPDATE de outros campos (nome/telefone/notas), então PATCH
-- /api/leads/:id/status (legado, mantido intacto) continua funcionando
-- exatamente como hoje, sem interferência deste trigger.
--
-- won  -> status='fechado', closed_at preenchido se ainda nulo
-- lost -> status='perdido' (valor novo; não conta como fechado em
--         nenhuma métrica, pois todas usam closed_at, nunca status
--         diretamente — ver DOCUMENTACAO.md), closed_at limpo
-- open -> closed_at limpo ao TROCAR de etapa; status normalizado pra
--         'new' se não for um dos 4 valores legados de "em andamento"

CREATE OR REPLACE FUNCTION imf_sync_lead_pipeline_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage_type TEXT;
  v_pipeline_id UUID;
  v_stage_changed BOOLEAN;
BEGIN
  IF NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stage_type, pipeline_id INTO v_stage_type, v_pipeline_id
  FROM imf_crm_pipeline_stages
  WHERE id = NEW.pipeline_stage_id;

  IF v_stage_type IS NULL THEN
    RETURN NEW; -- etapa inexistente: a FK constraint barra o INSERT/UPDATE de qualquer forma
  END IF;

  -- pipeline_id nunca é confiado separado do stage — sempre derivado aqui.
  NEW.pipeline_id := v_pipeline_id;

  IF TG_OP = 'INSERT' THEN
    v_stage_changed := TRUE;
  ELSE
    v_stage_changed := (OLD.pipeline_stage_id IS DISTINCT FROM NEW.pipeline_stage_id);
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

DROP TRIGGER IF EXISTS trg_imf_sync_lead_pipeline_stage ON leads;
CREATE TRIGGER trg_imf_sync_lead_pipeline_stage
BEFORE INSERT OR UPDATE OF pipeline_stage_id ON leads
FOR EACH ROW
EXECUTE FUNCTION imf_sync_lead_pipeline_stage();

-- ------------------------------------------------------------
-- 7. BACKFILL — idempotente
-- ------------------------------------------------------------

-- 7.1: cria o pipeline padrão pra todo broker que ainda não tem um.
INSERT INTO imf_crm_pipelines (broker_id, name, is_default, active)
SELECT b.id, 'Funil padrão', true, true
FROM imf_brokers b
WHERE NOT EXISTS (
  SELECT 1 FROM imf_crm_pipelines pl WHERE pl.broker_id = b.id AND pl.is_default = true
);

-- 7.2: semeia as 5 etapas históricas em todo pipeline padrão ainda sem
-- nenhuma etapa (cobre tanto os recém-criados acima quanto qualquer
-- pipeline padrão pré-existente que porventura esteja vazio).
INSERT INTO imf_crm_pipeline_stages (pipeline_id, name, position, color, stage_type, active)
SELECT pl.id, seed.name, seed.position, seed.color, seed.stage_type, true
FROM imf_crm_pipelines pl
JOIN (VALUES
  ('Novo',       1, '#60a5fa', 'open'),
  ('Em contato', 2, '#a78bfa', 'open'),
  ('Visita',     3, '#f472b6', 'open'),
  ('Proposta',   4, '#fb923c', 'open'),
  ('Fechado',    5, '#4ade80', 'won')
) AS seed(name, position, color, stage_type) ON true
WHERE pl.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM imf_crm_pipeline_stages st WHERE st.pipeline_id = pl.id
  );

-- 7.3: associa cada lead ainda não migrado (pipeline_stage_id IS NULL) ao
-- pipeline padrão do seu broker (resolvido via property_id->imf_properties
-- .broker_id, com fallback pra leads.broker_id quando não há imóvel) e à
-- etapa cujo nome corresponde ao status atual. status/closed_at já
-- existentes são preservados pelo trigger acima (só toca o que estiver
-- NULL). Leads cujo broker não é resolvível por nenhum dos dois caminhos
-- (anomalia de dado pré-existente, fora do escopo desta migration) ficam
-- sem pipeline — não são apagados nem alterados.
WITH lead_broker AS (
  SELECT
    l.id AS lead_id,
    COALESCE(p.broker_id, l.broker_id) AS broker_id,
    l.status AS status
  FROM leads l
  LEFT JOIN imf_properties p ON p.id = l.property_id
  WHERE l.pipeline_stage_id IS NULL
),
target_stage AS (
  SELECT
    lb.lead_id,
    st.id AS stage_id
  FROM lead_broker lb
  JOIN imf_crm_pipelines pl ON pl.broker_id = lb.broker_id AND pl.is_default = true
  JOIN imf_crm_pipeline_stages st ON st.pipeline_id = pl.id AND st.name = (
    CASE lb.status
      WHEN 'new' THEN 'Novo'
      WHEN 'contato' THEN 'Em contato'
      WHEN 'visita' THEN 'Visita'
      WHEN 'proposta' THEN 'Proposta'
      WHEN 'fechado' THEN 'Fechado'
      ELSE 'Novo'
    END
  )
)
UPDATE leads l
SET pipeline_stage_id = ts.stage_id
FROM target_stage ts
WHERE l.id = ts.lead_id;
