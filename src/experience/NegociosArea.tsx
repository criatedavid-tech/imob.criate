import React, { useEffect, useState } from 'react';
import { Loader2, Phone, Home as HomeIcon, ChevronLeft, ChevronRight, Briefcase, Plus, X, User, Pencil } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';

interface Lead {
  id: string;
  name: string;
  phone: string;
  property?: string;
  property_id?: string;
  notes?: string;
  status: string;
  created_at: string;
}

interface PropertyOption {
  id: string;
  title: string;
}

// Cadastro/edição de lead — hoje POST /api/leads só era chamado pela landing
// page pública (cliente preenchendo formulário sozinho); esse modal é a
// primeira forma do corretor adicionar/editar um lead direto, sem depender disso.
function NewLeadModal({
  properties,
  initial,
  onClose,
  onCreated,
}: {
  properties: PropertyOption[];
  initial?: Lead | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone ? stripDDI(initial.phone) : '');
  const [propertyId, setPropertyId] = useState(initial?.property_id || properties[0]?.id || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Nome é obrigatório.'); return; }
    if (!phone.trim()) { setError('Telefone é obrigatório.'); return; }
    if (!propertyId) { setError('Selecione um imóvel.'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(isEdit ? `/api/leads/${initial!.id}` : '/api/leads', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          property_id: propertyId, name, phone: normalizePhoneBR(phone),
          notes: notes || (isEdit ? undefined : 'Cadastro manual'),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Falha ao ${isEdit ? 'editar' : 'criar'} lead.`);
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || `Falha ao ${isEdit ? 'editar' : 'criar'} lead.`);
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

        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">{isEdit ? 'Editar lead' : 'Novo lead'}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          {properties.length === 0 && !isEdit ? (
            <p className="text-sm text-white/50">
              Cadastre um imóvel na Carteira primeiro — todo lead precisa estar ligado a um.
            </p>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <User size={11} /> Nome
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                    bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
                />
              </div>
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
                    value={phone}
                    onChange={(e) => setPhone(digitsOnly(e.target.value))}
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="62994381279 (DDD + número)"
                    className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-white
                      bg-white/8 border border-white/12 placeholder-white/25
                      focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <HomeIcon size={11} /> Imóvel
                </label>
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                    bg-white/8 border border-white/12
                    focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b', color: '#fff' }}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
                  Observações (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Detalhes adicionais..."
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white
                    bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors resize-none"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50
              bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          {(properties.length > 0 || isEdit) && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white
                bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors
                disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {isEdit ? 'Salvar' : 'Criar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Estágios do funil real, mesma nomenclatura do widget mock do cockpit
// (engine.ts) — mantém a linguagem consistente entre prévia e dado real.
const STAGES: { key: string; label: string }[] = [
  { key: 'new', label: 'Novo' },
  { key: 'contato', label: 'Em contato' },
  { key: 'visita', label: 'Visita' },
  { key: 'proposta', label: 'Proposta' },
  { key: 'fechado', label: 'Fechado' },
];

function stageOf(lead: Lead): string {
  return STAGES.some((s) => s.key === lead.status) ? lead.status : 'new';
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Negócios real: funil sobre os leads já capturados (GET /api/leads, mesma
// fonte do widget "leads recentes" do cockpit) — sem tabela nova. Mover de
// estágio reaproveita PATCH /api/leads/:id/status, que já existia.
export function NegociosArea() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/leads', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar negócios.`);
        }
        return r.json();
      })
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message || 'Erro ao carregar negócios.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetch('/api/properties', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .catch(() => setProperties([]));
  }, []);

  const moveTo = async (lead: Lead, newStatus: string) => {
    const prevStatus = lead.status;
    setMovingId(lead.id);
    setLeads((cur) => (cur || []).map((l) => (l.id === lead.id ? { ...l, status: newStatus } : l)));
    try {
      const res = await fetch(`/api/leads/${lead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setLeads((cur) => (cur || []).map((l) => (l.id === lead.id ? { ...l, status: prevStatus } : l)));
    } finally {
      setMovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Leads</h2>
        <GlassCard className="!py-10 text-center">
          <p className="text-[14px] text-red-300">{error}</p>
        </GlassCard>
      </div>
    );
  }

  const byStage = new Map<string, Lead[]>();
  for (const s of STAGES) byStage.set(s.key, []);
  for (const l of leads || []) byStage.get(stageOf(l))!.push(l);
  const isEmpty = (leads || []).length === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-white">Leads</h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-white/40">{(leads || []).length} no funil</span>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors"
          >
            <Plus className="w-4 h-4" /> Novo lead
          </button>
        </div>
      </div>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-white/[0.06] border border-white/12">
            <Briefcase className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60 mb-6">
            Nenhum lead ainda. Assim que alguém entrar em contato pela landing page de um imóvel, aparece aqui.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage, idx) => {
            const stageLeads = byStage.get(stage.key) || [];
            const prev = STAGES[idx - 1];
            const next = STAGES[idx + 1];
            return (
              <div key={stage.key} className="w-72 shrink-0">
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="text-[12px] font-bold text-white/60 uppercase tracking-wide">{stage.label}</h3>
                  <span className="text-[11px] text-white/30">{stageLeads.length}</span>
                </div>
                <div
                  className={`space-y-3 rounded-2xl transition-colors min-h-[64px] ${
                    dragOverStage === stage.key ? 'bg-white/[0.05] ring-2 ring-violet-400/40' : ''
                  }`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingId) setDragOverStage(stage.key); }}
                  onDragLeave={() => setDragOverStage((cur) => (cur === stage.key ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStage(null);
                    const lead = (leads || []).find((l) => l.id === draggingId);
                    if (lead && lead.status !== stage.key) moveTo(lead, stage.key);
                    setDraggingId(null);
                  }}
                >
                  {stageLeads.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center">
                      <p className="text-[12px] text-white/25">vazio</p>
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => { setDraggingId(lead.id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                        className={`cursor-grab active:cursor-grabbing transition-opacity ${draggingId === lead.id ? 'opacity-40' : ''}`}
                      >
                      <GlassCard className="!p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[14px] font-bold text-white truncate">{lead.name}</p>
                          <button onClick={() => setEditingLead(lead)}
                            className="shrink-0 p-1 rounded-lg text-white/25 hover:bg-white/[0.08] hover:text-white/60 transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                        {lead.property && (
                          <p className="text-[11px] text-white/45 flex items-center gap-1 mt-0.5 truncate">
                            <HomeIcon className="w-3 h-3 shrink-0" /> {lead.property}
                          </p>
                        )}
                        {lead.phone && (
                          <p className="text-[11px] text-white/45 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 shrink-0" /> {lead.phone}
                          </p>
                        )}
                        <p className="text-[10px] text-white/25 mt-2">{timeAgo(lead.created_at)}</p>

                        <div className="flex items-center gap-1.5 mt-3">
                          {prev && (
                            <button
                              onClick={() => moveTo(lead, prev.key)}
                              disabled={movingId === lead.id}
                              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/30
                                hover:bg-white/[0.08] hover:text-white/60 transition-colors disabled:opacity-40"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {next && (
                            <button
                              onClick={() => moveTo(lead, next.key)}
                              disabled={movingId === lead.id}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-semibold text-white/60
                                bg-white/[0.05] hover:bg-white/[0.1] transition-colors disabled:opacity-40"
                            >
                              {movingId === lead.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                              {next.label}
                            </button>
                          )}
                        </div>
                      </GlassCard>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <NewLeadModal
          properties={properties}
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
      {editingLead && (
        <NewLeadModal
          properties={properties}
          initial={editingLead}
          onClose={() => setEditingLead(null)}
          onCreated={load}
        />
      )}
    </div>
  );
}
