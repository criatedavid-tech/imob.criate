-- Corrige a ambiguidade entre a coluna da tabela e a coluna de retorno
-- `phone_normalized` da RPC. Em PL/pgSQL, RETURNS TABLE cria variaveis de
-- saida com os mesmos nomes; por isso o conflict target pela coluna falhava
-- em runtime. Referenciar a constraint elimina a resolucao ambigua.

BEGIN;

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
  ON CONFLICT ON CONSTRAINT imf_whatsapp_staff_links_pkey DO UPDATE SET
    user_id = EXCLUDED.user_id,
    otp_code_hash = EXCLUDED.otp_code_hash,
    otp_expires_at = EXCLUDED.otp_expires_at,
    otp_attempts = 0,
    verified_at = NULL,
    updated_at = now()
  WHERE imf_whatsapp_staff_links.verified_at IS NULL
  RETURNING * INTO current_row;

  -- Uma insercao concorrente pode ter esperado outra transacao confirmar o
  -- numero. Nesse caso o WHERE impede a transferencia e nao ha RETURNING.
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

REVOKE ALL ON FUNCTION public.imf_start_whatsapp_phone_verification(UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_start_whatsapp_phone_verification(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

COMMIT;
