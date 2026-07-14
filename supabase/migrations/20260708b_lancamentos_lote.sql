-- Loteamento (empreendimento horizontal) é terreno cru, sem casa construída
-- ainda — quartos/vagas/área construída não fazem sentido. Unidade de lote
-- usa área do lote + testada (frente) em vez disso.

ALTER TABLE imf_units
  ADD COLUMN IF NOT EXISTS area_lote_m2 NUMERIC,
  ADD COLUMN IF NOT EXISTS testada_m NUMERIC;
