-- ============================================================
-- WhatsApp Pai — vínculo de telefone verificado por usuário
-- ============================================================
-- Fase 2 do plano WhatsApp Pai (.claude/plans/zany-forging-curry.md):
-- antes de qualquer comando pelo futuro WhatsApp central ser aceito, o
-- número de quem está mandando precisa estar provado como dele —
-- vínculo feito dentro do painel (já autenticado), com um código de 6
-- dígitos enviado de verdade pelo WhatsApp da própria plataforma
-- (UAZAPI_PLATFORM_SESSION, já usado hoje só pra recuperação de senha).
-- Nunca auto-vincula por mensagem de número desconhecido.
--
-- PK é o telefone normalizado, não user_id: o caminho quente no futuro
-- inbound é "esse telefone bate com quem" — busca direta O(1). Sem
-- broker_id: derivado em tempo de leitura via getBrokerId(user_id), já
-- cacheado — evita guardar um dado derivado que ficaria desatualizado se
-- o usuário mudasse de conta.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_whatsapp_staff_links (
  phone_normalized TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at       TIMESTAMPTZ,
  otp_code_hash     TEXT,
  otp_expires_at    TIMESTAMPTZ,
  otp_attempts      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_staff_links_user
  ON public.imf_whatsapp_staff_links (user_id);

ALTER TABLE public.imf_whatsapp_staff_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_whatsapp_staff_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_whatsapp_staff_links TO service_role;

COMMIT;
