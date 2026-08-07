-- ============================================================
-- WhatsApp Pai — instância central da plataforma
-- ============================================================
-- Fase 3 do plano WhatsApp Pai (.claude/plans/zany-forging-curry.md):
-- ao contrário de um corretor/membro (1 instância UAZAPI por linha em
-- imf_brokers/imf_broker_members), o Pai é UMA instância só, compartilhada
-- por TODA a plataforma, não amarrada a nenhum broker — daí a tabela
-- própria em vez de reaproveitar imf_brokers.
--
-- Linha única (key='pai'). Mesmas colunas de provisionamento que
-- imf_brokers/imf_broker_members já usam (uazapi_instance_id/token,
-- provisioning_status/error/completed_at), pra reaproveitar o mesmo padrão
-- de ensureInstance (comparar-e-trocar) já provado em provisioning.ts.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_platform_instances (
  key                       TEXT PRIMARY KEY,
  uazapi_instance_id        TEXT,
  uazapi_instance_token     TEXT,
  provisioning_status       TEXT,
  provisioning_error        TEXT,
  provisioning_completed_at TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.imf_platform_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_platform_instances FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_platform_instances TO service_role;

COMMIT;
