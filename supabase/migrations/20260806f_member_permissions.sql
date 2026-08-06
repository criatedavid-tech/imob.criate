-- ============================================================
-- Permissões granulares por membro da equipe
-- ============================================================
-- Hoje o modelo dentro de uma conta é binário: titular (acesso total,
-- imf_brokers.user_id === userId) ou membro (mesmo acesso pra todo mundo
-- — a própria migration 20260708d_broker_members.sql documentava isso
-- como "decisão de produto adiada"). Esta migration cria as duas tabelas
-- que sustentam a grade módulo × ação (Visualizar/Criar/Editar/Excluir/
-- Gerenciar) por membro, mais o histórico de auditoria de toda mudança.
--
-- O titular real NUNCA tem linha em imf_member_permissions — o acesso
-- dele é implícito via isBrokerOwner(), nunca armazenado/editável. Só
-- membros comuns ganham linhas aqui, e só quando concedido (ausência de
-- linha = negado). Os 6 perfis prontos (Administrador/Gestor/Corretor/
-- Atendente/Financeiro/Só visualização) ficam fixos como constante
-- TypeScript em server/services/permissions.ts, não uma tabela — aplicar
-- um perfil é substituição total da grade do membro, não uma referência
-- viva a uma linha de "perfil".
--
-- Ambas as funções novas são RETURNS VOID de propósito: evita o problema
-- de coluna ambígua em ON CONFLICT dentro de função com RETURNS TABLE(...)
-- que 20260806d_fix_crm_ensure_default_pipeline_on_conflict_ambiguous.sql
-- já documentou (aqui não há coluna de saída pra colidir, então ON
-- CONFLICT é seguro). Ambas tomam FOR UPDATE na linha do broker primeiro,
-- mesmo padrão de concorrência já usado em imf_set_account_capabilities
-- (20260803_account_capability_overrides.sql).
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_member_permissions (
  broker_id   UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module      TEXT NOT NULL CHECK (module IN (
                'carteira', 'negocios', 'contatos', 'agenda', 'conversas',
                'locacao', 'lancamentos', 'financeiro', 'equipe',
                'whatsapp-conexoes', 'relatorios', 'integracoes',
                'configuracoes', 'assistente-ia'
              )),
  action      TEXT NOT NULL CHECK (action IN ('visualizar', 'criar', 'editar', 'excluir', 'gerenciar')),
  granted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broker_id, user_id, module, action)
);

ALTER TABLE public.imf_member_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_member_permissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_member_permissions TO service_role;

CREATE TABLE IF NOT EXISTS public.imf_permission_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id      UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type    TEXT NOT NULL CHECK (change_type IN ('grant', 'revoke', 'profile_applied')),
  module         TEXT CHECK (module IS NULL OR module IN (
                    'carteira', 'negocios', 'contatos', 'agenda', 'conversas',
                    'locacao', 'lancamentos', 'financeiro', 'equipe',
                    'whatsapp-conexoes', 'relatorios', 'integracoes',
                    'configuracoes', 'assistente-ia'
                  )),
  action         TEXT CHECK (action IS NULL OR action IN ('visualizar', 'criar', 'editar', 'excluir', 'gerenciar')),
  profile_key    TEXT CHECK (profile_key IS NULL OR profile_key IN (
                    'administrador', 'gestor', 'corretor', 'atendente', 'financeiro', 'visualizacao'
                  )),
  diff           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_audit_target
  ON public.imf_permission_audit_log (broker_id, target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permission_audit_broker
  ON public.imf_permission_audit_log (broker_id, created_at DESC);

ALTER TABLE public.imf_permission_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_permission_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.imf_permission_audit_log TO service_role;

-- Toggle único: concede ou revoga UMA permissão, grava 1 linha de
-- auditoria (grant/revoke), atômico.
CREATE OR REPLACE FUNCTION public.imf_set_member_permission(
  p_broker_id UUID,
  p_user_id UUID,
  p_module TEXT,
  p_action TEXT,
  p_granted BOOLEAN,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.imf_brokers WHERE id = p_broker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BROKER_NOT_FOUND: corretor não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_granted THEN
    INSERT INTO public.imf_member_permissions (broker_id, user_id, module, action, granted_by)
    VALUES (p_broker_id, p_user_id, p_module, p_action, p_actor)
    ON CONFLICT (broker_id, user_id, module, action) DO NOTHING;
  ELSE
    DELETE FROM public.imf_member_permissions
    WHERE broker_id = p_broker_id AND user_id = p_user_id AND module = p_module AND action = p_action;
  END IF;

  INSERT INTO public.imf_permission_audit_log (
    broker_id, target_user_id, actor_user_id, change_type, module, action, diff
  ) VALUES (
    p_broker_id, p_user_id, p_actor,
    CASE WHEN p_granted THEN 'grant' ELSE 'revoke' END,
    p_module, p_action,
    jsonb_build_object('module', p_module, 'action', p_action, 'granted', p_granted)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.imf_set_member_permission(UUID, UUID, TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_set_member_permission(UUID, UUID, TEXT, TEXT, BOOLEAN, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.imf_set_member_permission(UUID, UUID, TEXT, TEXT, BOOLEAN, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_set_member_permission(UUID, UUID, TEXT, TEXT, BOOLEAN, UUID) TO service_role;

-- Aplica um perfil: substitui TODA a grade atual do membro pelo conjunto
-- novo (nunca uma união) e grava 1 linha de auditoria profile_applied com
-- o diff {added, removed}.
CREATE OR REPLACE FUNCTION public.imf_replace_member_permissions(
  p_broker_id UUID,
  p_user_id UUID,
  p_grants TEXT[],
  p_actor UUID,
  p_profile_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before TEXT[];
  v_after TEXT[] := COALESCE(p_grants, ARRAY[]::TEXT[]);
  v_added TEXT[];
  v_removed TEXT[];
BEGIN
  PERFORM 1 FROM public.imf_brokers WHERE id = p_broker_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BROKER_NOT_FOUND: corretor não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(module || ':' || action), ARRAY[]::TEXT[])
    INTO v_before
    FROM public.imf_member_permissions
   WHERE broker_id = p_broker_id AND user_id = p_user_id;

  DELETE FROM public.imf_member_permissions
   WHERE broker_id = p_broker_id AND user_id = p_user_id;

  INSERT INTO public.imf_member_permissions (broker_id, user_id, module, action, granted_by)
  SELECT p_broker_id, p_user_id, split_part(grant_key, ':', 1), split_part(grant_key, ':', 2), p_actor
    FROM unnest(v_after) AS grant_key
  ON CONFLICT (broker_id, user_id, module, action) DO NOTHING;

  SELECT COALESCE(array_agg(g), ARRAY[]::TEXT[]) INTO v_added
    FROM unnest(v_after) AS g WHERE NOT (g = ANY(v_before));
  SELECT COALESCE(array_agg(g), ARRAY[]::TEXT[]) INTO v_removed
    FROM unnest(v_before) AS g WHERE NOT (g = ANY(v_after));

  INSERT INTO public.imf_permission_audit_log (
    broker_id, target_user_id, actor_user_id, change_type, profile_key, diff
  ) VALUES (
    p_broker_id, p_user_id, p_actor, 'profile_applied', p_profile_key,
    jsonb_build_object('added', v_added, 'removed', v_removed)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.imf_replace_member_permissions(UUID, UUID, TEXT[], UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.imf_replace_member_permissions(UUID, UUID, TEXT[], UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.imf_replace_member_permissions(UUID, UUID, TEXT[], UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.imf_replace_member_permissions(UUID, UUID, TEXT[], UUID, TEXT) TO service_role;

COMMIT;
