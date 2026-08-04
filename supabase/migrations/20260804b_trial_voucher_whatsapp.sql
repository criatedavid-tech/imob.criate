-- Cota independente de WhatsApp proprio para corretores convidados por voucher.
-- O titular da conta continua usando a instancia principal; esta cota vale apenas
-- para membros adicionais da imobiliaria/incorporadora.

BEGIN;

ALTER TABLE public.imf_trial_vouchers
  ADD COLUMN IF NOT EXISTS whatsapp_member_limit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.imf_trial_vouchers
  DROP CONSTRAINT IF EXISTS imf_trial_vouchers_whatsapp_member_limit_check;
ALTER TABLE public.imf_trial_vouchers
  ADD CONSTRAINT imf_trial_vouchers_whatsapp_member_limit_check
  CHECK (whatsapp_member_limit BETWEEN 0 AND 100 AND whatsapp_member_limit <= member_limit);

ALTER TABLE public.imf_brokers
  ADD COLUMN IF NOT EXISTS trial_whatsapp_member_limit INTEGER;

ALTER TABLE public.imf_brokers
  DROP CONSTRAINT IF EXISTS imf_brokers_trial_whatsapp_member_limit_check;
ALTER TABLE public.imf_brokers
  ADD CONSTRAINT imf_brokers_trial_whatsapp_member_limit_check
  CHECK (
    trial_whatsapp_member_limit IS NULL
    OR (
      trial_whatsapp_member_limit BETWEEN 0 AND 100
      AND trial_whatsapp_member_limit <= COALESCE(trial_member_limit, 0)
    )
  );

UPDATE public.imf_brokers AS broker
   SET trial_whatsapp_member_limit = voucher.whatsapp_member_limit
  FROM public.imf_trial_vouchers AS voucher
 WHERE broker.trial_voucher_id = voucher.id
   AND broker.trial_whatsapp_member_limit IS NULL;

CREATE INDEX IF NOT EXISTS idx_imf_broker_invites_pending_whatsapp
  ON public.imf_broker_invites (broker_id, whatsapp_mode, expires_at)
  WHERE used_at IS NULL;

-- Resgata o voucher e copia as duas cotas separadamente para a conta.
CREATE OR REPLACE FUNCTION public.imf_redeem_trial_voucher(
  p_code_hash TEXT,
  p_user_id UUID,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT
)
RETURNS TABLE (broker_id UUID, account_type TEXT, trial_ends_at TIMESTAMPTZ, member_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voucher public.imf_trial_vouchers%ROWTYPE;
  v_broker_id UUID;
  v_trial_ends_at TIMESTAMPTZ;
  v_member_limit INTEGER;
  v_whatsapp_member_limit INTEGER;
BEGIN
  SELECT * INTO v_voucher
    FROM public.imf_trial_vouchers
   WHERE code_hash = p_code_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIAL_VOUCHER_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.status <> 'active' THEN
    RAISE EXCEPTION 'TRIAL_VOUCHER_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_voucher.invite_expires_at <= NOW() THEN
    UPDATE public.imf_trial_vouchers
       SET status = 'expired', updated_at = NOW()
     WHERE id = v_voucher.id;
    RAISE EXCEPTION 'TRIAL_VOUCHER_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.imf_brokers WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'TRIAL_USER_ALREADY_HAS_ACCOUNT' USING ERRCODE = '23505';
  END IF;

  v_trial_ends_at := NOW() + make_interval(days => v_voucher.trial_days);
  v_member_limit := CASE WHEN v_voucher.account_type = 'corretor' THEN 0 ELSE v_voucher.member_limit END;
  v_whatsapp_member_limit := CASE
    WHEN v_voucher.account_type = 'corretor' THEN 0
    ELSE LEAST(v_voucher.whatsapp_member_limit, v_member_limit)
  END;

  INSERT INTO public.imf_brokers (
    user_id, name, phone, email, ai_name, broker_address, account_type,
    status, plan, valid_until, member_limit, trial_voucher_id,
    trial_started_at, trial_ends_at, trial_member_limit, trial_whatsapp_member_limit
  ) VALUES (
    p_user_id, btrim(p_name), p_phone, lower(btrim(p_email)),
    'Minha Assistente IA', '', v_voucher.account_type,
    -- member_limit continua reservado ao add-on pago. Durante o teste, a
    -- autorizacao vem exclusivamente de trial_whatsapp_member_limit.
    'ativo', 'experimentacao', v_trial_ends_at, 0, v_voucher.id,
    NOW(), v_trial_ends_at, v_member_limit, v_whatsapp_member_limit
  )
  RETURNING id INTO v_broker_id;

  INSERT INTO public.imf_broker_members (broker_id, user_id)
  VALUES (v_broker_id, p_user_id);

  UPDATE public.imf_trial_vouchers
     SET status = 'used', used_at = NOW(), used_by = p_user_id,
         broker_id = v_broker_id, updated_at = NOW()
   WHERE id = v_voucher.id;

  RETURN QUERY SELECT v_broker_id, v_voucher.account_type, v_trial_ends_at, v_member_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_redeem_trial_voucher(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_redeem_trial_voucher(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

-- Emite convite sob lock da conta. Convites pendentes reservam tanto uma vaga
-- de equipe quanto, quando solicitado, uma vaga de WhatsApp proprio.
CREATE OR REPLACE FUNCTION public.imf_create_broker_invite(
  p_broker_id UUID,
  p_code TEXT,
  p_expires_at TIMESTAMPTZ,
  p_whatsapp_mode TEXT DEFAULT 'shared'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broker public.imf_brokers%ROWTYPE;
  v_reserved INTEGER;
  v_whatsapp_reserved INTEGER;
  v_whatsapp_limit INTEGER;
  v_id UUID;
BEGIN
  IF p_whatsapp_mode IS NULL OR p_whatsapp_mode NOT IN ('shared', 'own') THEN
    RAISE EXCEPTION 'INVITE_WHATSAPP_MODE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_broker FROM public.imf_brokers WHERE id = p_broker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BROKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

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
      ELSE
        RAISE EXCEPTION 'WHATSAPP_MEMBER_LIMIT_REACHED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.imf_broker_invites (broker_id, code, expires_at, whatsapp_mode)
  VALUES (p_broker_id, p_code, p_expires_at, p_whatsapp_mode)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- Revalida as cotas ao aceitar. Isso protege contra reducoes de limite e
-- aceites concorrentes; o lock no broker serializa as reivindicacoes.
CREATE OR REPLACE FUNCTION public.imf_claim_broker_invite(p_code TEXT)
RETURNS TABLE (broker_id UUID, whatsapp_mode TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.imf_broker_invites%ROWTYPE;
  v_broker public.imf_brokers%ROWTYPE;
  v_in_use INTEGER;
  v_whatsapp_in_use INTEGER;
  v_whatsapp_limit INTEGER;
BEGIN
  SELECT * INTO v_invite
    FROM public.imf_broker_invites
   WHERE code = p_code
   FOR UPDATE;

  IF NOT FOUND OR v_invite.used_at IS NOT NULL OR v_invite.expires_at <= NOW() THEN
    RAISE EXCEPTION 'INVITE_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_broker FROM public.imf_brokers WHERE id = v_invite.broker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BROKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF v_broker.plan = 'experimentacao' THEN
    IF v_broker.trial_ends_at IS NULL OR v_broker.trial_ends_at <= NOW() THEN
      RAISE EXCEPTION 'TRIAL_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    SELECT
      (SELECT count(*) FROM public.imf_broker_members m
        WHERE m.broker_id = v_broker.id AND m.user_id <> v_broker.user_id)
      +
      (SELECT count(*) FROM public.imf_broker_invites i
        WHERE i.broker_id = v_broker.id AND i.used_at IS NOT NULL AND i.used_by IS NULL)
    INTO v_in_use;

    IF v_in_use >= COALESCE(v_broker.trial_member_limit, 0) THEN
      RAISE EXCEPTION 'TRIAL_MEMBER_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_invite.whatsapp_mode = 'own' THEN
    v_whatsapp_limit := CASE
      WHEN v_broker.plan = 'experimentacao' THEN COALESCE(v_broker.trial_whatsapp_member_limit, 0)
      ELSE COALESCE(v_broker.member_limit, 0)
    END;

    SELECT
      (SELECT count(*) FROM public.imf_broker_members m
        WHERE m.broker_id = v_broker.id
          AND m.user_id <> v_broker.user_id
          AND m.whatsapp_mode = 'own')
      +
      (SELECT count(*) FROM public.imf_broker_invites i
        WHERE i.broker_id = v_broker.id
          AND i.whatsapp_mode = 'own'
          AND i.used_at IS NOT NULL
          AND i.used_by IS NULL)
    INTO v_whatsapp_in_use;

    IF v_whatsapp_in_use >= v_whatsapp_limit THEN
      IF v_broker.plan = 'experimentacao' THEN
        RAISE EXCEPTION 'TRIAL_WHATSAPP_LIMIT_REACHED' USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'WHATSAPP_MEMBER_LIMIT_REACHED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.imf_broker_invites SET used_at = NOW() WHERE id = v_invite.id;
  RETURN QUERY SELECT v_invite.broker_id, v_invite.whatsapp_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_claim_broker_invite(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_claim_broker_invite(TEXT) TO service_role;

COMMIT;
