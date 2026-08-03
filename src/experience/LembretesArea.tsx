import React, { useEffect, useState } from 'react';
import { Loader2, Bell, Send, Trash2, Pencil, X } from 'lucide-react';
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

type EditState =
  | {
      kind: 'reminder';
      id: string;
      title: string;
      name: string;
      phone: string;
      when: string;
    }
  | {
      kind: 'followup';
      id: string;
      name: string;
      phone: string;
      message: string;
      when: string;
    };

const FOLLOWUP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Aguardando envio', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-400/20' },
  sent: { label: 'Enviado', cls: 'bg-green-500/20 text-green-300 border-green-400/20' },
  failed: { label: 'Falhou', cls: 'bg-red-500/20 text-red-300 border-red-400/20' },
  cancelled: { label: 'Cancelado', cls: 'bg-[var(--control-fill-hover)] text-[var(--text-low)] border-[var(--hairline)]' },
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function LembretesArea() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [followups, setFollowups] = useState<ScheduledFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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

  useEffect(() => {
    if (!editing) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingEdit) setEditing(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [editing, savingEdit]);

  function editReminder(reminder: Reminder) {
    setError(null);
    setEditing({
      kind: 'reminder',
      id: reminder.id,
      title: reminder.title || 'Lembrete',
      name: reminder.client_name || '',
      phone: reminder.client_phone || '',
      when: toLocalDateTimeInput(reminder.scheduled_at),
    });
  }

  function editFollowup(followup: ScheduledFollowup) {
    setError(null);
    setEditing({
      kind: 'followup',
      id: followup.id,
      name: followup.contact_name,
      phone: followup.contact_phone,
      message: followup.message,
      when: toLocalDateTimeInput(followup.due_at),
    });
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;

    const scheduledAt = new Date(editing.when);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setError('Escolha uma data e um horário no futuro.');
      return;
    }

    setSavingEdit(true);
    setError(null);
    try {
      const isReminder = editing.kind === 'reminder';
      const endpoint = isReminder
        ? `/api/agent/reminders/${editing.id}`
        : `/api/agent/scheduled-followups/${editing.id}`;
      const body = isReminder
        ? {
            title: editing.title,
            client_name: editing.name,
            client_phone: editing.phone.trim() || null,
            scheduled_at: scheduledAt.toISOString(),
          }
        : {
            contact_name: editing.name,
            contact_phone: editing.phone,
            message: editing.message,
            due_at: scheduledAt.toISOString(),
          };
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível salvar a edição.');

      if (isReminder) {
        setReminders((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...data } : item)));
      } else {
        setFollowups((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...data } : item)));
      }
      setEditing(null);
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar a edição.');
    } finally {
      setSavingEdit(false);
    }
  }

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
        <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h2 className="text-2xl font-black text-[var(--text-hi)] mb-1">Lembretes</h2>
      <p className="text-[13px] text-[var(--text-low)] mb-6">
        Lembretes que você pediu pro Assistente IA guardar, e follow-ups agendados pra sair sozinhos no WhatsApp.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-2xl bg-red-500/10 border border-red-400/20 text-[13px] text-red-300">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h3 className="text-[13px] font-bold text-[var(--text-mid)] uppercase tracking-wide mb-3">Lembretes</h3>
        {pendingReminders.length === 0 ? (
          <GlassCard className="!p-5 text-[13px] text-[var(--text-low)]">
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
                      <p className="text-[14px] font-bold text-[var(--text-hi)] truncate">{r.title || 'Lembrete'}</p>
                      <p className="text-[12px] text-[var(--text-low)] mt-0.5 truncate">
                        {r.client_name}{r.client_phone ? ` · ${r.client_phone}` : ''} · {formatWhen(r.scheduled_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => editReminder(r)}
                      disabled={busyId === r.id}
                      aria-label="Editar lembrete"
                      title="Editar lembrete"
                      className="p-2 rounded-xl text-[var(--text-low)] hover:bg-blue-500/15 hover:text-blue-300 transition-colors disabled:opacity-40"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
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
                      className="p-2 rounded-xl text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40"
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
                  <Bell className="w-3.5 h-3.5 text-[var(--text-low)] shrink-0" />
                  <p className="text-[12px] text-[var(--text-low)] truncate">
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
        <h3 className="text-[13px] font-bold text-[var(--text-mid)] uppercase tracking-wide mb-3">Follow-ups agendados</h3>
        {followups.length === 0 ? (
          <GlassCard className="!p-5 text-[13px] text-[var(--text-low)]">
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
                          <p className="text-[14px] font-bold text-[var(--text-hi)] truncate">
                            {f.contact_name} <span className="text-[var(--text-low)] font-normal">· {f.contact_phone}</span>
                          </p>
                          <p className="text-[12px] text-[var(--text-low)] mt-0.5 truncate">{f.message}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${cfg.cls}`}>{cfg.label}</span>
                        {f.status === 'pending' && (
                          <>
                            <button
                              onClick={() => editFollowup(f)}
                              disabled={busyId === f.id}
                              aria-label="Editar follow-up"
                              title="Editar follow-up"
                              className="p-2 rounded-xl text-[var(--text-low)] hover:bg-blue-500/15 hover:text-blue-300 transition-colors disabled:opacity-40"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => cancelFollowup(f.id)}
                              disabled={busyId === f.id}
                              aria-label="Cancelar follow-up"
                              title="Cancelar follow-up"
                              className="p-2 rounded-xl text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40"
                            >
                              {busyId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-low)] mt-2 pl-7">
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

      {editing && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingEdit) setEditing(null);
          }}
        >
          <form
            onSubmit={saveEdit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-scheduled-card-title"
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] border border-[var(--hairline)] bg-[var(--bg-elevated)] shadow-2xl p-5 sm:p-6"
          >
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h3 id="edit-scheduled-card-title" className="text-lg font-black text-[var(--text-hi)]">
                  {editing.kind === 'reminder' ? 'Editar lembrete' : 'Editar follow-up'}
                </h3>
                <p className="text-xs text-[var(--text-low)] mt-1">A alteração só é aceita enquanto o item estiver pendente.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={savingEdit}
                aria-label="Fechar edição"
                className="p-2 rounded-xl text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-400/20 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {editing.kind === 'reminder' && (
                <label className="block">
                  <span className="block text-xs font-bold text-[var(--text-mid)] mb-1.5">Lembrete</span>
                  <input
                    value={editing.title}
                    onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                    maxLength={300}
                    required
                    className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--control-fill)] px-3 py-2.5 text-sm text-[var(--text-hi)] outline-none focus:border-blue-400/60"
                  />
                </label>
              )}

              <label className="block">
                <span className="block text-xs font-bold text-[var(--text-mid)] mb-1.5">Contato</span>
                <input
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  maxLength={200}
                  required
                  className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--control-fill)] px-3 py-2.5 text-sm text-[var(--text-hi)] outline-none focus:border-blue-400/60"
                />
              </label>

              <label className="block">
                <span className="block text-xs font-bold text-[var(--text-mid)] mb-1.5">
                  Telefone {editing.kind === 'reminder' ? '(opcional)' : ''}
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={editing.phone}
                  onChange={(event) => setEditing({ ...editing, phone: event.target.value })}
                  maxLength={30}
                  required={editing.kind === 'followup'}
                  className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--control-fill)] px-3 py-2.5 text-sm text-[var(--text-hi)] outline-none focus:border-blue-400/60"
                />
              </label>

              {editing.kind === 'followup' && (
                <label className="block">
                  <span className="block text-xs font-bold text-[var(--text-mid)] mb-1.5">Mensagem</span>
                  <textarea
                    value={editing.message}
                    onChange={(event) => setEditing({ ...editing, message: event.target.value })}
                    maxLength={2000}
                    rows={5}
                    required
                    className="w-full resize-y rounded-xl border border-[var(--hairline)] bg-[var(--control-fill)] px-3 py-2.5 text-sm text-[var(--text-hi)] outline-none focus:border-blue-400/60"
                  />
                </label>
              )}

              <label className="block">
                <span className="block text-xs font-bold text-[var(--text-mid)] mb-1.5">Data e horário</span>
                <input
                  type="datetime-local"
                  value={editing.when}
                  min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
                  onChange={(event) => setEditing({ ...editing, when: event.target.value })}
                  required
                  className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--control-fill)] px-3 py-2.5 text-sm text-[var(--text-hi)] outline-none focus:border-blue-400/60"
                />
              </label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={savingEdit}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-mid)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar alterações
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
