-- Histórico do Assistente IA (command bar) — hoje vive só no estado local
-- do React (turns), some ao fechar o chat ou recarregar a página. Usuário
-- pediu pra conseguir voltar e ver o que pediu antes (ex.: printar um
-- pedido feito). Por usuário (não só por conta) — cada membro vê só a
-- própria conversa com o assistente, é uma ferramenta pessoal de trabalho,
-- não um canal compartilhado como o Conversas.
create table if not exists imf_agent_log (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references imf_brokers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'ai')),
  text text not null,
  action_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_log_user on imf_agent_log(user_id, created_at);
