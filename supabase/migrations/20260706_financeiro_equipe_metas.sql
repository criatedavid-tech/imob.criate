-- Etapa 8 (Financeiro) e Etapa 9 (Equipe/Metas) do UX_MASTERPLAN.md.
-- Núcleo real: resumo financeiro agregando dado que já existe (Locação +
-- Lançamentos) e meta mensal de negócios fechados. O resto de Equipe (roster
-- de corretores, hierarquia, ranking, distribuição de leads) depende de o
-- produto suportar múltiplos usuários por conta — não existe ainda, ver
-- UX_MASTERPLAN.md pra decisão em aberto.

-- Marca quando um lead foi de fato fechado, pra "meta do mês" comparar contra
-- uma data real em vez de chutar. NULL em todos os leads existentes.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS imf_broker_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   UUID NOT NULL REFERENCES imf_brokers(id),
  month       DATE NOT NULL, -- sempre dia 1 do mês
  deals_goal  INTEGER NOT NULL CHECK (deals_goal > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broker_id, month)
);

ALTER TABLE imf_broker_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broker_own_goals" ON imf_broker_goals
  FOR ALL
  USING (broker_id IN (SELECT id FROM imf_brokers WHERE user_id = auth.uid()));
