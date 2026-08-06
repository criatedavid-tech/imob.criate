import React, { useEffect, useState } from 'react';
import { Loader2, Check, History, LayoutGrid } from 'lucide-react';
import { authService } from '../services/auth';

interface Member {
  user_id: string;
  name: string;
  email: string;
  is_owner: boolean;
  created_at: string;
  suspended_at: string | null;
}

const MODULE_ORDER = [
  'carteira', 'negocios', 'contatos', 'agenda', 'conversas',
  'locacao', 'lancamentos', 'financeiro', 'equipe',
  'whatsapp-conexoes', 'relatorios', 'integracoes',
  'configuracoes', 'assistente-ia',
];

const MODULE_LABELS: Record<string, string> = {
  carteira: 'Imóveis',
  negocios: 'Leads / CRM',
  contatos: 'Contatos',
  agenda: 'Agenda',
  conversas: 'Conversas',
  locacao: 'Locação',
  lancamentos: 'Lançamentos',
  financeiro: 'Financeiro',
  equipe: 'Equipe',
  'whatsapp-conexoes': 'Conexões WhatsApp',
  relatorios: 'Relatórios',
  integracoes: 'Integrações',
  configuracoes: 'Configurações',
  'assistente-ia': 'Assistente IA',
};

const ACTION_ORDER = ['visualizar', 'criar', 'editar', 'excluir', 'gerenciar'];
const ACTION_LABELS: Record<string, string> = {
  visualizar: 'Ver',
  criar: 'Criar',
  editar: 'Editar',
  excluir: 'Excluir',
  gerenciar: 'Gerenciar',
};

interface Profile {
  key: string;
  label: string;
  grants: string[];
}

interface AuditRow {
  id: string;
  actor_name: string;
  change_type: 'grant' | 'revoke' | 'profile_applied';
  module: string | null;
  action: string | null;
  profile_key: string | null;
  diff: any;
  created_at: string;
}

function grantLabel(row: AuditRow): string {
  const when = new Date(row.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (row.change_type === 'profile_applied') {
    const added = row.diff?.added?.length || 0;
    const removed = row.diff?.removed?.length || 0;
    return `${row.actor_name} aplicou o perfil "${row.profile_key || ''}" (+${added}, −${removed}) — ${when}`;
  }
  const moduleLabel = MODULE_LABELS[row.module || ''] || row.module;
  const actionLabel = ACTION_LABELS[row.action || ''] || row.action;
  const verb = row.change_type === 'grant' ? 'concedeu' : 'revogou';
  return `${row.actor_name} ${verb} "${moduleLabel}: ${actionLabel}" — ${when}`;
}

export function PermissionsModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const [tab, setTab] = useState<'grade' | 'historico'>('grade');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moduleActions, setModuleActions] = useState<Record<string, string[]>>({});
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [applying, setApplying] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`/api/equipe/members/${member.user_id}/permissions`, { headers: authService.getAuthHeaders() })
        .then(async (r) => {
          if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b?.error || 'Falha ao carregar permissões.'); }
          return r.json();
        }),
      fetch('/api/equipe/permission-profiles', { headers: authService.getAuthHeaders() })
        .then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([perms, profs]) => {
        setModuleActions(perms.module_actions || {});
        setGrants(new Set(perms.grants || []));
        setProfiles(Array.isArray(profs) ? profs : []);
        if (profs?.[0]?.key) setSelectedProfile(profs[0].key);
      })
      .catch((e) => setError(e.message || 'Falha ao carregar permissões.'))
      .finally(() => setLoading(false));
  }, [member.user_id]);

  function loadAudit() {
    setAuditLoading(true);
    setAuditError('');
    fetch(`/api/equipe/members/${member.user_id}/permissions/audit`, { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b?.error || 'Falha ao carregar histórico.'); }
        return r.json();
      })
      .then(setAudit)
      .catch((e) => setAuditError(e.message || 'Falha ao carregar histórico.'))
      .finally(() => setAuditLoading(false));
  }

  function openTab(next: 'grade' | 'historico') {
    setTab(next);
    if (next === 'historico' && audit === null) loadAudit();
  }

  async function toggle(module: string, action: string) {
    const key = `${module}:${action}`;
    const wasGranted = grants.has(key);
    setToggling((prev) => new Set(prev).add(key));
    setGrants((prev) => {
      const next = new Set(prev);
      if (wasGranted) next.delete(key); else next.add(key);
      return next;
    });
    try {
      const res = await fetch(`/api/equipe/members/${member.user_id}/permissions/${module}/${action}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ granted: !wasGranted }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // reverte em caso de falha
      setGrants((prev) => {
        const next = new Set(prev);
        if (wasGranted) next.add(key); else next.delete(key);
        return next;
      });
    } finally {
      setToggling((prev) => { const next = new Set(prev); next.delete(key); return next; });
      if (audit !== null) loadAudit();
    }
  }

  async function applyProfile() {
    if (!selectedProfile) return;
    const profile = profiles.find((p) => p.key === selectedProfile);
    if (!confirm(`Aplicar o perfil "${profile?.label || selectedProfile}"? Isso substitui TODA a grade atual de ${member.name}.`)) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/equipe/members/${member.user_id}/apply-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ profile_key: selectedProfile }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao aplicar perfil.');
      setGrants(new Set(profile?.grants || []));
      if (audit !== null) loadAudit();
    } catch (e: any) {
      alert(e.message || 'Falha ao aplicar perfil.');
    } finally {
      setApplying(false);
    }
  }

  const modules = MODULE_ORDER.filter((m) => moduleActions[m]?.length);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="p-6 pb-0 shrink-0">
          <h3 className="text-lg font-bold text-[var(--text-hi)] mb-1">Permissões de {member.name}</h3>
          <p className="text-[12px] text-[var(--text-low)] mb-4">{member.email}</p>

          <div className="flex items-center gap-1 mb-4 border-b border-[var(--hairline)]">
            <button onClick={() => openTab('grade')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 transition-colors ${
                tab === 'grade' ? 'text-[var(--text-hi)] border-violet-300' : 'text-[var(--text-low)] border-transparent hover:text-[var(--text-mid)]'
              }`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Grade
            </button>
            <button onClick={() => openTab('historico')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 transition-colors ${
                tab === 'historico' ? 'text-[var(--text-hi)] border-violet-300' : 'text-[var(--text-low)] border-transparent hover:text-[var(--text-mid)]'
              }`}>
              <History className="w-3.5 h-3.5" /> Histórico
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : tab === 'grade' ? (
            <>
              <div className="flex items-center gap-2 mb-4">
                <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}
                  className="flex-1 rounded-xl px-3 py-2 text-[13px] text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
                  {profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <button onClick={applyProfile} disabled={applying || !selectedProfile}
                  className="px-3 py-2 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0">
                  {applying ? <Loader2 size={14} className="animate-spin" /> : null} Aplicar perfil
                </button>
              </div>

              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-2 py-1.5 text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wide sticky left-0">Módulo</th>
                      {ACTION_ORDER.map((a) => (
                        <th key={a} className="px-2 py-1.5 text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wide text-center">
                          {ACTION_LABELS[a]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((m) => (
                      <tr key={m} className="border-t border-[var(--hairline)]">
                        <td className="px-2 py-2 text-[13px] font-semibold text-[var(--text-hi)] whitespace-nowrap">{MODULE_LABELS[m] || m}</td>
                        {ACTION_ORDER.map((a) => {
                          const valid = (moduleActions[m] || []).includes(a);
                          const key = `${m}:${a}`;
                          const granted = grants.has(key);
                          const isToggling = toggling.has(key);
                          return (
                            <td key={a} className="px-2 py-2 text-center">
                              {valid ? (
                                <button onClick={() => toggle(m, a)} disabled={isToggling}
                                  className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-50 mx-auto ${
                                    granted
                                      ? 'bg-emerald-500/25 border-emerald-300/40 text-emerald-200'
                                      : 'bg-[var(--control-fill)] border-[var(--hairline-strong)] text-transparent hover:border-[var(--glass-border-strong)]'
                                  }`}>
                                  {isToggling ? <Loader2 size={12} className="animate-spin text-[var(--text-low)]" /> : <Check size={14} />}
                                </button>
                              ) : (
                                <span className="text-[var(--text-low)]">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {auditLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
              ) : auditError ? (
                <p className="text-sm text-red-300">{auditError}</p>
              ) : !audit || audit.length === 0 ? (
                <p className="text-[13px] text-[var(--text-low)]">Nenhuma mudança de permissão registrada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {audit.map((row) => (
                    <div key={row.id} className="px-4 py-2.5 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                      <p className="text-[12px] text-[var(--text-mid)]">{grantLabel(row)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-[var(--hairline)] shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
