-- ============================================================
-- Origens da agenda para sincronização bidirecional
-- ============================================================
-- A integração já diferencia eventos manuais, criados pela IA, importados
-- do Google e importados pelo CalDAV do iPhone. A constraint legada aceitava
-- somente 'manual' e 'ia', bloqueando o INSERT recebido do calendário externo.
-- ============================================================

BEGIN;

ALTER TABLE public.imf_agenda
  DROP CONSTRAINT IF EXISTS imf_agenda_source_check;

ALTER TABLE public.imf_agenda
  ADD CONSTRAINT imf_agenda_source_check
  CHECK (source IN ('manual', 'ia', 'calendar_google', 'calendar_iphone'));

COMMIT;
