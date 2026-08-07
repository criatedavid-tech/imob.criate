-- WhatsApp Pai - endurecimento de release.
--
-- 1. Guarda o estado duravel da confirmacao de uma acao. Se o processo cair
--    depois de executar a mutacao, o retry pode reenviar o resumo sem executar
--    a acao novamente. Se cair durante a execucao, o backend falha de forma
--    segura e pede conferencia manual em vez de duplicar a mutacao.
-- 2. Torna o staging de foto idempotente por mensagem do provedor.

BEGIN;

ALTER TABLE public.imf_whatsapp_pending_actions
  ADD COLUMN IF NOT EXISTS execution_message_id TEXT,
  ADD COLUMN IF NOT EXISTS execution_summary TEXT,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

-- Ativacao explicita do inbound. O default FALSE permite publicar a rota e
-- executar o smoke antes de a UAZAPI comecar a entregar mensagens reais.
ALTER TABLE public.imf_platform_instances
  ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_execution_message
  ON public.imf_whatsapp_pending_actions (execution_message_id)
  WHERE execution_message_id IS NOT NULL;

ALTER TABLE public.imf_whatsapp_staged_media
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_staged_media_provider_message
  ON public.imf_whatsapp_staged_media (user_id, provider_message_id);

-- Inicio atomico do vinculo. O SELECT FOR UPDATE elimina a janela entre
-- "telefone ainda nao verificado" e o UPSERT que poderia trocar o user_id de
-- uma linha confirmada concorrentemente.
CREATE OR REPLACE FUNCTION public.imf_start_whatsapp_phone_verification(
  p_user_id UUID,
  p_phone TEXT,
  p_otp_code_hash TEXT,
  p_otp_expires_at TIMESTAMPTZ
)
RETURNS TABLE(outcome TEXT, phone_normalized TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_row public.imf_whatsapp_staff_links%ROWTYPE;
BEGIN
  SELECT * INTO current_row
  FROM public.imf_whatsapp_staff_links
  WHERE imf_whatsapp_staff_links.phone_normalized = p_phone
  FOR UPDATE;

  IF FOUND AND current_row.verified_at IS NOT NULL THEN
    IF current_row.user_id = p_user_id THEN
      RETURN QUERY SELECT 'already_verified'::TEXT, p_phone;
    ELSE
      RETURN QUERY SELECT 'owned_by_other'::TEXT, p_phone;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.imf_whatsapp_staff_links (
    phone_normalized, user_id, otp_code_hash, otp_expires_at, otp_attempts, updated_at
  ) VALUES (
    p_phone, p_user_id, p_otp_code_hash, p_otp_expires_at, 0, now()
  )
  ON CONFLICT (phone_normalized) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    otp_code_hash = EXCLUDED.otp_code_hash,
    otp_expires_at = EXCLUDED.otp_expires_at,
    otp_attempts = 0,
    verified_at = NULL,
    updated_at = now()
  WHERE imf_whatsapp_staff_links.verified_at IS NULL
  RETURNING * INTO current_row;

  -- O conflito de uma insercao concorrente pode ter esperado outra
  -- transacao confirmar o numero. Nesse caso o WHERE acima impede transferir
  -- o vinculo e RETURNING nao devolve linha.
  IF NOT FOUND THEN
    SELECT * INTO current_row
    FROM public.imf_whatsapp_staff_links
    WHERE imf_whatsapp_staff_links.phone_normalized = p_phone;
    IF current_row.user_id = p_user_id THEN
      RETURN QUERY SELECT 'already_verified'::TEXT, p_phone;
    ELSE
      RETURN QUERY SELECT 'owned_by_other'::TEXT, p_phone;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'started'::TEXT, p_phone;
END;
$$;

CREATE OR REPLACE FUNCTION public.imf_confirm_whatsapp_phone_verification(
  p_user_id UUID,
  p_otp_code_hash TEXT,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE(outcome TEXT, phone_normalized TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pending_row public.imf_whatsapp_staff_links%ROWTYPE;
BEGIN
  SELECT * INTO pending_row
  FROM public.imf_whatsapp_staff_links
  WHERE user_id = p_user_id
    AND verified_at IS NULL
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'none'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF pending_row.otp_expires_at IS NULL OR pending_row.otp_expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::TEXT, pending_row.phone_normalized;
    RETURN;
  END IF;

  IF pending_row.otp_attempts >= greatest(coalesce(p_max_attempts, 5), 1) THEN
    RETURN QUERY SELECT 'too_many'::TEXT, pending_row.phone_normalized;
    RETURN;
  END IF;

  IF pending_row.otp_code_hash IS DISTINCT FROM p_otp_code_hash THEN
    UPDATE public.imf_whatsapp_staff_links
    SET otp_attempts = otp_attempts + 1,
        updated_at = now()
    WHERE imf_whatsapp_staff_links.phone_normalized = pending_row.phone_normalized
      AND user_id = p_user_id
      AND verified_at IS NULL;
    RETURN QUERY SELECT 'incorrect'::TEXT, pending_row.phone_normalized;
    RETURN;
  END IF;

  UPDATE public.imf_whatsapp_staff_links
  SET verified_at = now(),
      otp_code_hash = NULL,
      otp_expires_at = NULL,
      otp_attempts = 0,
      updated_at = now()
  WHERE imf_whatsapp_staff_links.phone_normalized = pending_row.phone_normalized
    AND user_id = p_user_id
    AND verified_at IS NULL
    AND otp_code_hash = p_otp_code_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'phone verification changed during confirmation';
  END IF;

  RETURN QUERY SELECT 'verified'::TEXT, pending_row.phone_normalized;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_start_whatsapp_phone_verification(UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_start_whatsapp_phone_verification(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.imf_confirm_whatsapp_phone_verification(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_confirm_whatsapp_phone_verification(UUID, TEXT, INTEGER)
  TO service_role;

COMMIT;
