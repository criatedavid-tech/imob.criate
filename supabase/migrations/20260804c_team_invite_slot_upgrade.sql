-- Contrata uma vaga de WhatsApp proprio e cria o convite na mesma transacao.
-- A confirmacao vem explicitamente do titular pelo modal da Equipe. Se o
-- INSERT do convite falhar, o UPDATE do limite tambem e revertido.
BEGIN;

ALTER TABLE public.imf_broker_invites
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS added_whatsapp_slot BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS imf_broker_invites_request_id_unique
  ON public.imf_broker_invites (broker_id, request_id)
  WHERE request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT);

CREATE FUNCTION public.imf_create_broker_invite(
  p_broker_id UUID,
  p_code TEXT,
  p_expires_at TIMESTAMPTZ,
  p_whatsapp_mode TEXT DEFAULT 'shared',
  p_request_id UUID DEFAULT NULL,
  p_confirm_add_whatsapp_slot BOOLEAN DEFAULT FALSE,
  p_whatsapp_slot_max INTEGER DEFAULT 20
)
RETURNS TABLE (
  invite_id UUID,
  invite_code TEXT,
  invite_whatsapp_mode TEXT,
  invite_expires_at TIMESTAMPTZ,
  slot_added BOOLEAN,
  member_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broker public.imf_brokers%ROWTYPE;
  v_reserved INTEGER;
  v_whatsapp_reserved INTEGER;
  v_whatsapp_limit INTEGER;
  v_new_member_limit INTEGER;
  v_id UUID;
  v_existing public.imf_broker_invites%ROWTYPE;
BEGIN
  IF p_whatsapp_mode IS NULL OR p_whatsapp_mode NOT IN ('shared', 'own') THEN
    RAISE EXCEPTION 'INVITE_WHATSAPP_MODE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_whatsapp_slot_max < 0 OR p_whatsapp_slot_max > 100 THEN
    RAISE EXCEPTION 'INVITE_WHATSAPP_SLOT_MAX_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_broker
    FROM public.imf_brokers
   WHERE id = p_broker_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BROKER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  slot_added := FALSE;
  v_new_member_limit := COALESCE(v_broker.member_limit, 0);

  -- Repetir a mesma requisicao devolve o convite original e nunca compra
  -- outro slot. O lock da conta serializa cliques/retries concorrentes.
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.imf_broker_invites AS invite
     WHERE invite.broker_id = p_broker_id
       AND invite.request_id = p_request_id;
    IF FOUND THEN
      invite_id := v_existing.id;
      invite_code := v_existing.code;
      invite_whatsapp_mode := v_existing.whatsapp_mode;
      invite_expires_at := v_existing.expires_at;
      slot_added := v_existing.added_whatsapp_slot;
      member_limit := v_new_member_limit;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_broker.plan = 'experimentacao' THEN
    IF v_broker.trial_ends_at IS NULL OR v_broker.trial_ends_at <= NOW() THEN
      RAISE EXCEPTION 'TRIAL_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    SELECT
      (SELECT count(*) FROM public.imf_broker_members m
        WHERE m.broker_id = p_broker_id AND m.user_id <> v_broker.user_id)
      +
      (SELECT count(*) FROM public.imf_broker_invites i
        WHERE i.broker_id = p_broker_id AND i.used_at IS NULL AND i.expires_at > NOW())
    INTO v_reserved;

    IF v_reserved >= COALESCE(v_broker.trial_member_limit, 0) THEN
      RAISE EXCEPTION 'TRIAL_MEMBER_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_whatsapp_mode = 'own' THEN
    v_whatsapp_limit := CASE
      WHEN v_broker.plan = 'experimentacao' THEN COALESCE(v_broker.trial_whatsapp_member_limit, 0)
      ELSE COALESCE(v_broker.member_limit, 0)
    END;

    SELECT
      (SELECT count(*) FROM public.imf_broker_members m
        WHERE m.broker_id = p_broker_id
          AND m.user_id <> v_broker.user_id
          AND m.whatsapp_mode = 'own')
      +
      (SELECT count(*) FROM public.imf_broker_invites i
        WHERE i.broker_id = p_broker_id
          AND i.whatsapp_mode = 'own'
          AND i.used_at IS NULL
          AND i.expires_at > NOW())
    INTO v_whatsapp_reserved;

    IF v_whatsapp_reserved >= v_whatsapp_limit THEN
      IF v_broker.plan = 'experimentacao' THEN
        RAISE EXCEPTION 'TRIAL_WHATSAPP_LIMIT_REACHED' USING ERRCODE = 'P0001';
      END IF;

      IF v_whatsapp_limit >= p_whatsapp_slot_max THEN
        RAISE EXCEPTION 'WHATSAPP_MEMBER_SLOT_MAX_REACHED' USING ERRCODE = 'P0001';
      END IF;

      IF NOT p_confirm_add_whatsapp_slot THEN
        RAISE EXCEPTION 'WHATSAPP_MEMBER_LIMIT_REACHED' USING ERRCODE = 'P0001';
      END IF;

      v_new_member_limit := v_whatsapp_limit + 1;
      UPDATE public.imf_brokers AS broker
         SET member_limit = v_new_member_limit
       WHERE broker.id = p_broker_id;
      slot_added := TRUE;
    ELSE
      v_new_member_limit := v_whatsapp_limit;
    END IF;
  END IF;

  INSERT INTO public.imf_broker_invites (
    broker_id, code, expires_at, whatsapp_mode, request_id, added_whatsapp_slot
  )
  VALUES (
    p_broker_id, p_code, p_expires_at, p_whatsapp_mode, p_request_id, slot_added
  )
  RETURNING id INTO v_id;

  invite_id := v_id;
  invite_code := p_code;
  invite_whatsapp_mode := p_whatsapp_mode;
  invite_expires_at := p_expires_at;
  member_limit := v_new_member_limit;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID, BOOLEAN, INTEGER)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
