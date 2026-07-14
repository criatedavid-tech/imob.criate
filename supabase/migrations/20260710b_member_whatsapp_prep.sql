-- Prep estrutural pra decisão de produto ainda em aberto: quando uma
-- imobiliária/incorporadora convida corretores pra equipe, cada corretor terá
-- (a) sua PRÓPRIA instância de WhatsApp, contabilizada no plano contratado
-- (ex: "20 corretores" = até 20 instâncias), ou (b) todos compartilhando o
-- mesmo número já vinculado à conta (comportamento atual)?
--
-- Essa migração só prepara o terreno pra opção (a) sem mudar nenhum
-- comportamento hoje: nada no código lê essas colunas ainda. O modelo (b)
-- continua sendo o único que funciona de fato até a decisão ser tomada e a
-- lógica de provisionamento por membro + roteamento de mensagens por
-- instância ser implementada (ver server/services/provisioning.ts,
-- server/services/wppShim.ts, server/services/agent.ts — hoje tudo assume
-- 1 conta = 1 instância, chaveado só por broker_id).

ALTER TABLE imf_broker_members
  ADD COLUMN IF NOT EXISTS uazapi_instance_id text,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token text;

-- Limite de corretores incluídos no plano da conta (imobiliária/incorporadora).
-- NULL = sem limite (comportamento atual, sem enforcement nenhum). Só passa a
-- valer quando a lógica de bloqueio de convite acima do limite for construída.
ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS member_limit integer;
