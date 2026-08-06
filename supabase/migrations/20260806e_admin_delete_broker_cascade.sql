-- ============================================================
-- Exclusão de conta (admin): faz na mão o que o comentário do
-- endpoint dizia que o CASCADE fazia sozinho
-- ============================================================
-- server/routes/admin.ts (DELETE /api/admin/brokers/:id) fazia só
-- `DELETE FROM imf_brokers`, com o comentário "cascade deve limpar
-- propriedades/leads via FK". Não limpa: mapeamos TODAS as foreign
-- keys do schema public que apontam pra imf_brokers e boa parte não
-- tem ON DELETE CASCADE — a exclusão falhava (com segurança, sem
-- corromper nada) assim que o corretor tinha qualquer imóvel
-- cadastrado (FK properties_broker_id_fkey, herdada de antes do
-- prefixo imf_ existir).
--
-- Tabelas com FK broker_id -> imf_brokers SEM CASCADE (delete_rule =
-- NO ACTION ou RESTRICT), que travam a exclusão do broker até serem
-- esvaziadas primeiro:
--   imf_broker_goals, imf_conversation_messages, imf_developments,
--   imf_properties, imf_rental_contracts, imf_reservation_documents,
--   imf_unit_reservations, leads
--   (+ imf_rental_payment_receipts, que trava imf_rental_contracts
--   via RESTRICT no contract_id — precisa sumir antes do contrato)
--
-- E um achado à parte: imf_agenda.broker_id não tem foreign key
-- NENHUMA pra imf_brokers (coluna criada em 20260708e sem REFERENCES).
-- Isso não bloqueava a exclusão — mas os eventos de agenda ficariam
-- órfãos pra sempre, sem erro nenhum, silenciosamente.
--
-- Todo o resto que referencia broker_id já tem ON DELETE CASCADE
-- (agenda legado, broker_agents, followup_config/conversations,
-- imf_broker_members/invites, imf_contacts, imf_conversation_notes/
-- tags/tag_links/tickets, imf_crm_pipelines (+ stages), imf_queues,
-- imf_rental_tenants, imf_ticket_adjustments/events, imf_webhook_*,
-- subscriptions) ou SET NULL de propósito, preservando registro
-- (corretoras.owner_broker_id, imf_billing_reconciliations,
-- imf_trial_vouchers, webhook_logs) — não precisam de ação explícita.
--
-- Fix: função transacional — se qualquer passo falhar, tudo desfaz
-- (mesmo comportamento seguro de hoje quando dá erro); só o
-- DELETE FROM imf_brokers final é que já resolvia a maior parte
-- via CASCADE, então essa continua sendo a última linha.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_broker_cascade(
  p_broker_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.imf_brokers WHERE id = p_broker_id) THEN
    RAISE EXCEPTION 'BROKER_NOT_FOUND: corretor não encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  -- imf_rental_payment_receipts trava imf_rental_contracts via RESTRICT
  -- (contract_id) — precisa sumir antes do contrato.
  DELETE FROM public.imf_rental_payment_receipts
  WHERE contract_id IN (
    SELECT id FROM public.imf_rental_contracts WHERE broker_id = p_broker_id
  );

  -- Tabelas com broker_id -> imf_brokers sem CASCADE. imf_reservation_documents
  -- tem FK composta (reservation_id, broker_id) -> imf_unit_reservations(id,
  -- broker_id) sem CASCADE — precisa sumir ANTES de imf_unit_reservations
  -- (achado ao vivo: a primeira versão desta função tinha a ordem trocada e
  -- falhava com 42P17/23503 nesse ponto). As demais não dependem de ordem
  -- entre si.
  DELETE FROM public.imf_reservation_documents WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_unit_reservations     WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_conversation_messages WHERE broker_id = p_broker_id;
  DELETE FROM public.leads                     WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_broker_goals          WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_rental_contracts      WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_developments          WHERE broker_id = p_broker_id;
  DELETE FROM public.imf_properties            WHERE broker_id = p_broker_id;

  -- imf_agenda.broker_id não tem FK nenhuma — sem isso os eventos
  -- ficam órfãos pra sempre, sem erro, silenciosamente.
  DELETE FROM public.imf_agenda WHERE broker_id = p_broker_id;

  -- O resto (CASCADE já cadastrado no schema) é resolvido pelo
  -- próprio Postgres ao apagar a linha do broker.
  DELETE FROM public.imf_brokers WHERE id = p_broker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_broker_cascade(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_broker_cascade(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_broker_cascade(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_broker_cascade(UUID) TO service_role;

COMMIT;
