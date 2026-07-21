-- ============================================================
-- Alerta por WhatsApp pro corretor quando um lembrete vence
-- ============================================================
-- Complementa o badge visual do sino (ManualRail.tsx, useDueReminderCount):
-- além de mostrar a contagem no app, o job de 60s abaixo manda uma mensagem
-- de WhatsApp pro próprio corretor quando um lembrete (create_reminder,
-- imf_agenda.event_type='lembrete') vence.
--
-- whatsapp_alert_sent_at marca que o alerta já foi enviado pra essa linha —
-- sem isso o job reenviaria a cada tick de 60s enquanto o lembrete continuar
-- pendente. É um campo próprio, separado de `status`: o lembrete pode já ter
-- sido alertado e continuar `pendente` até o corretor concluir/apagar.
--
-- NÃO EXECUTADO AUTOMATICAMENTE. Aplicar manualmente no Supabase.
-- ============================================================

ALTER TABLE imf_agenda
  ADD COLUMN IF NOT EXISTS whatsapp_alert_sent_at TIMESTAMPTZ;
