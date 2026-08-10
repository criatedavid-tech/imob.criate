-- Reset atomico do contexto pessoal do Assistente IA.
-- Apaga somente dados do par usuario/conta informado pelo backend service_role.
-- Nao toca em leads, imoveis, agenda, mensagens comerciais nem na inbox
-- tecnica do webhook. A inbox precisa permanecer para idempotencia/auditoria.

BEGIN;

CREATE OR REPLACE FUNCTION public.imf_reset_agent_conversation(
  p_user_id UUID,
  p_broker_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_history_deleted INTEGER := 0;
  v_pending_deleted INTEGER := 0;
  v_media_deleted INTEGER := 0;
  v_documents_deleted INTEGER := 0;
BEGIN
  -- Uma acao em execucao ou ja executada mas ainda sem resposta entregue usa
  -- esta linha como trava contra duplicidade. Nunca a remova no meio do ciclo.
  IF EXISTS (
    SELECT 1
    FROM public.imf_whatsapp_pending_actions AS pending
    WHERE pending.user_id = p_user_id
      AND pending.broker_id = p_broker_id
      AND pending.status IN ('executing', 'executed')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_in_progress');
  END IF;

  DELETE FROM public.imf_whatsapp_pending_actions AS pending
  WHERE pending.user_id = p_user_id
    AND pending.broker_id = p_broker_id;
  GET DIAGNOSTICS v_pending_deleted = ROW_COUNT;

  DELETE FROM public.imf_whatsapp_staged_media AS media
  WHERE media.user_id = p_user_id
    AND media.broker_id = p_broker_id;
  GET DIAGNOSTICS v_media_deleted = ROW_COUNT;

  DELETE FROM public.imf_whatsapp_staged_documents AS document
  WHERE document.user_id = p_user_id
    AND document.broker_id = p_broker_id;
  GET DIAGNOSTICS v_documents_deleted = ROW_COUNT;

  DELETE FROM public.imf_agent_log AS log
  WHERE log.user_id = p_user_id
    AND log.broker_id = p_broker_id;
  GET DIAGNOSTICS v_history_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'historyDeleted', v_history_deleted,
    'pendingActionsDeleted', v_pending_deleted,
    'stagedMediaDeleted', v_media_deleted,
    'stagedDocumentsDeleted', v_documents_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.imf_reset_agent_conversation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_reset_agent_conversation(UUID, UUID)
  TO service_role;

COMMIT;
