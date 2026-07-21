-- ============================================================
-- Distingue "lembrete" de "visita" real em imf_agenda
-- ============================================================
-- create_reminder (server/services/agent.ts) grava lembretes do Assistente
-- IA na mesma tabela de visitas (imf_agenda), hoje só distinguíveis pelo
-- prefixo "Lembrete: " no título. Isso contaminava contagens/listas que
-- assumem que toda linha é uma visita real: "Próximas visitas" e "Visitas
-- neste mês" do próprio assistente (server/services/agent.ts), o resumo
-- de Relatórios (server/routes/relatorios.ts), o card de KPI do Dashboard
-- 1.0 (server/routes/dashboard.ts) e a lista que o agente externo de
-- WhatsApp usa pra decidir horário ocupado/livre
-- (GET /api/agenda/n8n/list, server/routes/agenda.ts).
--
-- DEFAULT 'visita' preserva o comportamento de toda linha existente e de
-- todo INSERT que já existe hoje (create_visit, POST /api/agenda/n8n/create)
-- sem precisar tocar nesse código. Só create_reminder passa a gravar
-- event_type='lembrete' explicitamente.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

ALTER TABLE imf_agenda
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'visita'
    CHECK (event_type IN ('visita', 'lembrete'));

CREATE INDEX IF NOT EXISTS idx_agenda_event_type
  ON imf_agenda (broker_id, event_type, scheduled_at);
