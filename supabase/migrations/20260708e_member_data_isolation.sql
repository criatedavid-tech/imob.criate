-- Isolamento de dados por membro (Equipe, revisão): dentro da mesma conta,
-- cada membro só vê/edita o que ele mesmo criou — Carteira, Leads e Agenda.
-- O dono original da conta (imf_brokers.user_id) continua vendo tudo (visão
-- gerencial). Conversas (WhatsApp) não ganha coluna própria — a visibilidade
-- é derivada casando o telefone do cliente com o lead correspondente (ver
-- server/routes/wppShim.ts).

ALTER TABLE imf_properties ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);
ALTER TABLE leads          ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);
ALTER TABLE imf_agenda     ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_properties_owner ON imf_properties (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_owner      ON leads (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agenda_owner     ON imf_agenda (owner_user_id);

-- Backfill: tudo que já existe pertencia ao dono da conta até agora.
UPDATE imf_properties p
SET owner_user_id = b.user_id
FROM imf_brokers b
WHERE p.broker_id = b.id AND p.owner_user_id IS NULL;

UPDATE imf_agenda a
SET owner_user_id = b.user_id
FROM imf_brokers b
WHERE a.broker_id = b.id AND a.owner_user_id IS NULL;

UPDATE leads l
SET owner_user_id = b.user_id
FROM imf_properties p
JOIN imf_brokers b ON b.id = p.broker_id
WHERE l.property_id = p.id AND l.owner_user_id IS NULL;
