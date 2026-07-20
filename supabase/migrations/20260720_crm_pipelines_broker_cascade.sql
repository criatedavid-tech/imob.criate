-- Corrige efeito colateral da migration 20260717b_crm_pipelines.sql: o admin
-- exclui conta com `DELETE FROM imf_brokers ... ` confiando em CASCADE pra
-- limpar tudo (server/routes/admin.ts, comentário "cascade deve limpar
-- propriedades/leads via FK") — mas imf_crm_pipelines/imf_crm_pipeline_stages
-- foram criadas sem CASCADE (de propósito, pra proteger contra exclusão
-- acidental de UM pipeline/etapa com leads ainda vinculados — ver seção 7 da
-- 20260717b). Isso passou a bloquear a exclusão da conta INTEIRA com um erro
-- de FK que o admin.ts nem checava (reportava sucesso mesmo falhando).
--
-- Aqui o cascade é seguro: quando o BROKER inteiro é apagado, os leads dele
-- já são apagados juntos (cascade de leads/imf_properties -> imf_brokers,
-- pré-existente), então não sobra lead nenhum apontando pra um pipeline/etapa
-- que sumiu — tudo desaparece atomicamente na mesma operação. A proteção
-- contra apagar UM pipeline/etapa isolado com leads ainda ativos continua
-- intacta (checagem 409 em server/routes/crmPipelines.ts, sem CASCADE nas
-- FKs de leads.pipeline_id/pipeline_stage_id).
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Rodar manualmente, mesmo processo da
-- 20260717b. Idempotente (DROP CONSTRAINT IF EXISTS + ADD).

ALTER TABLE imf_crm_pipeline_stages
  DROP CONSTRAINT IF EXISTS imf_crm_pipeline_stages_pipeline_id_fkey;
ALTER TABLE imf_crm_pipeline_stages
  ADD CONSTRAINT imf_crm_pipeline_stages_pipeline_id_fkey
  FOREIGN KEY (pipeline_id) REFERENCES imf_crm_pipelines(id) ON DELETE CASCADE;

ALTER TABLE imf_crm_pipelines
  DROP CONSTRAINT IF EXISTS imf_crm_pipelines_broker_id_fkey;
ALTER TABLE imf_crm_pipelines
  ADD CONSTRAINT imf_crm_pipelines_broker_id_fkey
  FOREIGN KEY (broker_id) REFERENCES imf_brokers(id) ON DELETE CASCADE;
