-- Revogação administrativa e atômica de vouchers de experimentação.
--
-- Voucher ainda ativo: invalida somente o convite.
-- Voucher já utilizado: invalida o voucher e encerra imediatamente o acesso
-- da conta, desde que ela ainda pertença ao plano de experimentação.

CREATE OR REPLACE FUNCTION public.imf_revoke_trial_voucher(
  p_voucher_id UUID,
  p_admin_user_id UUID
)
RETURNS TABLE (
  voucher_id UUID,
  voucher_status TEXT,
  broker_id UUID,
  broker_status TEXT,
  revoked_access BOOLEAN,
  cancelled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voucher public.imf_trial_vouchers%ROWTYPE;
  v_broker public.imf_brokers%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.imf_brokers
     WHERE user_id = p_admin_user_id
       AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Somente o administrador do sistema pode revogar vouchers.';
  END IF;

  SELECT * INTO v_voucher
    FROM public.imf_trial_vouchers
   WHERE id = p_voucher_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher não encontrado.';
  END IF;

  IF v_voucher.status NOT IN ('active', 'used') THEN
    RAISE EXCEPTION 'Somente vouchers ativos ou utilizados podem ser revogados.';
  END IF;

  IF v_voucher.status = 'active' THEN
    UPDATE public.imf_trial_vouchers
       SET status = 'cancelled',
           cancelled_at = v_now,
           cancelled_by = p_admin_user_id,
           updated_at = v_now
     WHERE id = v_voucher.id;

    RETURN QUERY SELECT
      v_voucher.id,
      'cancelled'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      FALSE,
      v_now;
    RETURN;
  END IF;

  IF v_voucher.broker_id IS NULL THEN
    RAISE EXCEPTION 'O voucher utilizado não possui uma conta vinculada.';
  END IF;

  SELECT * INTO v_broker
    FROM public.imf_brokers
   WHERE id = v_voucher.broker_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conta vinculada ao voucher não foi encontrada.';
  END IF;

  IF v_broker.trial_voucher_id IS DISTINCT FROM v_voucher.id
     OR v_broker.plan IS DISTINCT FROM 'experimentacao' THEN
    RAISE EXCEPTION 'A conta vinculada não está mais na experimentação concedida por este voucher.';
  END IF;

  UPDATE public.imf_brokers
     SET status = 'inativo'
   WHERE id = v_broker.id;

  UPDATE public.imf_trial_vouchers
     SET status = 'cancelled',
         cancelled_at = v_now,
         cancelled_by = p_admin_user_id,
         updated_at = v_now
   WHERE id = v_voucher.id;

  RETURN QUERY SELECT
    v_voucher.id,
    'cancelled'::TEXT,
    v_broker.id,
    'inativo'::TEXT,
    TRUE,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.imf_revoke_trial_voucher(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_revoke_trial_voucher(UUID, UUID) TO service_role;
