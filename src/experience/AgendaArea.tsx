import React, { useState } from 'react';
import { CalendarSync } from 'lucide-react';
import AgendaCalendar from '../components/AgendaCalendar';
import { CalendarSyncModal } from '../components/CalendarSyncModal';

// Agenda real: reaproveita o AgendaCalendar existente (CRUD completo via
// /api/agenda/visits) e oferece a assinatura externa em um modal separado.
export function AgendaArea() {
  const [syncOpen, setSyncOpen] = useState(false);

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-[var(--text-hi)]">Agenda</h2>
          <p className="mt-1 text-[12px] text-[var(--text-low)]">Compromissos, visitas e sincronização com seu calendário pessoal.</p>
        </div>
        <button type="button" onClick={() => setSyncOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--control-fill)] px-4 py-2.5 text-[12px] font-bold text-[var(--text-hi)] transition-colors hover:bg-[var(--control-fill-hover)]">
          <CalendarSync size={16} className="text-blue-300" /> Sincronizar calendário
        </button>
      </div>
      <AgendaCalendar />
      {syncOpen && <CalendarSyncModal onClose={() => setSyncOpen(false)} />}
    </div>
  );
}
