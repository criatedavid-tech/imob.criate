-- Lançamentos ganha tipo de empreendimento (vertical/horizontal), benefícios
-- compartilhados do empreendimento, e características por unidade (quartos,
-- vagas de garagem, área, orientação solar, andar — este último só faz
-- sentido pra empreendimento vertical).

ALTER TABLE imf_developments
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'vertical' CHECK (tipo IN ('vertical', 'horizontal')),
  ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE imf_units
  ADD COLUMN IF NOT EXISTS quartos INTEGER,
  ADD COLUMN IF NOT EXISTS vagas_garagem INTEGER,
  ADD COLUMN IF NOT EXISTS area_m2 NUMERIC,
  ADD COLUMN IF NOT EXISTS orientacao TEXT CHECK (orientacao IS NULL OR orientacao IN ('nascente', 'poente')),
  ADD COLUMN IF NOT EXISTS andar INTEGER;
