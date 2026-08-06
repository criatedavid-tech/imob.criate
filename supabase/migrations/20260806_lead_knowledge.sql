-- O que a IA sabe (e o que ela apenas SUPÔS) sobre cada pessoa que conversa.
--
-- Chave é (broker_id, phone), não lead_id, de propósito: a IA começa a
-- aprender coisas na primeira mensagem, muito antes de existir um lead no CRM
-- — e é justamente esse conhecimento inicial que hoje se perde entre uma
-- conversa e outra, fazendo ela repetir perguntas e chutar.
create table if not exists public.imf_lead_knowledge (
  broker_id uuid not null,
  phone text not null,
  nome text,
  finalidade text,                 -- venda | aluguel
  regiao text,
  tipo text,                       -- casa | apartamento | comercial | terreno
  quartos integer,
  orcamento_min_cents bigint,
  orcamento_max_cents bigint,
  diferenciais jsonb not null default '[]'::jsonb,
  imovel_interesse uuid,
  observacoes text,
  -- Suposições ainda NÃO confirmadas, com a evidência que as originou.
  -- Existir aqui em vez de nos campos acima é o que impede a IA de tratar
  -- palpite como fato na conversa seguinte.
  hipoteses jsonb not null default '[]'::jsonb,
  resumo text,
  mensagens integer not null default 0,
  primeira_interacao timestamptz not null default now(),
  ultima_interacao timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (broker_id, phone)
);

create index if not exists idx_lead_knowledge_broker_recente
  on public.imf_lead_knowledge (broker_id, ultima_interacao desc);

-- Nome do perfil do WhatsApp (senderName do webhook). É o que faz a IA saber
-- com quem está falando na PRIMEIRA mensagem, sem precisar perguntar. Fica em
-- campo separado de propósito: nome de perfil costuma ser apelido ou nome de
-- empresa, então serve para se dirigir à pessoa, não para o cadastro.
alter table public.imf_lead_knowledge
  add column if not exists nome_whatsapp text;
