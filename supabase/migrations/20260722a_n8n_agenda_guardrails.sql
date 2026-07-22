-- Impede duas visitas sobrepostas para a mesma conta, inclusive quando duas
-- execucoes do n8n passam pela checagem da API ao mesmo tempo. O backend faz
-- uma verificacao amigavel antes do INSERT/UPDATE; esta constraint e a
-- garantia atomica final contra race condition.
--
-- NAO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase antes de
-- considerar o bloqueio de conflito concluido. Se ja houver sobreposicoes, o
-- ALTER falhara: corrija as linhas apontadas e execute novamente.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- O PostgreSQL exige que toda funcao usada em uma constraint EXCLUDE seja
-- IMMUTABLE. Para duracoes em minutos, o fim da visita e deterministico para
-- os mesmos argumentos (nao depende de calendario ou fuso horario).
CREATE OR REPLACE FUNCTION public.imf_agenda_visit_range(
  p_scheduled_at TIMESTAMPTZ,
  p_duration_minutes INTEGER
)
RETURNS TSTZRANGE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT tstzrange(
    p_scheduled_at,
    p_scheduled_at
      + greatest(coalesce(p_duration_minutes, 60), 1) * interval '1 minute',
    '[)'
  );
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'imf_agenda_no_overlapping_visits'
      AND conrelid = 'public.imf_agenda'::regclass
  ) THEN
    ALTER TABLE public.imf_agenda
      ADD CONSTRAINT imf_agenda_no_overlapping_visits
      EXCLUDE USING gist (
        broker_id WITH =,
        public.imf_agenda_visit_range(
          scheduled_at,
          duration_minutes
        ) WITH &&
      )
      WHERE (event_type = 'visita' AND status <> 'cancelado');
  END IF;
END
$$;

COMMIT;
