-- Meta por pessoa em imf_broker_goals: user_id NULL = meta da conta inteira
-- (comportamento atual, preservado); user_id preenchido = meta pessoal
-- daquele membro, com fallback pra meta da conta quando ele nao tem uma.

ALTER TABLE imf_broker_goals
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- A UNIQUE(broker_id, month) original so fazia sentido quando so existia a
-- meta da conta (user_id sempre NULL). Agora multiplas linhas por mes sao
-- validas (conta + N membros) - troca por dois indices unicos parciais que,
-- juntos, preservam a garantia antiga e adicionam a nova.
ALTER TABLE imf_broker_goals DROP CONSTRAINT IF EXISTS imf_broker_goals_broker_id_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS imf_broker_goals_account_unique
  ON imf_broker_goals (broker_id, month) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS imf_broker_goals_member_unique
  ON imf_broker_goals (broker_id, month, user_id) WHERE user_id IS NOT NULL;
