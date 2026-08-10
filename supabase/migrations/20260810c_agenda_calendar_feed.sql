-- ============================================================
-- Assinatura privada da Agenda em Google Calendar / Apple Calendar
-- ============================================================
-- O token público nunca é salvo em texto puro. O backend guarda apenas o
-- SHA-256 para localizar a assinatura e uma cópia AES-256-GCM para permitir
-- que o próprio usuário consulte novamente o endereço em Configurações.
-- A tabela não possui policies: somente o backend com service_role acessa.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.imf_agenda_calendar_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_enc TEXT NOT NULL,
  include_all BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_calendar_feeds_broker
  ON public.imf_agenda_calendar_feeds (broker_id);

ALTER TABLE public.imf_agenda_calendar_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_agenda_calendar_feeds FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.imf_agenda_calendar_feeds IS
  'Links privados de assinatura iCalendar da Agenda; acesso exclusivo pelo backend.';
