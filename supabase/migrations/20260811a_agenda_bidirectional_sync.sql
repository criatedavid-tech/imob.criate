-- ============================================================
-- Agenda bidirecional: Google Calendar OAuth + CalDAV do iPhone
-- ============================================================
-- Todas as credenciais são acessadas exclusivamente pelo backend com
-- service_role. Tokens OAuth ficam cifrados por AES-256-GCM; a senha CalDAV
-- é aleatória, mostrada uma única vez e persistida somente como SHA-256.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.imf_agenda_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'caldav')),
  include_all BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reauthorize', 'error', 'disabled')),
  provider_account TEXT,
  external_calendar_id TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  sync_cursor TEXT,
  caldav_username TEXT UNIQUE,
  caldav_password_hash TEXT
    CHECK (caldav_password_hash IS NULL OR caldav_password_hash ~ '^[0-9a-f]{64}$'),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  sync_lease_token TEXT,
  sync_lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, provider),
  CHECK (
    (provider = 'google' AND refresh_token_enc IS NOT NULL AND external_calendar_id IS NOT NULL)
    OR
    (provider = 'caldav' AND caldav_username IS NOT NULL AND caldav_password_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agenda_calendar_connections_provider_status
  ON public.imf_agenda_calendar_connections (provider, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_agenda_calendar_connections_broker
  ON public.imf_agenda_calendar_connections (broker_id);

-- Lease atômico: impede o botão "Sincronizar agora" (processo web) e o
-- scheduler de criarem o mesmo evento externo simultaneamente.
CREATE OR REPLACE FUNCTION public.imf_claim_agenda_calendar_sync(
  p_connection_id UUID,
  p_lease_token TEXT,
  p_lease_until TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id UUID;
BEGIN
  UPDATE public.imf_agenda_calendar_connections
     SET sync_lease_token = p_lease_token,
         sync_lease_until = p_lease_until,
         updated_at = NOW()
   WHERE id = p_connection_id
     AND (sync_lease_until IS NULL OR sync_lease_until < NOW())
  RETURNING id INTO claimed_id;
  RETURN claimed_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.imf_release_agenda_calendar_sync(
  p_connection_id UUID,
  p_lease_token TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.imf_agenda_calendar_connections
     SET sync_lease_token = NULL,
         sync_lease_until = NULL,
         updated_at = NOW()
   WHERE id = p_connection_id
     AND sync_lease_token = p_lease_token;
$$;

CREATE TABLE IF NOT EXISTS public.imf_agenda_calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL
    REFERENCES public.imf_agenda_calendar_connections(id) ON DELETE CASCADE,
  agenda_id UUID REFERENCES public.imf_agenda(id) ON DELETE SET NULL,
  external_event_id TEXT NOT NULL,
  external_uid TEXT,
  external_etag TEXT,
  local_hash TEXT,
  remote_updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_calendar_event_links_agenda
  ON public.imf_agenda_calendar_event_links (connection_id, agenda_id)
  WHERE agenda_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_calendar_event_links_tombstones
  ON public.imf_agenda_calendar_event_links (connection_id, deleted_at)
  WHERE agenda_id IS NULL;

-- O callback OAuth não possui o JWT do navegador. O state aleatório, de uso
-- único e vida curta, liga a resposta do Google ao usuário que iniciou o fluxo.
CREATE TABLE IF NOT EXISTS public.imf_agenda_calendar_oauth_states (
  state_hash TEXT PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  broker_id UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  include_all BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agenda_calendar_oauth_states_expiry
  ON public.imf_agenda_calendar_oauth_states (expires_at);

-- Preserva uma lápide para o Google receber o DELETE mesmo quando um evento é
-- apagado pelo app, pelo agente interno ou pelo N8N antes do próximo ciclo.
CREATE OR REPLACE FUNCTION public.imf_mark_calendar_event_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.imf_agenda_calendar_event_links
     SET agenda_id = NULL,
         deleted_at = NOW(),
         updated_at = NOW()
   WHERE agenda_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_imf_mark_calendar_event_deleted ON public.imf_agenda;
CREATE TRIGGER trg_imf_mark_calendar_event_deleted
  BEFORE DELETE ON public.imf_agenda
  FOR EACH ROW EXECUTE FUNCTION public.imf_mark_calendar_event_deleted();

ALTER TABLE public.imf_agenda_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imf_agenda_calendar_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imf_agenda_calendar_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.imf_agenda_calendar_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.imf_agenda_calendar_event_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.imf_agenda_calendar_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_agenda_calendar_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_agenda_calendar_event_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_agenda_calendar_oauth_states TO service_role;
REVOKE ALL ON FUNCTION public.imf_claim_agenda_calendar_sync(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.imf_release_agenda_calendar_sync(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_claim_agenda_calendar_sync(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.imf_release_agenda_calendar_sync(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.imf_mark_calendar_event_deleted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_mark_calendar_event_deleted() TO service_role;

COMMENT ON TABLE public.imf_agenda_calendar_connections IS
  'Conexões privadas da Agenda com Google Calendar ou cliente CalDAV do iPhone.';
COMMENT ON TABLE public.imf_agenda_calendar_event_links IS
  'Mapeamento idempotente entre imf_agenda e recursos externos de calendário.';
COMMENT ON TABLE public.imf_agenda_calendar_oauth_states IS
  'States OAuth de uso único e curta duração; acesso exclusivo do backend.';
