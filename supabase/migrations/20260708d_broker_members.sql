-- Multi-usuário leve pra Equipe: vários logins (auth.users) podem acessar a
-- MESMA conta ImobiFlow (broker) — mesmos dados, mesma assinatura, mesma
-- permissão (sem hierarquia/papéis ainda, decisão de produto adiada). O dono
-- original (imf_brokers.user_id) continua existindo (cobrança, contato), mas
-- deixa de ser o único jeito de acessar a conta.

CREATE TABLE IF NOT EXISTS imf_broker_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id  UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_members_broker ON imf_broker_members (broker_id);

ALTER TABLE imf_broker_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "member_sees_own_membership" ON imf_broker_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Backfill: dono original de cada conta existente vira membro também, pra
-- getBrokerId() já encontrar todo mundo pela mesma tabela a partir de agora.
INSERT INTO imf_broker_members (broker_id, user_id)
SELECT id, user_id FROM imf_brokers
ON CONFLICT (user_id) DO NOTHING;

-- Convite de entrada — código de uso único, com validade curta.
CREATE TABLE IF NOT EXISTS imf_broker_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id  UUID NOT NULL REFERENCES imf_brokers(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  used_by    UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_broker_invites_code ON imf_broker_invites (code);

ALTER TABLE imf_broker_invites ENABLE ROW LEVEL SECURITY;
