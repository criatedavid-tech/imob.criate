-- Contatos salvos por corretor — permite o agente de IA (command bar) resolver
-- um nome ("manda mensagem pro Hunter") pro telefone certo sem o usuário
-- precisar digitar o número toda vez. Sem CHECK/RLS a nível de banco,
-- consistente com o padrão já usado neste projeto (validação/escopo na API).

create table if not exists imf_contacts (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  name text not null,
  phone text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contacts_broker on imf_contacts(broker_id);
create index if not exists idx_contacts_broker_name on imf_contacts(broker_id, name);
