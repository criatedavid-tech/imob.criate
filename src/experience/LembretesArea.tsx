import React, { useEffect, useState } from 'react';
import { Loader2, Bell, Send, Trash2 } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface Reminder {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  scheduled_at: string;
  title: string | null;
  status: string;
}

interface ScheduledFollowup {
  id: string;
  contact_name: string;
  contact_phone: string;
  message: string;
  due_at: string;
  status: string;
  sent_at: string | null;
  last_error: string | null;
}

const FOLLOWUP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Aguardando envio', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-400/20' },
  sent: { label: 'Enviado', cls: 'bg-green-500/20 text-green-300 border-green-400/20' },
  failed: { label: 'Falhou', cls: 'bg-red-500/20 text-red-300 border-red-400/20' },
  cancelled: { label: 'Cancelado', cls: 'bg-white/10 text-white/40 border-white/10' },
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function LembretesArea() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [followups, setFollowups] = useState<ScheduledFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [remindersRes, followupsRes] = await Promise.all([
        fetch('/api/agenda/visits?event_type=lembrete', { headers: authService.getAuthHeaders() }),
        fetch('/api/agent/scheduled-followups', { headers: authService.getAuthHeaders() }),
      ]);
      if (!remindersRes.ok || !followupsRes.ok) throw new Error();
      setReminders(await remindersRes.json());
      setFollowups(await followupsRes.json());
    } catch {
      setError('Não consegui carregar os lembretes agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function completeReminder(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/agenda/visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status: 'realizado' }),
      });
      if (!res.ok) throw new Error();
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'realizado' } : r)));
    } catch {
      setError('Não consegui concluir o lembrete.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteReminder(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/agenda/visits/${id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) throw new Error();
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError('Não consegui apagar o lembrete.');
    } finally {
      setBusyId(null);
    }
  }

  async function cancelFollowup(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/agent/scheduled-followups/${id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) throw new Error();
      setFollowups((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'cancelled' } : f)));
    } catch {
      setError('Não consegui cancelar o follow-up.');
    } finally {
      setBusyId(null);
    }
  }

  const pendingReminders = reminders.filter((r) => r.status !== 'realizado' && r.status !== 'cancelado');
  const doneReminders = reminders.filter((r) => r.status === 'realizado' || r.status === 'cancelado');

  if (loading) {
    return (
      <div className="flex justify-center pt-24">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-1">Lembretes</h2>
      <p className="text-[13px] text-white/40 mb-6">
        Lembretes que você pediu pro Assistente IA guardar, e follow-ups agendados pra sair sozinhos no WhatsApp.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-2xl bg-red-500/10 border border-red-400/20 text-[13px] text-red-300">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h3 className="text-[13px] font-bold text-white/60 uppercase tracking-wide mb-3">Lembretes</h3>
        {pendingReminders.length === 0 ? (
          <GlassCard className="!p-5 text-[13px] text-white/40">
            Nenhum lembrete pendente. Peça pro Assistente IA: "me lembra de ligar pro fulano em 2 dias".
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {pendingReminders.map((r) => (
              <div key={r.id}>
                <GlassCard className="!p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <Bell className="w-4 h-4 text-purple-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-white truncate">{r.title || 'Lembrete'}</p>
                      <p className="text-[12px] text-white/45 mt-0.5 truncate">
                        {r.client_name}{r.client_phone ? ` · ${r.client_phone}` : ''} · {formatWhen(r.scheduled_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => completeReminder(r.id)}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-green-500/20 text-green-300 border border-green-400/20 hover:bg-green-500/30 transition-colors disabled:opacity-40"
                    >
                      Concluir
                    </button>
                    <button
                      onClick={() => deleteReminder(r.id)}
                      disabled={busyId === r.id}
                      className="p-2 rounded-xl text-white/25 hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40"
                    >
                      {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </GlassCard>
              </div>
            ))}
          </div>
        )}

        {doneReminders.length > 0 && (
          <div className="space-y-2 mt-2 opacity-50">
            {doneReminders.map((r) => (
              <div key={r.id}>
                <GlassCard className="!p-3 flex items-center gap-3">
                  <Bell className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  <p className="text-[12px] text-white/40 truncate">
                    {r.title || 'Lembrete'} — {r.client_name} · {formatWhen(r.scheduled_at)} ·{' '}
                    {r.status === 'realizado' ? 'concluído' : 'cancelado'}
                  </p>
                </GlassCard>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[13px] font-bold text-white/60 uppercase tracking-wide mb-3">Follow-ups agendados</h3>
        {followups.length === 0 ? (
          <GlassCard className="!p-5 text-[13px] text-white/40">
            Nenhum follow-up agendado. Peça pro Assistente IA: "envie em 24h um follow-up pro fulano".
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {followups.map((f) => {
              const cfg = FOLLOWUP_STATUS[f.status] || FOLLOWUP_STATUS.pending;
              return (
                <div key={f.id}>
                  <GlassCard className="!p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-3">
                        <Send className="w-4 h-4 text-blue-300 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[14px] font-bold text-white truncate">
                            {f.contact_name} <span className="text-white/40 font-normal">· {f.contact_phone}</span>
                          </p>
                          <p className="text-[12px] text-white/45 mt-0.5 truncate">{f.message}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${cfg.cls}`}>{cfg.label}</span>
                        {f.status === 'pending' && (
                          <button
                            onClick={() => cancelFollowup(f.id)}
                            disabled={busyId === f.id}
                            className="p-2 rounded-xl text-white/25 hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40"
                          >
                            {busyId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-white/30 mt-2 pl-7">
                      {f.status === 'sent' && f.sent_at ? `Enviado em ${formatWhen(f.sent_at)}` : `Previsto para ${formatWhen(f.due_at)}`}
                      {f.status === 'failed' && f.last_error ? ` · ${f.last_error}` : ''}
                    </p>
                  </GlassCard>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
