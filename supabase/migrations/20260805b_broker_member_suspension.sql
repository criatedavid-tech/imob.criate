-- Suspensao de membro individual da equipe, sem remover o vinculo.
-- Espelha o mesmo espirito do bloqueio de conta inteira (imf_brokers.status
-- <> 'ativo' em requireUser), so que por pessoa e reversivel.

ALTER TABLE imf_broker_members
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_broker_members_suspended
  ON imf_broker_members (broker_id) WHERE suspended_at IS NOT NULL;
