-- Empreendimento ganha fotos/renders — reaproveita o mesmo bucket de upload
-- já usado pela Carteira (property-images), só muda onde a URL é guardada.

ALTER TABLE imf_developments ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';
