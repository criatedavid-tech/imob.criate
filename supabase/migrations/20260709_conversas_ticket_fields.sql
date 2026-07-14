-- Inspirado na Tickets API do Z-PRO (status/fila/atribuição/tags/notas), mas
-- implementado nativo no ImobiFlow, sem dependência do Z-PRO (Fase 5+ do plano
-- de eliminação). Amplia followup_conversations (o "ticket" do nosso sistema)
-- em vez de criar uma tabela paralela.

-- status ganha o estado intermediário "pending" (aguardando alguém puxar o
-- atendimento) — hoje só existia "open"/"closed". Sem CHECK a nível de banco,
-- consistente com o padrão já usado neste projeto (validação fica na API).
alter table followup_conversations
  add column if not exists queue_id uuid,
  add column if not exists assigned_user_id uuid;

-- Filas de atendimento (ex: "Vendas", "Locação", "Suporte")
create table if not exists imf_queues (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'followup_conversations_queue_id_fkey'
  ) then
    alter table followup_conversations
      add constraint followup_conversations_queue_id_fkey
      foreign key (queue_id) references imf_queues(id) on delete set null;
  end if;
end $$;

-- Catálogo de tags por conta (ex: "quente", "aluguel", "urgente")
create table if not exists imf_conversation_tags (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique(broker_id, name)
);

-- Vínculo N:N entre conversa (broker_id+customer_phone) e tag
create table if not exists imf_conversation_tag_links (
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  customer_phone text not null,
  tag_id uuid not null references imf_conversation_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (broker_id, customer_phone, tag_id)
);

-- Nota interna (visível só pro time, nunca enviada ao cliente)
create table if not exists imf_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  customer_phone text not null,
  user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_tag_links_phone on imf_conversation_tag_links(broker_id, customer_phone);
create index if not exists idx_conversation_notes_phone on imf_conversation_notes(broker_id, customer_phone);
create index if not exists idx_queues_broker on imf_queues(broker_id);
