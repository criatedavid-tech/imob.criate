-- Chave Asaas própria da imobiliária/incorporadora, para as cobranças dos
-- clientes DELA (aluguel em Locação + sinal PIX de reserva em Lançamentos).
-- Guardada criptografada em repouso (AES-256-GCM, server/lib/crypto.ts) —
-- nunca em texto pleno. `asaas_env` diz se a chave é de sandbox ou produção,
-- o que define a base URL usada nas chamadas.
--
-- Regra de negócio: se o broker NÃO tem chave própria, o backend cai na conta
-- global da Criate (comportamento atual — server/services/asaasCredentials.ts).
-- A assinatura do próprio ImobiFlow (broker → Criate) NUNCA usa essa chave;
-- é sempre a global (server/services/billing.ts), porque essa receita é da
-- Criate, não da imobiliária.

ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS asaas_api_key_enc TEXT,
  ADD COLUMN IF NOT EXISTS asaas_env TEXT;

ALTER TABLE imf_brokers
  DROP CONSTRAINT IF EXISTS imf_brokers_asaas_env_check;
ALTER TABLE imf_brokers
  ADD CONSTRAINT imf_brokers_asaas_env_check
  CHECK (asaas_env IS NULL OR asaas_env IN ('sandbox', 'production'));
