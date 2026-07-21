-- Ativa a decisão de produto: WhatsApp por membro, escolhido pelo dono da
-- conta em cada convite ("própria" ou "compartilhada"), até um limite por
-- conta (member_limit, já existe em imf_brokers desde 20260710b). Continua
-- a preparação daquela migração — agora com as colunas que o código de fato
-- lê (ver server/services/provisioning.ts, server/routes/equipe.ts,
-- server/routes/auth.ts, server/routes/conversations.ts).

ALTER TABLE imf_broker_members
  ADD COLUMN IF NOT EXISTS whatsapp_mode text NOT NULL DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS provisioning_status text,
  ADD COLUMN IF NOT EXISTS provisioning_error text,
  ADD COLUMN IF NOT EXISTS provisioning_completed_at timestamptz;

ALTER TABLE imf_broker_members
  DROP CONSTRAINT IF EXISTS imf_broker_members_whatsapp_mode_check;
ALTER TABLE imf_broker_members
  ADD CONSTRAINT imf_broker_members_whatsapp_mode_check
  CHECK (whatsapp_mode IN ('shared', 'own'));

-- O que o dono escolheu ao gerar ESSE convite específico — precisa
-- sobreviver do momento do convite até o aceite (POST /api/auth/join),
-- que é quando o provisionamento de fato acontece.
ALTER TABLE imf_broker_invites
  ADD COLUMN IF NOT EXISTS whatsapp_mode text NOT NULL DEFAULT 'shared';

ALTER TABLE imf_broker_invites
  DROP CONSTRAINT IF EXISTS imf_broker_invites_whatsapp_mode_check;
ALTER TABLE imf_broker_invites
  ADD CONSTRAINT imf_broker_invites_whatsapp_mode_check
  CHECK (whatsapp_mode IN ('shared', 'own'));

-- Tabela legada (sem CREATE TABLE neste repo — ver server/routes/conversations.ts
-- e followup.ts pros usos reais). NULL = mensagem entrou pela instância
-- compartilhada da conta (comportamento de hoje); preenchido = entrou pela
-- instância própria desse membro, e é por ela que a resposta deve sair.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'followup_conversations') THEN
    ALTER TABLE followup_conversations
      ADD COLUMN IF NOT EXISTS instance_owner_user_id uuid;
  END IF;
END $$;
