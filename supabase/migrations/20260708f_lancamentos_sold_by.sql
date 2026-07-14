-- Catálogo de unidades (Lançamentos) continua compartilhado com toda a
-- equipe — só a receita atribuída a cada corretor fica privada. Precisa
-- saber QUEM fechou a venda pra Financeiro/Relatórios não misturar a receita
-- de um corretor com a de outro.

ALTER TABLE imf_units ADD COLUMN IF NOT EXISTS sold_by_user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_units_sold_by ON imf_units (sold_by_user_id);
