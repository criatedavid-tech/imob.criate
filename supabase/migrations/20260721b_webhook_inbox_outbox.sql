-- Fila duravel para a entrada UAZAPI e o despacho ao n8n.
--
-- A API confirma o webhook somente depois do INSERT em imf_webhook_inbox.
-- Workers fazem claim atomico em lotes pequenos, com lease recuperavel apos
-- crash. A outbox desacopla a persistencia da mensagem da disponibilidade do
-- n8n e entrega os eventos no modelo at-least-once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_webhook_inbox (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                 TEXT NOT NULL DEFAULT 'uazapi',
  instance_id            TEXT NOT NULL,
  broker_id              UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  instance_owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type             TEXT NOT NULL,
  dedupe_key             TEXT NOT NULL,
  partition_key          TEXT NOT NULL,
  payload                JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'processing', 'completed', 'ignored', 'dead')),
  attempts               INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at              TIMESTAMPTZ,
  locked_by              TEXT,
  processed_at           TIMESTAMPTZ,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, instance_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_imf_webhook_inbox_due
  ON public.imf_webhook_inbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_imf_webhook_inbox_partition
  ON public.imf_webhook_inbox (partition_key, created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS public.imf_webhook_outbox (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,
  aggregate_id      UUID NOT NULL REFERENCES public.imf_webhook_inbox(id) ON DELETE CASCADE,
  broker_id         UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  partition_key     TEXT NOT NULL,
  payload           JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'dead')),
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,
  delivered_at      TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_type, aggregate_id)
);

CREATE INDEX IF NOT EXISTS idx_imf_webhook_outbox_due
  ON public.imf_webhook_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_imf_webhook_outbox_partition
  ON public.imf_webhook_outbox (partition_key, created_at, id)
  WHERE status IN ('pending', 'processing');

-- Evita scans completos na resolucao de qual conta recebeu o webhook.
CREATE INDEX IF NOT EXISTS idx_imf_brokers_uazapi_instance_id
  ON public.imf_brokers (uazapi_instance_id)
  WHERE uazapi_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_imf_broker_members_uazapi_instance_id
  ON public.imf_broker_members (uazapi_instance_id)
  WHERE uazapi_instance_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_imf_webhook_inbox(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF public.imf_webhook_inbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT queue.id
    FROM public.imf_webhook_inbox AS queue
    WHERE (
      (queue.status = 'pending' AND queue.next_attempt_at <= now())
      OR (
        queue.status = 'processing'
        AND (
          queue.locked_at IS NULL
          OR queue.locked_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 30))
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.imf_webhook_inbox AS older
      WHERE older.partition_key = queue.partition_key
        AND older.status IN ('pending', 'processing')
        AND (older.created_at, older.id) < (queue.created_at, queue.id)
    )
    ORDER BY queue.created_at, queue.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 100)
  )
  UPDATE public.imf_webhook_inbox AS queue
  SET status = 'processing',
      attempts = queue.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable
  WHERE queue.id = claimable.id
  RETURNING queue.*;
$$;

CREATE OR REPLACE FUNCTION public.claim_imf_webhook_outbox(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.imf_webhook_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT queue.id
    FROM public.imf_webhook_outbox AS queue
    WHERE (
      (queue.status = 'pending' AND queue.next_attempt_at <= now())
      OR (
        queue.status = 'processing'
        AND (
          queue.locked_at IS NULL
          OR queue.locked_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 30))
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.imf_webhook_outbox AS older
      WHERE older.partition_key = queue.partition_key
        AND older.status IN ('pending', 'processing')
        AND (older.created_at, older.id) < (queue.created_at, queue.id)
    )
    ORDER BY queue.created_at, queue.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 200)
  )
  UPDATE public.imf_webhook_outbox AS queue
  SET status = 'processing',
      attempts = queue.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable
  WHERE queue.id = claimable.id
  RETURNING queue.*;
$$;

ALTER TABLE public.imf_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imf_webhook_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.imf_webhook_inbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.imf_webhook_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_webhook_inbox TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_webhook_outbox TO service_role;

REVOKE ALL ON FUNCTION public.claim_imf_webhook_inbox(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_imf_webhook_outbox(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_imf_webhook_inbox(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_imf_webhook_outbox(TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;
