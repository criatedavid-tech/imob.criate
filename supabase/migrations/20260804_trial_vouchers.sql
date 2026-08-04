-- Vouchers administrativos de experimentacao.
-- O codigo bruto nunca e persistido: somente SHA-256, como um token de acesso.

CREATE TABLE IF NOT EXISTS public.imf_trial_vouchers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash          TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_hint          TEXT NOT NULL,
  account_type       TEXT NOT NULL CHECK (account_type IN ('corretor', 'imobiliaria', 'incorporadora')),
  invite_expires_at  TIMESTAMPTZ NOT NULL,
  trial_days         INTEGER NOT NULL CHECK (trial_days BETWEEN 1 AND 180),
  member_limit       INTEGER NOT NULL DEFAULT 0 CHECK (member_limit BETWEEN 0 AND 100),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at            TIMESTAMPTZ,
  used_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  broker_id          UUID REFERENCES public.imf_brokers(id) ON DELETE SET NULL,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_imf_trial_vouchers_status_expiry
  ON public.imf_trial_vouchers (status, invite_expires_at);

ALTER TABLE public.imf_trial_vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_trial_vouchers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_trial_vouchers TO service_role;

ALTER TABLE public.imf_brokers
  ADD COLUMN IF NOT EXISTS trial_voucher_id UUID REFERENCES public.imf_trial_vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_member_limit INTEGER;

ALTER TABLE public.imf_brokers
  DROP CONSTRAINT IF EXISTS imf_brokers_trial_member_limit_check;
ALTER TABLE public.imf_brokers
  ADD CONSTRAINT imf_brokers_trial_member_limit_check
  CHECK (trial_member_limit IS NULL OR trial_member_limit BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_imf_brokers_trial_expiry
  ON public.imf_brokers (trial_ends_at)
  WHERE plan = 'experimentacao' AND status = 'ativo';

-- Consome o voucher e cria o perfil + vinculo do titular na mesma transacao.
-- A linha e bloqueada para impedir dois cadastros simultaneos com o mesmo codigo.
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

  INSERT INTO public.imf_brokers (
    user_id, name, phone, email, ai_name, broker_address, account_type,
    status, plan, valid_until, member_limit, trial_voucher_id,
    trial_started_at, trial_ends_at, trial_member_limit
  ) VALUES (
    p_user_id, btrim(p_name), p_phone, lower(btrim(p_email)),
    'Minha Assistente IA', '', v_voucher.account_type,
    -- A cota do voucher libera logins de equipe, não instâncias próprias de
    -- WhatsApp (member_limit é o add-on pago e permanece zero no teste).
    'ativo', 'experimentacao', v_trial_ends_at, 0, v_voucher.id,
    NOW(), v_trial_ends_at, v_member_limit
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

-- Em contas de experimentacao, emitir convites tambem precisa respeitar a
-- cota. O lock no broker serializa duas emissoes concorrentes.
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
  v_id UUID;
BEGIN
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

  INSERT INTO public.imf_broker_invites (broker_id, code, expires_at, whatsapp_mode)
  VALUES (p_broker_id, p_code, p_expires_at, p_whatsapp_mode)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_create_broker_invite(UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- Reserva atomicamente uma vaga ao aceitar o convite. Convites ja emitidos
-- nao permitem ultrapassar a cota por concorrencia.
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

  UPDATE public.imf_broker_invites SET used_at = NOW() WHERE id = v_invite.id;
  RETURN QUERY SELECT v_invite.broker_id, v_invite.whatsapp_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_claim_broker_invite(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_claim_broker_invite(TEXT) TO service_role;
