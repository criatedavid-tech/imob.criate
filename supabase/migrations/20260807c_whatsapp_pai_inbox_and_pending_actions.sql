-- ============================================================
-- WhatsApp Pai — fila durável de inbound + confirmação persistida
-- ============================================================
-- Fase 4 do plano WhatsApp Pai (.claude/plans/zany-forging-curry.md):
-- fila própria pro Pai (não estende imf_webhook_inbox, que está
-- entrelaçada com despacho pro n8n e debounce, irrelevantes aqui — nativo,
-- sem n8n, sem debounce). Mesmo padrão SKIP LOCKED comprovado em
-- claim_imf_webhook_inbox (20260721b_webhook_inbox_outbox.sql), adaptado:
-- partição por sender_phone (não broker_id — o Pai não sabe de quem é a
-- mensagem até resolver o telefone) garante que mensagens da MESMA pessoa
-- nunca processam fora de ordem/concorrentes.
--
-- imf_whatsapp_pending_actions guarda só o estado ATUAL da ação proposta
-- aguardando confirmação — PK em user_id (não precisa de outra coluna:
-- imf_broker_members.user_id já é UNIQUE, 1 usuário = 1 broker sempre),
-- o que já garante "1 ação pendente por remetente" de graça.
--
-- imf_agent_log ganha channel (histórico do assistente passa a ser
-- compartilhado entre painel web e WhatsApp — mesmo usuário, mesmo
-- cérebro, memória contínua) e provider_message_id (índice único parcial
-- = trava de idempotência: antes de reprocessar uma linha da fila depois
-- de um crash, checa se essa mensagem já foi logada — se sim, não
-- reexecuta).
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.imf_pai_inbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key      TEXT NOT NULL UNIQUE,
  sender_phone    TEXT NOT NULL,
  payload         JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'ignored', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  processed_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imf_pai_inbox_due
  ON public.imf_pai_inbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_imf_pai_inbox_partition
  ON public.imf_pai_inbox (sender_phone, created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.claim_imf_pai_inbox(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF public.imf_pai_inbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT queue.id
    FROM public.imf_pai_inbox AS queue
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
      FROM public.imf_pai_inbox AS older
      WHERE older.sender_phone = queue.sender_phone
        AND older.status IN ('pending', 'processing')
        AND (older.created_at, older.id) < (queue.created_at, queue.id)
    )
    ORDER BY queue.created_at, queue.id
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 100)
  )
  UPDATE public.imf_pai_inbox AS queue
  SET status = 'processing',
      attempts = queue.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable
  WHERE queue.id = claimable.id
  RETURNING queue.*;
$$;

ALTER TABLE public.imf_pai_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_pai_inbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_pai_inbox TO service_role;

REVOKE ALL ON FUNCTION public.claim_imf_pai_inbox(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_imf_pai_inbox(TEXT, INTEGER, INTEGER) TO service_role;

CREATE TABLE IF NOT EXISTS public.imf_whatsapp_pending_actions (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id     UUID NOT NULL REFERENCES public.imf_brokers(id) ON DELETE CASCADE,
  action        JSONB NOT NULL CHECK (jsonb_typeof(action) = 'object'),
  reply_preview TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'executed', 'cancelled', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.imf_whatsapp_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imf_whatsapp_pending_actions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.imf_whatsapp_pending_actions TO service_role;

ALTER TABLE public.imf_agent_log
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_log_provider_message
  ON public.imf_agent_log (broker_id, user_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMIT;
