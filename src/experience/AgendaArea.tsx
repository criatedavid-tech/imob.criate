import React from 'react';
import AgendaCalendar from '../components/AgendaCalendar';

// Agenda real: reaproveita 100% o AgendaCalendar já existente (CRUD completo
// via /api/agenda/visits) — só adiciona o cabeçalho consistente com as
// outras áreas da experiência nova. Nenhuma rota nova.
export function AgendaArea() {
  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Agenda</h2>
      <AgendaCalendar />
    </div>
  );
}
