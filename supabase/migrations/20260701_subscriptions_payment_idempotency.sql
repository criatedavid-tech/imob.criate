-- ─── Migração: idempotência de pagamentos (subscriptions) ───────────────────
-- Rodar no Supabase SQL Editor do projeto umvbrahsqvqeondwtikm ANTES do deploy
-- do código que usa upsert ON CONFLICT (asaas_payment_id).
--
-- Contexto: o Asaas entrega o mesmo webhook em duplicidade (~200ms de
-- intervalo) e o INSERT em subscriptions não era idempotente → o mesmo
-- pagamento foi gravado 2x em produção (pay de 20/05/2026 duplicado no
-- painel admin). A tabela subscriptions (sem prefixo) pertence ao ImobiFlow.

-- 1. Remove duplicatas existentes (mantém a linha mais antiga de cada pagamento)
DELETE FROM subscriptions a
USING subscriptions b
WHERE a.asaas_payment_id = b.asaas_payment_id
  AND a.asaas_payment_id IS NOT NULL
  AND a.ctid > b.ctid;

-- 2. Índice único exigido pelo ON CONFLICT (múltiplos NULLs continuam permitidos)
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_asaas_payment_id
  ON subscriptions (asaas_payment_id);
