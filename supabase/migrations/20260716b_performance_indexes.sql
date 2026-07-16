-- Índices para os padrões de acesso confirmados na auditoria de gargalos.

CREATE INDEX IF NOT EXISTS idx_leads_property_id
  ON leads (property_id);

CREATE INDEX IF NOT EXISTS idx_leads_status
  ON leads (status);

CREATE INDEX IF NOT EXISTS idx_agenda_broker_scheduled
  ON imf_agenda (broker_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_unit_reservations_due
  ON imf_unit_reservations (reserved_until)
  WHERE status IN ('creating', 'pending', 'overdue', 'payment_failed');

CREATE INDEX IF NOT EXISTS idx_units_reserved_until
  ON imf_units (reserved_until)
  WHERE status = 'reservado';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at
  ON webhook_logs (created_at);
