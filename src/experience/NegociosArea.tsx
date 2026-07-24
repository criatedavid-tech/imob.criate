import React, { useEffect, useState } from 'react';
import { Loader2, Phone, Home as HomeIcon, ChevronLeft, ChevronRight, Briefcase, Plus, X, User, Pencil, Trash2 } from 'lucide-react';
import {
  DndContext, DragOverlay, useDraggable, useDroppable, useSensor, useSensors,
  MouseSensor, TouchSensor, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';
import { cn } from '../lib/utils';
import { PipelinesManager, type CrmPipeline, type CrmStage } from './PipelinesManager';

interface Lead {
  id: string;
  name: string;
  phone: string;
  property?: string;
  property_id?: string;
  notes?: string;
  status: string;
  created_at: string;
  pipeline_id?: string | null;
  pipeline_stage_id?: string | null;
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
  defaultPipelineId,
  onClose,
  onCreated,
}: {
  properties: PropertyOption[];
  initial?: Lead | null;
  defaultPipelineId?: string;
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
          ...(isEdit ? {} : { pipeline_id: defaultPipelineId }),
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden
        max-h-[calc(100dvh-1.5rem)] min-h-0 flex flex-col
        backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">

        <div className="flex items-center justify-between px-4 sm:px-6 py-4 sm:py-5 border-b border-[var(--hairline)] shrink-0">
          <h3 className="text-lg font-bold text-[var(--text-hi)]">{isEdit ? 'Editar lead' : 'Novo lead'}</h3>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto min-h-0">
          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          {properties.length === 0 && !isEdit ? (
            <p className="text-sm text-[var(--text-low)]">
              Cadastre um imóvel na Carteira primeiro — todo lead precisa estar ligado a um.
            </p>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <User size={11} /> Nome
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                    bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Phone size={11} /> Telefone
                </label>
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)]
                    bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
                    +55
                  </span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(digitsOnly(e.target.value))}
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="62994381279 (DDD + número)"
                    className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                      bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                      focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <HomeIcon size={11} /> Imóvel
                </label>
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                    bg-[var(--control-fill)] border border-[var(--hairline-strong)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] transition-colors [color-scheme:dark]"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b', color: '#fff' }}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
                  Observações (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Detalhes adicionais..."
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                    bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors resize-none"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 px-4 sm:px-6 py-4 border-t border-[var(--hairline)] shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)]
              bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            Cancelar
          </button>
          {(properties.length > 0 || isEdit) && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)]
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

const LEADS_PAGE_SIZE = 100;

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Corpo visual de um card de lead — compartilhado entre a renderização normal
// (dentro da coluna, arrastável) e o DragOverlay (cópia que segue o
// dedo/cursor durante o arrasto).
function LeadCardBody({
  lead, prev, next, movingId, deletingId, onEdit, onDelete, onMove,
}: {
  lead: Lead;
  prev?: CrmStage;
  next?: CrmStage;
  movingId: string | null;
  deletingId: string | null;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  onMove: (lead: Lead, stage: CrmStage) => void;
}) {
  return (
    <GlassCard className="!p-3 !rounded-2xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-[var(--text-hi)] truncate">{lead.name}</p>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onEdit(lead)}
            className="p-1 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors">
            <Pencil className="w-3 h-3" />
          </button>
          <button onClick={() => onDelete(lead)} disabled={deletingId === lead.id}
            className="p-1 rounded-lg text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
            {deletingId === lead.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      </div>
      {lead.property && (
        <p className="text-[10px] text-[var(--text-low)] flex items-center gap-1 mt-0.5 truncate">
          <HomeIcon className="w-2.5 h-2.5 shrink-0" /> {lead.property}
        </p>
      )}
      {lead.phone && (
        <p className="text-[10px] text-[var(--text-low)] flex items-center gap-1 mt-0.5">
          <Phone className="w-2.5 h-2.5 shrink-0" /> {lead.phone}
        </p>
      )}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[9px] text-[var(--text-low)] mr-auto">{timeAgo(lead.created_at)}</span>
        {prev && (
          <button
            onClick={() => onMove(lead, prev)}
            disabled={movingId === lead.id}
            title={`Voltar pra ${prev.name}`}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--text-low)]
              hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors disabled:opacity-40"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
        {next && (
          <button
            onClick={() => onMove(lead, next)}
            disabled={movingId === lead.id}
            title={`Avançar pra ${next.name}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-[var(--text-mid)]
              bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-40 max-w-[110px]"
          >
            {movingId === lead.id ? <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" /> : <ChevronRight className="w-2.5 h-2.5 shrink-0" />}
            <span className="truncate">{next.name}</span>
          </button>
        )}
      </div>
    </GlassCard>
  );
}

// Arrasto via @dnd-kit (Pointer/Touch Events), não mais a API nativa HTML5
// (draggable/onDragStart/onDragOver/onDrop) — essa API nunca funcionou por
// toque no Safari iOS (o WebKit nunca implementou suporte a ela via touch;
// o Chrome Android tinha uma camada de compatibilidade própria que mascarava
// o problema, por isso "funcionava" só lá — feedback 20/07). Sensors
// separados por tipo de entrada: mouse ativa por distância (resposta
// imediata, igual antes), toque ativa por delay (dá tempo de um gesto de
// rolar a tela — horizontal entre colunas, vertical dentro de uma — sem
// disparar um arrasto sem querer). Mesmo padrão do exemplo oficial
// "Multiple Containers" do dnd-kit.
function DraggableLead({ lead, children }: { lead: Lead; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: 'none',
        opacity: isDragging ? 0.3 : 1,
      }}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

// Toda a lane é a zona de soltar (não só os cards) — soltar no vão vazio
// embaixo da coluna também funciona.
function DroppableStage({ stageId, className, children }: { stageId: string; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && 'bg-[var(--control-fill)] ring-2 ring-violet-400/40')}>
      {children}
    </div>
  );
}

// Kanban real sobre os leads já capturados (GET /api/leads?pipeline_id=,
// mesma fonte do widget "leads recentes" do cockpit) — colunas vêm do
// pipeline selecionado (GET /api/crm/pipelines), não mais de um array fixo.
// Mover de etapa usa PATCH /api/leads/:id/stage (novo — substitui o antigo
// PATCH /:id/status pra este fluxo; /status continua existindo intacto
// pra qualquer chamador externo que ainda dependa só dele).
function KanbanBoard() {
  const [pipelines, setPipelines] = useState<CrmPipeline[] | null>(null);
  const [pipelineError, setPipelineError] = useState('');
  const [selectedPipelineId, setSelectedPipelineId] = useState('');

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [totalLeads, setTotalLeads] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPipelines = () => {
    fetch('/api/crm/pipelines', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error('Erro ao carregar pipelines.');
        return r.json();
      })
      .then((data: CrmPipeline[]) => {
        setPipelines(data);
        setSelectedPipelineId((cur) => {
          if (cur && data.some((p) => p.id === cur)) return cur;
          const def = data.find((p) => p.is_default) || data[0];
          return def?.id || '';
        });
      })
      .catch((e) => setPipelineError(e.message || 'Erro ao carregar pipelines.'));
  };
  useEffect(loadPipelines, []);

  const selectedPipeline = (pipelines || []).find((p) => p.id === selectedPipelineId) || null;
  const stages = (selectedPipeline?.stages || []).filter((s) => s.active).sort((a, b) => a.position - b.position);

  const load = (append = false) => {
    if (!selectedPipelineId) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    const offset = append ? (leads?.length || 0) : 0;
    fetch(`/api/leads?pipeline_id=${encodeURIComponent(selectedPipelineId)}&limit=${LEADS_PAGE_SIZE}&offset=${offset}`, { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar negócios.`);
        }
        const data = await r.json();
        return {
          data: Array.isArray(data) ? data : [],
          total: Number(r.headers.get('X-Total-Count') || 0),
          hasMore: r.headers.get('X-Has-More') === 'true',
        };
      })
      .then((page) => {
        setTotalLeads(page.total);
        setHasMore(page.hasMore);
        setLeads((current) => {
          if (!append) return page.data;
          const byId = new Map((current || []).map((lead) => [lead.id, lead]));
          for (const lead of page.data) byId.set(lead.id, lead);
          return Array.from(byId.values());
        });
      })
      .catch((e) => setError(e.message || 'Erro ao carregar negócios.'))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  };

  useEffect(() => { if (selectedPipelineId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedPipelineId]);
  useEffect(() => {
    fetch('/api/properties', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .catch(() => setProperties([]));
  }, []);

  const moveTo = async (lead: Lead, stage: CrmStage) => {
    const prevStageId = lead.pipeline_stage_id;
    setMovingId(lead.id);
    setLeads((cur) => (cur || []).map((l) => (l.id === lead.id ? { ...l, pipeline_stage_id: stage.id } : l)));
    try {
      const res = await fetch(`/api/leads/${lead.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ stage_id: stage.id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setLeads((cur) => (cur || []).map((l) => (l.id === lead.id ? { ...l, pipeline_stage_id: prevStageId } : l)));
    } finally {
      setMovingId(null);
    }
  };

  // Mouse ativa por distância (resposta imediata, como um clique-e-arraste
  // comum); toque ativa por delay — sem isso, um gesto de rolar a tela
  // (a lista de colunas rola na horizontal, cada coluna pode rolar na
  // vertical) seria interpretado como início de arrasto.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const lead = (leads || []).find((l) => l.id === active.id);
    const targetStage = stages.find((s) => s.id === over.id);
    if (lead && targetStage && lead.pipeline_stage_id !== targetStage.id) moveTo(lead, targetStage);
  };

  const activeLead = activeId ? (leads || []).find((l) => l.id === activeId) || null : null;
  const activeLeadStageIdx = activeLead ? stages.findIndex((s) => s.id === activeLead.pipeline_stage_id) : -1;

  const deleteLead = async (lead: Lead) => {
    if (!confirm(`Apagar o lead "${lead.name}"? Não dá pra desfazer.`)) return;
    setDeletingId(lead.id);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao apagar lead.');
      }
      setLeads((cur) => (cur || []).filter((l) => l.id !== lead.id));
      setTotalLeads((t) => Math.max(0, t - 1));
    } catch (e: any) {
      alert(e.message || 'Falha ao apagar lead.');
    } finally {
      setDeletingId(null);
    }
  };

  const byStage = new Map<string, Lead[]>();
  for (const s of stages) byStage.set(s.id, []);
  const unassigned: Lead[] = [];
  for (const l of leads || []) {
    if (l.pipeline_stage_id && byStage.has(l.pipeline_stage_id)) byStage.get(l.pipeline_stage_id)!.push(l);
    else if (leads) unassigned.push(l);
  }
  const isEmpty = (leads || []).length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0 w-full sm:w-auto">
          {pipelines && pipelines.length > 0 && (
            <select
              value={selectedPipelineId}
              onChange={(e) => { setSelectedPipelineId(e.target.value); setLeads(null); }}
              className="max-w-full flex-1 sm:flex-none rounded-xl px-3 py-2 text-[13px] font-semibold bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] [color-scheme:dark]"
            >
              {pipelines.filter((p) => p.active || p.id === selectedPipelineId).map((p) => (
                <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b' }}>
                  {p.name}{p.is_default ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          )}
          {leads && (
            <span className="text-[12px] text-[var(--text-low)]">
              {leads.length}{totalLeads > leads.length ? ` de ${totalLeads}` : ''} no funil
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!selectedPipelineId}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
            bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] disabled:opacity-40 transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo lead
        </button>
      </div>

      {pipelineError && (
        <GlassCard className="!py-6 text-center mb-4"><p className="text-[13px] text-red-300">{pipelineError}</p></GlassCard>
      )}

      {!selectedPipelineId ? (
        pipelines === null ? (
          <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>
        ) : (
          <GlassCard className="!py-14 text-center">
            <p className="text-[15px] text-[var(--text-mid)]">Nenhum pipeline ativo. Crie um na aba Pipelines.</p>
          </GlassCard>
        )
      ) : loading ? (
        <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>
      ) : error ? (
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      ) : stages.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <p className="text-[15px] text-[var(--text-mid)]">Este pipeline ainda não tem etapas. Crie a primeira na aba Pipelines.</p>
        </GlassCard>
      ) : isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Briefcase className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)] mb-6">
            Nenhum lead ainda neste pipeline. Assim que alguém entrar em contato pela landing page de um imóvel, aparece aqui.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        // Lanes estilo referência: cada etapa é um painel de altura cheia com
        // fundo próprio. No desktop as colunas DIVIDEM a largura disponível
        // (flex-1) — sem barra de rolagem pra até ~5 etapas; com mais etapas
        // (ou em tela estreita) o min-w derruba pra rolagem horizontal, mas
        // com a barra nativa escondida (feia demais — feedback 17/07), rolando
        // por gesto/trackpad/shift+scroll.
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 items-stretch overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {stages.map((stage, idx) => {
              const stageLeads = byStage.get(stage.id) || [];
              const prev = stages[idx - 1];
              const next = stages[idx + 1];
              return (
                <div key={stage.id} className="flex-1 min-w-[200px] flex flex-col rounded-2xl bg-[var(--control-fill)] border border-white/[0.06] p-2.5">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <h3 className="text-[11px] font-bold text-[var(--text-mid)] uppercase tracking-wide flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color || '#888' }} />
                      <span className="truncate">{stage.name}</span>
                    </h3>
                    <span className="text-[11px] text-[var(--text-low)] shrink-0">{stageLeads.length}</span>
                  </div>
                  {/* Zona de drop = a lane inteira (inclui o vão vazio embaixo) —
                      soltar em qualquer lugar da coluna funciona. */}
                  <DroppableStage stageId={stage.id} className="flex-1 space-y-2 rounded-xl transition-colors min-h-[380px]">
                    {stageLeads.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/[0.07] py-5 text-center">
                        <p className="text-[11px] text-[var(--text-low)]">vazio</p>
                      </div>
                    ) : (
                      stageLeads.map((lead) => (
                        <React.Fragment key={lead.id}>
                          <DraggableLead lead={lead}>
                            <LeadCardBody
                              lead={lead} prev={prev} next={next}
                              movingId={movingId} deletingId={deletingId}
                              onEdit={setEditingLead} onDelete={deleteLead} onMove={moveTo}
                            />
                          </DraggableLead>
                        </React.Fragment>
                      ))
                    )}
                  </DroppableStage>
                </div>
              );
            })}
            {unassigned.length > 0 && (
              <div className="flex-1 min-w-[200px] flex flex-col rounded-2xl bg-amber-500/[0.04] border border-amber-300/10 p-2.5">
                <div className="flex items-center justify-between mb-2 px-1">
                  <h3 className="text-[11px] font-bold text-amber-300/70 uppercase tracking-wide">Sem etapa</h3>
                  <span className="text-[11px] text-[var(--text-low)]">{unassigned.length}</span>
                </div>
                <div className="flex-1 space-y-2 min-h-[380px]">
                  {unassigned.map((lead) => (
                    <React.Fragment key={lead.id}>
                      <DraggableLead lead={lead}>
                        <GlassCard className="!p-3 !rounded-2xl">
                          <p className="text-[13px] font-bold text-[var(--text-hi)] truncate">{lead.name}</p>
                          <p className="text-[10px] text-amber-300/60 mt-1">Etapa antiga não existe mais neste pipeline — arraste ou:</p>
                          {stages[0] && (
                            <button
                              onClick={() => moveTo(lead, stages[0])}
                              className="mt-2 w-full py-1 rounded-lg text-[10px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors"
                            >
                              Mover pra {stages[0].name}
                            </button>
                          )}
                        </GlassCard>
                      </DraggableLead>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Cópia flutuante que segue o dedo/cursor durante o arrasto —
              sem isso o card original ficaria só semitransparente (opacity
              no DraggableLead) sem nenhum feedback visual de "onde ele está
              indo". Fora do fluxo normal (portal do próprio dnd-kit), então
              não é afetado pelo overflow-x-auto das colunas. */}
          <DragOverlay>
            {activeLead ? (
              <div className="w-[min(16rem,calc(100vw-2rem))] rotate-2 opacity-95">
                <LeadCardBody
                  lead={activeLead}
                  prev={activeLeadStageIdx > 0 ? stages[activeLeadStageIdx - 1] : undefined}
                  next={activeLeadStageIdx >= 0 ? stages[activeLeadStageIdx + 1] : undefined}
                  movingId={null} deletingId={null}
                  onEdit={() => {}} onDelete={() => {}} onMove={() => {}}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!isEmpty && hasMore && (
        <div className="flex justify-center mt-5">
          <button
            onClick={() => load(true)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-mid)]
              bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50 transition-colors"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            Carregar mais leads
          </button>
        </div>
      )}

      {showCreate && (
        <NewLeadModal
          properties={properties}
          defaultPipelineId={selectedPipelineId}
          onClose={() => setShowCreate(false)}
          onCreated={() => load()}
        />
      )}
      {editingLead && (
        <NewLeadModal
          properties={properties}
          initial={editingLead}
          onClose={() => setEditingLead(null)}
          onCreated={() => load()}
        />
      )}
    </div>
  );
}

// CRM — nome visível de "Leads" (a área/chave interna 'negocios' e a tabela
// 'leads' continuam as mesmas; só a apresentação virou CRM). Duas abas:
// Kanban (funil sobre o pipeline selecionado) e Pipelines (criação/edição
// dos próprios pipelines e etapas — ver PipelinesManager.tsx).
export function NegociosArea() {
  const [tab, setTab] = useState<'kanban' | 'pipelines'>('kanban');

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-black text-[var(--text-hi)]">CRM</h2>
        <div className="flex gap-1 p-1 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)]">
          <button
            onClick={() => setTab('kanban')}
            className={cn(
              'px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-colors',
              tab === 'kanban' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)]' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]',
            )}
          >
            Kanban
          </button>
          <button
            onClick={() => setTab('pipelines')}
            className={cn(
              'px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-colors',
              tab === 'pipelines' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)]' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]',
            )}
          >
            Pipelines
          </button>
        </div>
      </div>

      {tab === 'kanban' ? <KanbanBoard /> : <PipelinesManager />}
    </div>
  );
}
