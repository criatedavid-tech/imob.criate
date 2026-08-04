-- Régua de cobrança editável: o corretor passa a ver e controlar QUAL mensagem
-- sai e EM QUE DIA. Sem linha na tabela, vale o padrão do código — por isso
-- ninguém precisa "configurar" antes de usar.
create table if not exists public.imf_rental_message_templates (
  broker_id uuid not null,
  step text not null,
  body text not null default '',
  offset_days integer not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (broker_id, step)
);

-- O degrau alcançado passa a ser guardado também como número de dias. Sem isso,
-- mudar o dia de um degrau bagunçaria a trava que impede reenvio (a ordem
-- deixaria de ser a mesma do texto gravado).
alter table public.imf_rental_payments
  add column if not exists dunning_step_offset integer;
