-- Horizontal vira 2 subtipos: loteamento (terreno cru, sem casa — usa área
-- do lote + testada) e condomínio de casas (casa pronta — reaproveita os
-- mesmos campos de unidade do vertical: quartos/vagas/área construída, só
-- sem andar). Backfill: horizontais existentes viram 'loteamento' (é o que
-- já eram na prática, ver "Residencial Hora Bela").

ALTER TABLE imf_developments
  ADD COLUMN IF NOT EXISTS subtipo TEXT CHECK (subtipo IS NULL OR subtipo IN ('loteamento', 'condominio_casas'));

UPDATE imf_developments SET subtipo = 'loteamento' WHERE tipo = 'horizontal' AND subtipo IS NULL;
