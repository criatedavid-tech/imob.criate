import React, { useEffect, useState } from 'react';
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Star, Archive, ArchiveRestore,
  ChevronUp, ChevronDown, GitBranch,
} from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

export interface CrmStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string | null;
  stage_type: 'open' | 'won' | 'lost';
  active: boolean;
}

export interface CrmPipeline {
  id: string;
  broker_id: string;
  name: string;
  is_default: boolean;
  active: boolean;
  stages: CrmStage[];
  // Só o titular pode alterar a estrutura. Membros continuam vendo o funil
  // e movimentando os próprios leads, mas a tela de Pipelines fica leitura.
  can_manage?: boolean;
}

const STAGE_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#4ade80', '#facc15', '#38bdf8', '#f87171'];
const STAGE_TYPE_LABEL: Record<CrmStage['stage_type'], string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' };
const STAGE_TYPE_BADGE: Record<CrmStage['stage_type'], string> = {
  open: 'bg-[var(--control-fill-hover)] text-[var(--text-mid)]',
  won: 'bg-emerald-500/20 text-emerald-300',
  lost: 'bg-red-500/20 text-red-300',
};

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.error || `Erro ${res.status}`);
    err.leadsCount = data?.leads_count;
    throw err;
  }
  return data;
}

// Prompt de "mover leads antes de arquivar/excluir" — aparece quando o
// backend recusa com 409 porque a etapa ainda tem leads (server/routes/
// crmPipelines.ts). Escolhe outra etapa do MESMO pipeline como destino.
function ReassignPrompt({
  leadsCount, otherStages, onConfirm, onCancel, busy,
}: {
  leadsCount: number;
  otherStages: CrmStage[];
  onConfirm: (targetStageId: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [target, setTarget] = useState(otherStages[0]?.id || '');
  if (otherStages.length === 0) {
    return (
      <div className="mt-2 rounded-xl bg-red-500/10 border border-red-400/20 px-3 py-2 text-[12px] text-red-200">
        {leadsCount} lead(s) nesta etapa e não há outra etapa neste pipeline pra mover. Crie outra etapa primeiro.
        <button onClick={onCancel} className="ml-2 underline">fechar</button>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl bg-amber-500/10 border border-amber-400/20 px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[12px] text-amber-200">{leadsCount} lead(s) aqui — mover para:</span>
      <select value={target} onChange={(e) => setTarget(e.target.value)}
        className="rounded-lg px-2 py-1 text-[12px] bg-[var(--control-fill-hover)] text-[var(--text-hi)] border border-[var(--glass-border)] [color-scheme:dark]">
        {otherStages.map((s) => <option key={s.id} value={s.id} style={{ backgroundColor: '#1e293b' }}>{s.name}</option>)}
      </select>
      <button onClick={() => onConfirm(target)} disabled={busy}
        className="px-3 py-1 rounded-lg text-[12px] font-bold text-[var(--text-hi)] bg-amber-500/30 hover:bg-amber-500/40 disabled:opacity-40">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mover e continuar'}
      </button>
      <button onClick={onCancel} className="text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)]">cancelar</button>
    </div>
  );
}

function StageRow({
  stage, allStages, onReload, canManage,
}: {
  stage: CrmStage;
  allStages: CrmStage[];
  onReload: () => void;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color || STAGE_COLORS[0]);
  const [stageType, setStageType] = useState(stage.stage_type);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsReassign, setNeedsReassign] = useState<{ mode: 'archive' | 'delete'; leadsCount: number } | null>(null);

  const idx = allStages.findIndex((s) => s.id === stage.id);
  const canMoveUp = idx > 0;
  const canMoveDown = idx >= 0 && idx < allStages.length - 1;
  const otherStages = allStages.filter((s) => s.id !== stage.id && s.active);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/crm/stages/${stage.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), color, stage_type: stageType }) });
      setEditing(false);
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar etapa.');
    } finally {
      setSaving(false);
    }
  };

  const move = async (direction: -1 | 1) => {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= allStages.length) return;
    const reordered = [...allStages];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setBusy(true);
    try {
      await api(`/api/crm/pipelines/${stage.pipeline_id}/stages/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ stage_ids: reordered.map((s) => s.id) }),
      });
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao reordenar.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (reassignToStageId?: string) => {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, any> = { active: !stage.active };
      if (reassignToStageId) body.reassign_to_stage_id = reassignToStageId;
      await api(`/api/crm/stages/${stage.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setNeedsReassign(null);
      onReload();
    } catch (e: any) {
      if (e.leadsCount) setNeedsReassign({ mode: 'archive', leadsCount: e.leadsCount });
      else setError(e.message || 'Falha ao arquivar etapa.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (reassignToStageId?: string) => {
    if (!reassignToStageId && !confirm(`Excluir a etapa "${stage.name}"? Não dá pra desfazer.`)) return;
    setBusy(true);
    setError('');
    try {
      const url = reassignToStageId
        ? `/api/crm/stages/${stage.id}?reassign_to_stage_id=${encodeURIComponent(reassignToStageId)}`
        : `/api/crm/stages/${stage.id}`;
      await api(url, { method: 'DELETE' });
      setNeedsReassign(null);
      onReload();
    } catch (e: any) {
      if (e.leadsCount) setNeedsReassign({ mode: 'delete', leadsCount: e.leadsCount });
      else setError(e.message || 'Falha ao excluir etapa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${stage.active ? 'bg-[var(--control-fill)] border-[var(--hairline)]' : 'bg-white/[0.015] border-[var(--hairline)] opacity-60'}`}>
      <div className="flex items-center gap-2">
        {canManage && (
          <div className="flex flex-col shrink-0 -my-1">
            <button onClick={() => move(-1)} disabled={!canMoveUp || busy} className="text-[var(--text-low)] hover:text-[var(--text-mid)] disabled:opacity-20 disabled:hover:text-[var(--text-low)]">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => move(1)} disabled={!canMoveDown || busy} className="text-[var(--text-low)] hover:text-[var(--text-mid)] disabled:opacity-20 disabled:hover:text-[var(--text-low)]">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {editing ? (
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
            <span className="relative group shrink-0">
              <span className="w-5 h-5 rounded-full block border border-[var(--glass-border)] cursor-pointer" style={{ backgroundColor: color }} />
              <div className="hidden group-hover:flex absolute z-10 top-6 left-0 gap-1 p-1.5 rounded-lg bg-slate-800 border border-[var(--glass-border)] shadow-xl">
                {STAGE_COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} className="w-4 h-4 rounded-full border border-[var(--glass-border)] hover:scale-110 transition-transform" style={{ backgroundColor: c }} />
                ))}
              </div>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus className="flex-1 min-w-[100px] px-2.5 py-1 rounded-lg text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] outline-none border border-[var(--glass-border)]" />
            <select value={stageType} onChange={(e) => setStageType(e.target.value as CrmStage['stage_type'])}
              className="rounded-lg px-2 py-1 text-[12px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--glass-border)] [color-scheme:dark]">
              <option value="open" style={{ backgroundColor: '#1e293b' }}>Em andamento</option>
              <option value="won" style={{ backgroundColor: '#1e293b' }}>Ganho</option>
              <option value="lost" style={{ backgroundColor: '#1e293b' }}>Perdido</option>
            </select>
            <button onClick={save} disabled={saving} className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <span className="w-3 h-3 rounded-full shrink-0 border border-[var(--glass-border)]" style={{ backgroundColor: stage.color || '#888' }} />
            <span className="text-[13px] font-semibold text-[var(--text-hi)] truncate">{stage.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${STAGE_TYPE_BADGE[stage.stage_type]}`}>
              {STAGE_TYPE_LABEL[stage.stage_type]}
            </span>
            {!stage.active && <span className="text-[10px] text-[var(--text-low)] shrink-0">arquivada</span>}
            <div className="flex-1" />
            {canManage && (
              <>
                <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] shrink-0">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => toggleActive()} disabled={busy} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] disabled:opacity-40 shrink-0" title={stage.active ? 'Arquivar' : 'Reativar'}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : stage.active ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => remove()} disabled={busy} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </>
        )}
      </div>
      {error && <p className="text-[11px] text-red-300 mt-1.5">{error}</p>}
      {needsReassign && (
        <ReassignPrompt
          leadsCount={needsReassign.leadsCount}
          otherStages={otherStages}
          busy={busy}
          onCancel={() => setNeedsReassign(null)}
          onConfirm={(targetId) => (needsReassign.mode === 'archive' ? toggleActive(targetId) : remove(targetId))}
        />
      )}
    </div>
  );
}

function PipelineCard({ pipeline, onReload, canManage }: { pipeline: CrmPipeline; onReload: () => void; canManage: boolean }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(pipeline.name);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [creatingStage, setCreatingStage] = useState(false);

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);

  const saveName = async () => {
    if (!name.trim() || name === pipeline.name) { setEditingName(false); return; }
    setSaving(true);
    try {
      await api(`/api/crm/pipelines/${pipeline.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      setEditingName(false);
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao renomear.');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/crm/pipelines/${pipeline.id}`, { method: 'PATCH', body: JSON.stringify({ is_default: true }) });
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao definir como padrão.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/crm/pipelines/${pipeline.id}`, { method: 'PATCH', body: JSON.stringify({ active: !pipeline.active }) });
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao arquivar pipeline.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir o pipeline "${pipeline.name}"? Não dá pra desfazer.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/crm/pipelines/${pipeline.id}`, { method: 'DELETE' });
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao excluir pipeline.');
    } finally {
      setBusy(false);
    }
  };

  const createStage = async () => {
    if (!newStageName.trim()) return;
    setCreatingStage(true);
    setError('');
    try {
      const color = STAGE_COLORS[stages.length % STAGE_COLORS.length];
      await api(`/api/crm/pipelines/${pipeline.id}/stages`, { method: 'POST', body: JSON.stringify({ name: newStageName.trim(), color, stage_type: 'open' }) });
      setNewStageName('');
      onReload();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar etapa.');
    } finally {
      setCreatingStage(false);
    }
  };

  return (
    <GlassCard className="!p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {editingName ? (
          <div className="flex-1 min-w-[160px] flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()}
              autoFocus className="flex-1 px-3 py-1.5 rounded-lg text-[15px] font-bold bg-[var(--control-fill)] text-[var(--text-hi)] outline-none border border-[var(--glass-border)]" />
            <button onClick={saveName} disabled={saving} className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button onClick={() => { setEditingName(false); setName(pipeline.name); }} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)]">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-[16px] font-bold text-[var(--text-hi)]">{pipeline.name}</h3>
            {canManage && (
              <button onClick={() => setEditingName(true)} className="p-1 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)]">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {pipeline.is_default && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-violet-500/25 text-violet-200">
                <Star className="w-2.5 h-2.5 fill-current" /> padrão
              </span>
            )}
            {!pipeline.active && <span className="text-[11px] text-[var(--text-low)]">arquivado</span>}
          </>
        )}
        <div className="flex-1" />
        {canManage && !editingName && (
          <div className="flex items-center gap-1 shrink-0">
            {!pipeline.is_default && (
              <button onClick={setDefault} disabled={busy} title="Definir como padrão"
                className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-violet-500/15 hover:text-violet-300 disabled:opacity-40">
                <Star className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={toggleActive} disabled={busy} title={pipeline.active ? 'Arquivar' : 'Reativar'}
              className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pipeline.active ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
            </button>
            <button onClick={remove} disabled={busy} title="Excluir"
              className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {error && <p className="text-[12px] text-red-300 mb-2">{error}</p>}

      <div className="space-y-1.5 mt-3">
        {stages.length === 0 ? (
          <p className="text-[12px] text-[var(--text-low)] py-2">Nenhuma etapa ainda — crie a primeira abaixo.</p>
        ) : stages.map((s) => <React.Fragment key={s.id}><StageRow stage={s} allStages={stages} onReload={onReload} canManage={canManage} /></React.Fragment>)}
      </div>

      {canManage && (
        <div className="flex gap-2 pt-3 mt-3 border-t border-[var(--hairline)]">
          <input value={newStageName} onChange={(e) => setNewStageName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createStage()}
            placeholder="Nova etapa…"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] outline-none border border-[var(--hairline-strong)]" />
          <button onClick={createStage} disabled={creatingStage || !newStageName.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-bold text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] disabled:opacity-40 transition-colors">
            {creatingStage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Etapa
          </button>
        </div>
      )}
    </GlassCard>
  );
}

export function PipelinesManager() {
  const [pipelines, setPipelines] = useState<CrmPipeline[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    api('/api/crm/pipelines').then(setPipelines).catch((e) => setError(e.message || 'Falha ao carregar pipelines.'));
  };
  useEffect(load, []);

  const createPipeline = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await api('/api/crm/pipelines', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
      setNewName('');
      load();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar pipeline.');
    } finally {
      setCreating(false);
    }
  };

  if (pipelines === null) {
    return (
      <div className="flex justify-center pt-16">
        {error ? <p className="text-[14px] text-red-300">{error}</p> : <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />}
      </div>
    );
  }

  const canManage = pipelines.some((pipeline) => pipeline.can_manage === true);

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createPipeline()}
            placeholder="Nome do novo pipeline…"
            className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] outline-none border border-[var(--hairline-strong)]" />
          <button onClick={createPipeline} disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)] bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40 transition-colors shrink-0">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Novo pipeline
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-[var(--text-low)]">Somente o titular da conta pode alterar pipelines e etapas.</p>
      )}

      {error && pipelines !== null && <p className="text-[12px] text-red-300">{error}</p>}

      {pipelines.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <GitBranch className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)]">Nenhum pipeline configurado ainda.</p>
        </GlassCard>
      ) : (
        pipelines.map((p) => <React.Fragment key={p.id}><PipelineCard pipeline={p} onReload={load} canManage={canManage} /></React.Fragment>)
      )}
    </div>
  );
}
