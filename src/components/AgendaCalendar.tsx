import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Loader2,
  Calendar, Clock, Phone, Mail, Home, User, CheckCircle2,
  XCircle, AlertCircle, Edit3
} from 'lucide-react';
import { authService } from '../services/auth';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';

// ─── types ───────────────────────────────────────────────────────────────────

type AppointmentStatus = 'pendente' | 'confirmado' | 'realizado' | 'cancelado';

interface Appointment {
  id: string;
  client_name: string;
  client_phone?: string;
  client_email?: string;
  scheduled_at: string;
  duration_minutes: number;
  title?: string;
  notes?: string;
  property?: string;
  property_id?: string;
  status: AppointmentStatus;
  source: string;
}

interface Property {
  id: string;
  title: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pendente:   { label: 'Pendente',   color: 'amber',  icon: <AlertCircle  size={12} /> },
  confirmado: { label: 'Confirmado', color: 'blue',   icon: <CheckCircle2 size={12} /> },
  realizado:  { label: 'Realizado',  color: 'green',  icon: <CheckCircle2 size={12} /> },
  cancelado:  { label: 'Cancelado',  color: 'red',    icon: <XCircle      size={12} /> },
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pendente:   'bg-amber-500/20 text-amber-300 border-amber-400/30',
  confirmado: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  realizado:  'bg-green-500/20 text-green-300 border-green-400/30',
  cancelado:  'bg-red-500/20 text-red-300/70 border-red-400/20 line-through opacity-60',
};

const DOT_COLORS: Record<AppointmentStatus, string> = {
  pendente:   'bg-amber-400',
  confirmado: 'bg-blue-400',
  realizado:  'bg-green-400',
  cancelado:  'bg-white/20',
};

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ─── AppointmentModal ─────────────────────────────────────────────────────────

interface ModalProps {
  initial?: Partial<Appointment> & { date?: string };
  properties: Property[];
  onClose: () => void;
  onSaved: () => void;
}

function AppointmentModal({ initial, properties, onClose, onSaved }: ModalProps) {
  const isEdit = !!initial?.id;

  // Build default scheduled_at: use date from initial or today, time 09:00
  const defaultDate = initial?.date
    ? initial.date
    : initial?.scheduled_at
    ? initial.scheduled_at.split('T')[0]
    : isoDate(new Date());
  const defaultTime = initial?.scheduled_at
    ? formatTime(initial.scheduled_at)
    : '09:00';

  const [form, setForm] = useState({
    client_name:      initial?.client_name      ?? '',
    client_phone:     stripDDI(initial?.client_phone ?? ''),
    client_email:     initial?.client_email     ?? '',
    date:             defaultDate,
    time:             defaultTime,
    duration_minutes: initial?.duration_minutes ?? 60,
    title:            initial?.title            ?? '',
    notes:            initial?.notes            ?? '',
    property_id:      initial?.property_id      ?? '',
    status:           (initial?.status          ?? 'pendente') as AppointmentStatus,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.client_name.trim()) { setError('Nome do cliente é obrigatório.'); return; }
    if (!form.date || !form.time)  { setError('Data e hora são obrigatórios.');  return; }

    setSaving(true);
    setError('');

    const scheduled_at = new Date(`${form.date}T${form.time}:00`).toISOString();
    const body: any = {
      client_name:      form.client_name,
      client_phone:     form.client_phone ? normalizePhoneBR(form.client_phone) : null,
      client_email:     form.client_email  || null,
      scheduled_at,
      duration_minutes: Number(form.duration_minutes),
      title:            form.title         || null,
      notes:            form.notes         || null,
      property_id:      form.property_id   || null,
      status:           form.status,
    };

    try {
      const url    = isEdit ? `/api/agenda/visits/${initial!.id}` : '/api/agenda/visits';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erro'); }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden
        backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">
            {isEdit ? 'Editar agendamento' : 'Novo agendamento'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          {/* Client name */}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <User size={11} /> Nome do cliente
            </label>
            <input
              value={form.client_name}
              onChange={e => set('client_name', e.target.value)}
              placeholder="Nome completo"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
            />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50
                  bg-white/5 border border-white/12">
                  +55
                </span>
                <input
                  value={form.client_phone}
                  onChange={e => set('client_phone', digitsOnly(e.target.value))}
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="62994381279"
                  className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-white
                    bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Mail size={11} /> E-mail
              </label>
              <input
                value={form.client_email}
                onChange={e => set('client_email', e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                  bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
              />
            </div>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar size={11} /> Data
              </label>
              <input
                type="date"
                value={form.date}
                onChange={e => set('date', e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                  bg-white/8 border border-white/12
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors
                  [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Clock size={11} /> Horário
              </label>
              <input
                type="time"
                value={form.time}
                onChange={e => set('time', e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                  bg-white/8 border border-white/12
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors
                  [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Duration + Property */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Clock size={11} /> Duração
              </label>
              <select
                value={form.duration_minutes}
                onChange={e => set('duration_minutes', Number(e.target.value))}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                  bg-white/8 border border-white/12
                  focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
              >
                <option value={30} style={{ backgroundColor: '#1e293b', color: '#fff' }}>30 min</option>
                <option value={60} style={{ backgroundColor: '#1e293b', color: '#fff' }}>1 hora</option>
                <option value={90} style={{ backgroundColor: '#1e293b', color: '#fff' }}>1h30</option>
                <option value={120} style={{ backgroundColor: '#1e293b', color: '#fff' }}>2 horas</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Home size={11} /> Imóvel
              </label>
              <select
                value={form.property_id}
                onChange={e => set('property_id', e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                  bg-white/8 border border-white/12
                  focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
              >
                <option value="" style={{ backgroundColor: '#1e293b', color: '#fff' }}>— nenhum —</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b', color: '#fff' }}>{p.title}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
                Status
              </label>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(STATUS_CONFIG) as AppointmentStatus[]).map(s => (
                  <button
                    key={s}
                    onClick={() => set('status', s)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      form.status === s
                        ? STATUS_STYLES[s]
                        : 'bg-white/5 text-white/30 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title + Notes */}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
              Assunto (opcional)
            </label>
            <input
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Ex.: Visita ao apartamento"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
              Observações
            </label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
              placeholder="Detalhes adicionais..."
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50
              bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white
              bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors
              disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isEdit ? 'Salvar' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AppointmentCard ──────────────────────────────────────────────────────────

interface CardProps {
  appt: Appointment;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: AppointmentStatus) => void;
}

const AppointmentCard: React.FC<CardProps> = ({ appt, onEdit, onDelete, onStatusChange }) => {
  const cfg = STATUS_CONFIG[appt.status];
  return (
    <div className="rounded-2xl backdrop-blur-md bg-white/8 border border-white/12
      shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] p-4 space-y-3">

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{appt.client_name}</p>
          <p className="text-xs text-white/40 mt-0.5">
            {formatTime(appt.scheduled_at)} · {appt.duration_minutes}min
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[appt.status]}`}>
            {cfg.icon} {cfg.label}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1">
        {appt.client_phone && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Phone size={11} className="shrink-0" />
            <span className="font-mono">{appt.client_phone}</span>
          </div>
        )}
        {appt.property && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Home size={11} className="shrink-0" />
            <span className="truncate">{appt.property}</span>
          </div>
        )}
        {appt.title && (
          <p className="text-xs text-white/40 italic truncate">{appt.title}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/8">
        {appt.status === 'pendente' && (
          <button
            onClick={() => onStatusChange('confirmado')}
            className="flex-1 py-1.5 rounded-xl text-[11px] font-bold
              bg-blue-500/20 text-blue-300 border border-blue-400/20 hover:bg-blue-500/30 transition-colors"
          >
            Confirmar
          </button>
        )}
        {appt.status === 'confirmado' && (
          <button
            onClick={() => onStatusChange('realizado')}
            className="flex-1 py-1.5 rounded-xl text-[11px] font-bold
              bg-green-500/20 text-green-300 border border-green-400/20 hover:bg-green-500/30 transition-colors"
          >
            Concluir
          </button>
        )}
        <button
          onClick={onEdit}
          className="p-1.5 rounded-xl bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/70 transition-colors"
        >
          <Edit3 size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-xl bg-red-500/10 text-red-400/60 border border-red-400/10 hover:bg-red-500/20 hover:text-red-400 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgendaCalendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [properties, setProperties]     = useState<Property[]>([]);
  const [loading, setLoading]           = useState(false);
  const [selectedDay, setSelectedDay]   = useState<string>(isoDate(today));
  const [modalOpen, setModalOpen]       = useState(false);
  const [editTarget, setEditTarget]     = useState<Appointment | null>(null);
  const [modalDate, setModalDate]       = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<Appointment | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const y = currentMonth.getFullYear();
      const m = currentMonth.getMonth();
      const start = new Date(y, m, 1).toISOString();
      const end   = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
      const res = await fetch(
        `/api/agenda/visits?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: authService.getAuthHeaders() }
      );
      if (!res.ok) throw new Error('Falha');
      setAppointments(await res.json());
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  const fetchProperties = useCallback(async () => {
    try {
      const res = await fetch('/api/properties', { headers: authService.getAuthHeaders() });
      if (!res.ok) return;
      setProperties(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);
  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  async function deleteAppointment(appt: Appointment) {
    setDeleting(true);
    try {
      await fetch(`/api/agenda/visits/${appt.id}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders(),
      });
      await fetchAppointments();
      setDeleteTarget(null);
    } catch {
      /* ignore */
    } finally {
      setDeleting(false);
    }
  }

  async function changeStatus(appt: Appointment, status: AppointmentStatus) {
    try {
      await fetch(`/api/agenda/visits/${appt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status }),
      });
      await fetchAppointments();
    } catch { /* ignore */ }
  }

  // ── Build calendar grid ──────────────────────────────────────────────────────

  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDay   = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (null | number)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  // Group appointments by day
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const key = isoDate(new Date(a.scheduled_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(a);
  }

  const selectedAppts = byDay.get(selectedDay) || [];
  const monthLabel = currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function openNewModal(date: string) {
    setEditTarget(null);
    setModalDate(date);
    setModalOpen(true);
  }

  function openEditModal(appt: Appointment) {
    setEditTarget(appt);
    setModalDate('');
    setModalOpen(true);
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6">

      {/* ── Calendar panel ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-white capitalize">{monthLabel}</h2>
          <div className="flex items-center gap-2">
            {loading && <Loader2 size={16} className="animate-spin text-white/40" />}
            <button
              onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
              className="p-2 rounded-xl bg-white/8 border border-white/12 text-white/60
                hover:bg-white/12 hover:text-white transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
              className="p-2 rounded-xl bg-white/8 border border-white/12 text-white/60
                hover:bg-white/12 hover:text-white transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => openNewModal(selectedDay)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl
                bg-blue-600/80 border border-blue-400/30 text-white text-sm font-bold
                hover:bg-blue-600 transition-colors"
            >
              <Plus size={16} /> Agendar
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="rounded-3xl overflow-hidden backdrop-blur-xl bg-white/8 border border-white/12
          shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_32px_rgba(0,0,0,0.25)]">

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-white/10">
            {WEEKDAYS.map(d => (
              <div key={d} className="py-3 text-center text-[11px] font-bold text-white/30 uppercase tracking-wider">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`e-${idx}`} className="border-b border-r border-white/5 min-h-[72px] last:border-r-0" />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayAppts = byDay.get(dateStr) || [];
              const isToday = dateStr === isoDate(today);
              const isSelected = dateStr === selectedDay;
              const isWeekend = [0, 6].includes(new Date(year, month, day).getDay());

              return (
                <div
                  key={dateStr}
                  onClick={() => setSelectedDay(dateStr)}
                  className={`relative min-h-[72px] p-2 border-b border-r border-white/5 cursor-pointer transition-colors
                    ${idx % 7 === 6 ? 'border-r-0' : ''}
                    ${isSelected
                      ? 'bg-blue-600/20 border-blue-400/20'
                      : isWeekend
                      ? 'bg-white/3 hover:bg-white/6'
                      : 'hover:bg-white/5'
                    }`}
                >
                  {/* Day number */}
                  <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold
                    ${isToday
                      ? 'bg-blue-500 text-white'
                      : isSelected
                      ? 'text-blue-300'
                      : 'text-white/60'
                    }`}
                  >
                    {day}
                  </span>

                  {/* Appointment dots */}
                  {dayAppts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {dayAppts.slice(0, 3).map(a => (
                        <span
                          key={a.id}
                          className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[a.status]}`}
                        />
                      ))}
                      {dayAppts.length > 3 && (
                        <span className="text-[9px] text-white/30 leading-none mt-0.5">
                          +{dayAppts.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Mini quick-add on hover for today/future */}
                  {(day >= today.getDate() || month > today.getMonth() || year > today.getFullYear()) && (
                    <button
                      onClick={e => { e.stopPropagation(); openNewModal(dateStr); }}
                      className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100
                        w-5 h-5 rounded-lg flex items-center justify-center
                        bg-white/10 text-white/40 hover:bg-white/20 hover:text-white/70 transition-all"
                    >
                      <Plus size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Day detail panel ─────────────────────────────────────────────────── */}
      <div className="xl:w-72 2xl:w-80">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-white capitalize">
              {formatDateLabel(selectedDay + 'T12:00:00')}
            </p>
            <p className="text-xs text-white/40">
              {selectedAppts.length} {selectedAppts.length === 1 ? 'agendamento' : 'agendamentos'}
            </p>
          </div>
          <button
            onClick={() => openNewModal(selectedDay)}
            className="p-2 rounded-xl bg-white/8 border border-white/12 text-white/60
              hover:bg-blue-600/40 hover:text-blue-300 hover:border-blue-400/30 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {selectedAppts.length === 0 ? (
            <div className="rounded-2xl backdrop-blur-md bg-white/5 border border-white/8
              flex flex-col items-center justify-center py-10 text-center px-4">
              <Calendar size={24} className="text-white/20 mb-3" />
              <p className="text-sm text-white/30">Nenhum agendamento neste dia.</p>
              <button
                onClick={() => openNewModal(selectedDay)}
                className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                + Criar agendamento
              </button>
            </div>
          ) : (
            selectedAppts
              .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
              .map(appt => (
                <AppointmentCard
                  key={appt.id}
                  appt={appt}
                  onEdit={() => openEditModal(appt)}
                  onDelete={() => setDeleteTarget(appt)}
                  onStatusChange={status => changeStatus(appt, status)}
                />
              ))
          )}
        </div>
      </div>

      {/* ── Modal ────────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <AppointmentModal
          initial={editTarget ? editTarget : { date: modalDate }}
          properties={properties}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSaved={fetchAppointments}
        />
      )}

      {/* ── Delete confirm ────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden
            backdrop-blur-2xl bg-white/12 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] p-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4
              bg-red-500/20 border border-red-400/30 text-red-300">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Excluir agendamento?</h3>
            <p className="text-sm text-white/50 mb-6">
              Agendamento com <strong className="text-white/70">{deleteTarget.client_name}</strong> será removido.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white/50
                  bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteAppointment(deleteTarget)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-red-300
                  bg-red-500/20 border border-red-400/20 hover:bg-red-500/30 transition-colors
                  disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
