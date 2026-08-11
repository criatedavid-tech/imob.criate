-- Piloto automatico persistente, agrupamento de fotos do WhatsApp Pai e
-- rastreabilidade operacional. Nao executar automaticamente: aplicar pelo
-- SQL Editor do Supabase antes de publicar o codigo correspondente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_agent_preferences (
  broker_id  UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  autonomy   TEXT NOT NULL DEFAULT 'piloto'
               CHECK (autonomy IN ('piloto', 'copiloto', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (broker_id, user_id)
);

ALTER TABLE public.imf_agent_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_agent_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_agent_preferences TO service_role;

-- Uma linha representa o album/lote ainda aberto de um corretor. O worker
-- somente fecha o lote depois de alguns segundos sem novas fotos.
CREATE TABLE IF NOT EXISTS public.imf_whatsapp_media_batches (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id           UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  sender_phone        TEXT NOT NULL,
  caption             TEXT,
  caption_message_id  TEXT,
  caption_media_url   TEXT,
  caption_media_type  TEXT CHECK (caption_media_type IS NULL OR caption_media_type = 'audio'),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing')),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '4 seconds',
  locked_at           TIMESTAMPTZ,
  locked_by           TEXT,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imf_whatsapp_media_batches_due
  ON public.imf_whatsapp_media_batches (next_attempt_at, updated_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.imf_whatsapp_media_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_whatsapp_media_batches FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_whatsapp_media_batches TO service_role;

CREATE OR REPLACE FUNCTION public.imf_stage_whatsapp_media_batch(
  p_user_id UUID,
  p_broker_id UUID,
  p_sender_phone TEXT,
  p_caption TEXT DEFAULT NULL,
  p_caption_message_id TEXT DEFAULT NULL,
  p_caption_media_url TEXT DEFAULT NULL,
  p_caption_media_type TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.imf_whatsapp_media_batches (
    user_id, broker_id, sender_phone, caption, caption_message_id, caption_media_url, caption_media_type,
    status, attempts, next_attempt_at, locked_at, locked_by, last_error,
    created_at, updated_at
  ) VALUES (
    p_user_id, p_broker_id, p_sender_phone,
    NULLIF(btrim(coalesce(p_caption, '')), ''), p_caption_message_id, p_caption_media_url, p_caption_media_type,
    'pending', 0, now() + interval '4 seconds', NULL, NULL, NULL,
    now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    broker_id = EXCLUDED.broker_id,
    sender_phone = EXCLUDED.sender_phone,
    caption = coalesce(EXCLUDED.caption, public.imf_whatsapp_media_batches.caption),
    caption_message_id = coalesce(EXCLUDED.caption_message_id, public.imf_whatsapp_media_batches.caption_message_id),
    caption_media_url = coalesce(EXCLUDED.caption_media_url, public.imf_whatsapp_media_batches.caption_media_url),
    caption_media_type = coalesce(EXCLUDED.caption_media_type, public.imf_whatsapp_media_batches.caption_media_type),
    status = 'pending',
    attempts = 0,
    next_attempt_at = now() + interval '4 seconds',
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.imf_stage_whatsapp_media_batch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_stage_whatsapp_media_batch(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.imf_claim_whatsapp_media_batches(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF public.imf_whatsapp_media_batches
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT batch.user_id
    FROM public.imf_whatsapp_media_batches AS batch
    WHERE (
      (batch.status = 'pending' AND batch.next_attempt_at <= now())
      OR (
        batch.status = 'processing'
        AND (batch.locked_at IS NULL OR batch.locked_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 30)))
      )
    )
    ORDER BY batch.next_attempt_at, batch.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 100)
  )
  UPDATE public.imf_whatsapp_media_batches AS batch
  SET status = 'processing',
      attempts = batch.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable
  WHERE batch.user_id = claimable.user_id
  RETURNING batch.*;
$$;

REVOKE ALL ON FUNCTION public.imf_claim_whatsapp_media_batches(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_claim_whatsapp_media_batches(TEXT, INTEGER, INTEGER)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.imf_system_error_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id          UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel            TEXT NOT NULL CHECK (channel IN (
                       'whatsapp_pai', 'painel_interno', 'integracao', 'worker', 'sistema'
                     )),
  category           TEXT NOT NULL CHECK (category IN (
                       'execution_error', 'integration_failure', 'agent_unhandled',
                       'tool_failure', 'validation_error', 'queue_failure'
                     )),
  requested_action   TEXT,
  stage              TEXT NOT NULL,
  public_message     TEXT,
  technical_message  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente', 'em_analise', 'resolvido')),
  context            JSONB NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(context) = 'object'),
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_imf_system_error_logs_broker_status
  ON public.imf_system_error_logs (broker_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_imf_system_error_logs_broker_channel
  ON public.imf_system_error_logs (broker_id, channel, occurred_at DESC);

ALTER TABLE public.imf_system_error_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_system_error_logs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_system_error_logs TO service_role;

-- Mantem @reset atomico incluindo o novo lote de fotos ainda aberto.
CREATE OR REPLACE FUNCTION public.imf_reset_agent_conversation(
  p_user_id UUID,
  p_broker_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_history_deleted INTEGER := 0;
  v_pending_deleted INTEGER := 0;
  v_media_deleted INTEGER := 0;
  v_batches_deleted INTEGER := 0;
  v_documents_deleted INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.imf_whatsapp_pending_actions AS pending
    WHERE pending.user_id = p_user_id AND pending.broker_id = p_broker_id
      AND pending.status IN ('executing', 'executed')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_in_progress');
  END IF;

  DELETE FROM public.imf_whatsapp_pending_actions
  WHERE user_id = p_user_id AND broker_id = p_broker_id;
  GET DIAGNOSTICS v_pending_deleted = ROW_COUNT;

  DELETE FROM public.imf_whatsapp_media_batches
  WHERE user_id = p_user_id AND broker_id = p_broker_id;
  GET DIAGNOSTICS v_batches_deleted = ROW_COUNT;

  DELETE FROM public.imf_whatsapp_staged_media
  WHERE user_id = p_user_id AND broker_id = p_broker_id;
  GET DIAGNOSTICS v_media_deleted = ROW_COUNT;

  DELETE FROM public.imf_whatsapp_staged_documents
  WHERE user_id = p_user_id AND broker_id = p_broker_id;
  GET DIAGNOSTICS v_documents_deleted = ROW_COUNT;

  DELETE FROM public.imf_agent_log
  WHERE user_id = p_user_id AND broker_id = p_broker_id;
  GET DIAGNOSTICS v_history_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'historyDeleted', v_history_deleted,
    'pendingActionsDeleted', v_pending_deleted,
    'stagedMediaDeleted', v_media_deleted,
    'stagedMediaBatchesDeleted', v_batches_deleted,
    'stagedDocumentsDeleted', v_documents_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.imf_reset_agent_conversation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imf_reset_agent_conversation(UUID, UUID)
  TO service_role;

COMMIT;
