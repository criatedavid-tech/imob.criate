-- Locação autônoma: cobrança com IA, diário do contrato e controle de chaves.
-- Já aplicado no projeto Supabase; versionado aqui para reprodutibilidade.
alter table public.imf_rental_payments
  add column if not exists dunning_step text,
  add column if not exists dunning_last_sent_at timestamptz,
  add column if not exists promise_date date,
  add column if not exists promise_registered_at timestamptz,
  add column if not exists escalated_at timestamptz;

create index if not exists idx_rental_payments_open_due
  on public.imf_rental_payments (due_date) where status in ('pending', 'overdue');
create index if not exists idx_rental_payments_contract_ref
  on public.imf_rental_payments (contract_id, reference_month desc);

alter table public.imf_rental_contracts
  add column if not exists autopilot_enabled boolean not null default false,
  add column if not exists last_charge_run_at timestamptz;
create index if not exists idx_rental_contracts_broker_status
  on public.imf_rental_contracts (broker_id, status);

create table if not exists public.imf_rental_events (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null,
  contract_id uuid not null references public.imf_rental_contracts(id) on delete cascade,
  payment_id uuid references public.imf_rental_payments(id) on delete set null,
  event_type text not null,
  actor text not null default 'sistema',
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_events_contract_time on public.imf_rental_events (contract_id, created_at desc);
create index if not exists idx_rental_events_broker_time on public.imf_rental_events (broker_id, created_at desc);

create table if not exists public.imf_property_keys (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null,
  property_id uuid not null references public.imf_properties(id) on delete cascade,
  holder_name text not null,
  holder_phone text,
  purpose text not null default 'visita',
  lead_id uuid,
  taken_at timestamptz not null default now(),
  due_at timestamptz,
  returned_at timestamptz,
  overdue_alert_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_property_key_active
  on public.imf_property_keys (property_id) where returned_at is null;
create index if not exists idx_property_keys_broker on public.imf_property_keys (broker_id, returned_at);
create index if not exists idx_property_keys_overdue
  on public.imf_property_keys (due_at) where returned_at is null and overdue_alert_sent_at is null;

create table if not exists public.imf_rental_ai_settings (
  broker_id uuid primary key,
  enabled boolean not null default false,
  charge_generation_enabled boolean not null default false,
  dunning_enabled boolean not null default false,
  can_send_second_copy boolean not null default true,
  can_register_promise boolean not null default true,
  max_promise_days integer not null default 7,
  can_offer_discount boolean not null default false,
  max_discount_percent numeric not null default 0,
  can_offer_installments boolean not null default false,
  escalate_after_silent_steps integer not null default 3,
  quiet_hours_start integer not null default 21,
  quiet_hours_end integer not null default 8,
  updated_at timestamptz not null default now()
);
