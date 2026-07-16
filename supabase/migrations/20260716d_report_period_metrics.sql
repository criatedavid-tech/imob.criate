-- Relatórios: registra a data real da venda para que VGV e quantidade de
-- unidades vendidas respeitem os filtros de 3, 6 e 12 meses.

ALTER TABLE imf_units
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- Não existia data histórica de venda. Para unidades já vendidas, a melhor
-- aproximação disponível é updated_at (com fallback para created_at). O
-- relatório/documentação deixa explícito que esse backfill é estimado.
UPDATE imf_units
SET sold_at = COALESCE(updated_at, created_at, NOW())
WHERE status = 'vendido'
  AND sold_at IS NULL;

UPDATE imf_units
SET sold_at = NULL,
    sold_by_user_id = NULL
WHERE status <> 'vendido'
  AND (sold_at IS NOT NULL OR sold_by_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_units_development_sold_at
  ON imf_units (development_id, sold_at)
  WHERE sold_at IS NOT NULL;

COMMENT ON COLUMN imf_units.sold_at IS
  'Data em que a unidade entrou em vendido; usada nos filtros de período de Financeiro/Relatórios.';

-- Proteção no banco: qualquer caminho que marque uma unidade como vendida
-- recebe sold_at; ao voltar para reservado/disponível, data e autoria são
-- limpas. Isso cobre UI, agente e futuras integrações.
CREATE OR REPLACE FUNCTION imf_sync_unit_sale_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'vendido' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.sold_at := COALESCE(NEW.sold_at, NOW());
    ELSIF OLD.status IS DISTINCT FROM 'vendido' OR NEW.sold_at IS NULL THEN
      NEW.sold_at := COALESCE(NEW.sold_at, NOW());
    END IF;
  ELSE
    NEW.sold_at := NULL;
    NEW.sold_by_user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_imf_sync_unit_sale_metadata ON imf_units;
CREATE TRIGGER trg_imf_sync_unit_sale_metadata
BEFORE INSERT OR UPDATE OF status, sold_at, sold_by_user_id ON imf_units
FOR EACH ROW
EXECUTE FUNCTION imf_sync_unit_sale_metadata();
