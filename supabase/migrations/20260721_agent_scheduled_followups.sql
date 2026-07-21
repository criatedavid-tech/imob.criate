-- ============================================================
-- Follow-up agendado pelo Assistente IA (ação "schedule_followup")
-- ============================================================
-- Suporta o pedido "envie em 24h um follow-up pro fulano" no Assistente
-- interno (server/services/agent.ts). Diferente de send_message (envio
-- imediato) e diferente do Follow-Up Inteligente (régua automática por
-- status de conversa, followup_config/followup_conversations) — aqui é
-- um envio pontual, agendado ad-hoc para um contato específico.
--
-- Concorrência entre as 2 VMs do Fly: reaproveita o lock distribuído
-- genérico try_billing_lock()/release_billing_lock() já criado em
-- 20260630_billing_lock_and_rls.sql (mesmo padrão usado por
-- prepareOverageBilling/reconcilePendingBillingActions/
-- expireDueUnitReservations) — não precisa de uma RPC de claim nova.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase antes
-- de publicar o backend que depende desta tabela.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS imf_agent_scheduled_followups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id      UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL REFERENCES auth.users(id),
  contact_name   TEXT NOT NULL,
  contact_phone  TEXT NOT NULL,
  message        TEXT NOT NULL,
  due_at         TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at        TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta do job (status + prazo vencido) e listagem por conta/dono.
CREATE INDEX IF NOT EXISTS idx_agent_scheduled_followups_due
  ON imf_agent_scheduled_followups (status, due_at);
CREATE INDEX IF NOT EXISTS idx_agent_scheduled_followups_broker
  ON imf_agent_scheduled_followups (broker_id, owner_user_id);

-- RLS: mesmo padrão de imf_agenda/imf_properties (20260630_billing_lock_and_rls.sql).
-- O backend usa service_role (ignora RLS) — isto é rede de segurança contra
-- acesso direto via anon/authenticated.
ALTER TABLE imf_agent_scheduled_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "broker_own_agent_scheduled_followups" ON imf_agent_scheduled_followups;
CREATE POLICY "broker_own_agent_scheduled_followups" ON imf_agent_scheduled_followups
  USING (broker_id = (
    SELECT id FROM imf_brokers WHERE user_id = auth.uid() LIMIT 1
  ));

COMMIT;
