import React, { useEffect, useState } from 'react';
import { Loader2, Target, Users, Pencil, UserPlus, Trash2, Copy, Check, Crown, Trophy, Mail, PauseCircle, PlayCircle, Repeat, BarChart3, ShieldCheck } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';
import { PermissionsModal } from './PermissionsModal';

interface Goal {
  goal: number | null;
  progress: number;
}

interface RankingRow {
  user_id: string;
  name: string;
  is_owner: boolean;
  closed_leads_month: number;
  sales_count_total: number;
  sales_total_cents: number;
}

interface Member {
  user_id: string;
  name: string;
  email: string;
  is_owner: boolean;
  created_at: string;
  suspended_at: string | null;
}

interface DataSummary {
  leads: number;
  properties: number;
  agenda: number;
}

interface Invite {
  id: string;
  code: string;
  url: string;
  created_at: string;
  expires_at: string;
  whatsapp_mode: 'shared' | 'own';
}

interface SlotUpgradeOffer {
  current_limit: number;
  next_limit: number;
  slot_price_display: string;
  next_monthly_value: number;
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  // Escolha do dono, POR CONVITE: esse corretor vai ter WhatsApp próprio
  // (dentro do limite do plano) ou vai compartilhar o número da conta?
  // O convite só é gerado depois da escolha — "própria" pode ser recusada
  // pelo servidor (sem limite no plano, ou limite já atingido).
  const [mode, setMode] = useState<'shared' | 'own' | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [upgradeOffer, setUpgradeOffer] = useState<SlotUpgradeOffer | null>(null);
  const [canUseShared, setCanUseShared] = useState(false);
  const [billingNotice, setBillingNotice] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());

  async function generate(chosenMode: 'shared' | 'own', confirmAddWhatsappSlot = false) {
    setMode(chosenMode);
    setLoading(true);
    setError('');
    setUpgradeOffer(null);
    setCanUseShared(false);
    setBillingNotice('');
    try {
      const r = await fetch('/api/equipe/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          whatsapp_mode: chosenMode,
          request_id: requestId,
          confirm_add_whatsapp_slot: confirmAddWhatsappSlot,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (body?.code === 'WHATSAPP_SLOT_CONFIRMATION_REQUIRED') {
          setUpgradeOffer({
            current_limit: Number(body.current_limit || 0),
            next_limit: Number(body.next_limit || 0),
            slot_price_display: String(body.slot_price_display || '0,00'),
            next_monthly_value: Number(body.next_monthly_value || 0),
          });
          setCanUseShared(body.can_use_shared === true);
          return;
        }
        setCanUseShared(body?.can_use_shared === true);
        throw new Error(body?.error || 'Falha ao gerar convite.');
      }
      setUrl(body.url);
      if (body.slot_added) {
        const monthlyValue = Number(body.monthly_value || 0).toFixed(2).replace('.', ',');
        setBillingNotice(`Vaga adicional liberada. O novo valor mensal será R$ ${monthlyValue} a partir do próximo ciclo.`);
      }
      onCreated();
    } catch (e: any) {
      setError(e.message || 'Falha ao gerar convite.');
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] p-6">
        <h3 className="text-lg font-bold text-[var(--text-hi)] mb-2">Convidar pra equipe</h3>

        {!mode ? (
          <>
            <p className="text-[13px] text-[var(--text-low)] mb-4">Esse corretor vai ter WhatsApp próprio ou vai compartilhar o número da conta?</p>
            <div className="space-y-2">
              <button onClick={() => generate('shared')}
                className="w-full text-left px-4 py-3 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] transition-colors">
                <p className="text-sm font-semibold text-[var(--text-hi)]">Compartilhado</p>
                <p className="text-[12px] text-[var(--text-low)] mt-0.5">Usa o mesmo número já conectado na conta.</p>
              </button>
              <button onClick={() => generate('own')}
                className="w-full text-left px-4 py-3 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] transition-colors">
                <p className="text-sm font-semibold text-[var(--text-hi)]">WhatsApp próprio</p>
                <p className="text-[12px] text-[var(--text-low)] mt-0.5">Ele conecta o próprio número, dentro do limite do seu plano.</p>
              </button>
            </div>
          </>
        ) : loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
        ) : upgradeOffer ? (
          <>
            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
              <p className="text-sm font-bold text-[var(--text-hi)]">Adicionar 1 WhatsApp próprio?</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-low)]">
                Sua cota atual ({upgradeOffer.current_limit} vaga{upgradeOffer.current_limit === 1 ? '' : 's'}) está totalmente usada ou reservada.
                A nova vaga custa <strong className="text-[var(--text-hi)]">R$ {upgradeOffer.slot_price_display}/mês</strong>.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-mid)]">
                Ao confirmar, o limite passará para {upgradeOffer.next_limit}, a vaga será liberada agora e o valor mensal da assinatura passará para <strong>R$ {upgradeOffer.next_monthly_value.toFixed(2).replace('.', ',')}</strong> no próximo ciclo.
              </p>
            </div>
            <button onClick={() => generate('own', true)}
              className="mt-3 w-full rounded-xl border border-blue-400/30 bg-blue-600/80 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-600">
              Confirmar acréscimo e gerar convite
            </button>
            {canUseShared && (
              <button onClick={() => generate('shared')}
                className="mt-2 w-full rounded-xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] px-4 py-2.5 text-sm font-bold text-[var(--text-mid)] transition-colors hover:bg-[var(--control-fill-hover)]">
                Convidar com WhatsApp compartilhado
              </button>
            )}
            <button onClick={() => { setMode(null); setUpgradeOffer(null); }} className="mt-3 text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
              ← Voltar sem alterar o plano
            </button>
          </>
        ) : error ? (
          <>
            <p className="text-sm text-red-300 mb-3">{error}</p>
            {canUseShared && mode === 'own' && (
              <button onClick={() => generate('shared')}
                className="mb-3 w-full rounded-xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] px-4 py-2.5 text-sm font-bold text-[var(--text-mid)] transition-colors hover:bg-[var(--control-fill-hover)]">
                Convidar com WhatsApp compartilhado
              </button>
            )}
            <button onClick={() => setMode(null)} className="text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
              ← Escolher outra opção
            </button>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--text-low)] mb-4">Envie este link pra pessoa — ele vale por 48h e só pode ser usado uma vez.</p>
            {billingNotice && (
              <p className="mb-3 rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-200">
                {billingNotice}
              </p>
            )}
            <div className="flex items-stretch gap-2 mb-2">
              <input readOnly value={url} className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-xs text-[var(--text-mid)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
              <button onClick={copy} className="px-3 rounded-xl bg-violet-500/20 border border-violet-300/30 text-violet-100 hover:bg-violet-500/30 transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </>
        )}

        <button onClick={onClose} className="w-full mt-4 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">
          Fechar
        </button>
      </div>
    </div>
  );
}

function GoalEditor({ current, targetUserId, targetName, onClose, onSaved }: {
  current: number | null;
  targetUserId?: string;
  targetName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(!!targetUserId);
  const [error, setError] = useState('');

  // Meta de OUTRO membro (aberta pelo dono da conta a partir da lista de
  // Equipe): busca o próprio valor em vez de confiar em `current`, que aqui
  // sempre viria null (o pai não tem essa informação carregada).
  useEffect(() => {
    if (!targetUserId) return;
    setLoadingCurrent(true);
    fetch(`/api/equipe/goal?member_user_id=${targetUserId}`, { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.goal) setValue(String(data.goal)); })
      .catch(() => {})
      .finally(() => setLoadingCurrent(false));
  }, [targetUserId]);

  async function handleSave() {
    const n = Number(value);
    if (!n || n <= 0) { setError('Informe um número maior que zero.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/equipe/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(targetUserId ? { deals_goal: n, user_id: targetUserId } : { deals_goal: n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao salvar a meta.');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar a meta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] p-6">
        <h3 className="text-lg font-bold text-[var(--text-hi)] mb-4">{targetName ? `Meta de ${targetName}` : 'Meta de negócios do mês'}</h3>
        {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2 mb-4">{error}</div>}
        {loadingCurrent ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
        ) : (
          <>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Quantos negócios fechar</label>
            <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="5"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors mb-5" />
          </>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || loadingCurrent}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Move posse de leads/imóveis/agenda de um membro pra outro. Chamada tanto
// de forma avulsa (redistribuir carga) quanto sugerida antes de remover
// alguém que ainda tem dados em nome dele.
function ReassignModal({ member, others, onClose, onReassigned }: {
  member: Member;
  others: Member[];
  onClose: () => void;
  onReassigned: () => void;
}) {
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [toUserId, setToUserId] = useState(others[0]?.user_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DataSummary | null>(null);

  useEffect(() => {
    fetch(`/api/equipe/members/${member.user_id}/data-summary`, { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [member.user_id]);

  async function handleReassign() {
    if (!toUserId) { setError('Escolha um destino.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/equipe/members/${member.user_id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ to_user_id: toUserId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao reatribuir.');
      setResult(body.moved);
      onReassigned();
    } catch (e: any) {
      setError(e.message || 'Falha ao reatribuir.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] p-6">
        <h3 className="text-lg font-bold text-[var(--text-hi)] mb-2">Reatribuir dados de {member.name}</h3>
        {loadingSummary ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
        ) : result ? (
          <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 mb-2">
            <p className="text-sm text-emerald-200">
              Movidos: {result.leads} lead{result.leads === 1 ? '' : 's'}, {result.properties} imóve{result.properties === 1 ? 'l' : 'is'}, {result.agenda} evento{result.agenda === 1 ? '' : 's'} de agenda.
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-[var(--text-low)] mb-4">
              {summary ? `${summary.leads} lead(s), ${summary.properties} imóve(is), ${summary.agenda} evento(s) de agenda.` : 'Sem dados pra reatribuir.'}
            </p>
            {others.length === 0 ? (
              <p className="text-sm text-red-300 mb-4">Não há outro membro ativo pra receber esses dados.</p>
            ) : (
              <>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Reatribuir para</label>
                <select value={toUserId} onChange={(e) => setToUserId(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] mb-4">
                  {others.map((o) => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
                </select>
              </>
            )}
            {error && <p className="text-sm text-red-300 mb-3">{error}</p>}
          </>
        )}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && others.length > 0 && (
            <button onClick={handleReassign} disabled={saving || loadingSummary}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} Reatribuir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Equipe real: meta pessoal do mês vs. negócios fechados de verdade
// (leads.closed_at, ver server/routes/leads.ts) + multi-usuário leve (Etapa 9
// revisada) — vários logins acessando a MESMA conta, mesmos dados. O dono da
// conta administra a equipe (convida, remove, suspende, reatribui dados e
// acompanha o desempenho de cada um); um membro comum só vê e edita os
// próprios dados. Ainda não há papéis intermediários entre esses dois.
interface EquipeAreaProps {
  onOpenMemberReport?: (member: { id: string; name: string }) => void;
}

export function EquipeArea({ onOpenMemberReport }: EquipeAreaProps = {}) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [reassigningMember, setReassigningMember] = useState<Member | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<Member | null>(null);
  const [goalEditorTarget, setGoalEditorTarget] = useState<Member | null>(null);
  const [ranking, setRanking] = useState<RankingRow[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/equipe/goal', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar a meta.`);
        }
        return r.json();
      })
      .then(setGoal)
      .catch((e) => setError(e.message || 'Erro ao carregar a meta.'))
      .finally(() => setLoading(false));
  };

  const loadMembers = () => {
    fetch('/api/equipe/members', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar a equipe.`);
        }
        return r.json();
      })
      .then(setMembers)
      .catch((e) => setMembersError(e.message || 'Erro ao carregar a equipe.'));
  };

  useEffect(load, []);
  useEffect(loadMembers, []);

  const myUserId = authService.getUser()?.id;
  const iAmOwner = (members || []).some((m) => m.user_id === myUserId && m.is_owner);

  // Ranking é visão gerencial — só busca depois de saber que sou dono, e só
  // quando tem mais de 1 membro (ranking de 1 pessoa não diz nada).
  useEffect(() => {
    if (!iAmOwner || !members || members.length < 2) return;
    fetch('/api/equipe/ranking', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRanking(data?.ranking || null))
      .catch(() => {});
  }, [iAmOwner, members]);

  const loadInvites = () => {
    if (!iAmOwner) return;
    fetch('/api/equipe/invites', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setInvites(Array.isArray(data) ? data : []))
      .catch(() => setInvites([]));
  };
  useEffect(loadInvites, [iAmOwner]);

  async function handleRevoke(inv: Invite) {
    if (!confirm('Revogar este convite? O link deixa de funcionar imediatamente.')) return;
    setRevokingId(inv.id);
    try {
      const res = await fetch(`/api/equipe/invites/${inv.id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao revogar convite.');
      }
      loadInvites();
    } catch (e: any) {
      alert(e.message || 'Falha ao revogar convite.');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRemove(m: Member) {
    let message = `Remover ${m.name} da equipe? A pessoa perde acesso à conta imediatamente.`;
    try {
      const r = await fetch(`/api/equipe/members/${m.user_id}/data-summary`, { headers: authService.getAuthHeaders() });
      if (r.ok) {
        const s: DataSummary = await r.json();
        if (s.leads + s.properties + s.agenda > 0) {
          message = `${m.name} tem ${s.leads} lead(s), ${s.properties} imóve(is) e ${s.agenda} evento(s) de agenda. Esses dados ficam sem dono depois da remoção (dá pra reatribuir antes, pelo ícone ↻ na lista). Remover mesmo assim?`;
        }
      }
    } catch { /* segue com a mensagem padrão se a contagem falhar */ }
    if (!confirm(message)) return;
    setRemovingId(m.user_id);
    try {
      const res = await fetch(`/api/equipe/members/${m.user_id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao remover membro.');
      }
      loadMembers();
    } catch (e: any) {
      alert(e.message || 'Falha ao remover membro.');
    } finally {
      setRemovingId(null);
    }
  }

  async function handleSuspend(m: Member) {
    if (!confirm(`Suspender ${m.name}? O acesso à conta fica bloqueado até você reativar.`)) return;
    setSuspendingId(m.user_id);
    try {
      const res = await fetch(`/api/equipe/members/${m.user_id}/suspend`, { method: 'PATCH', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao suspender membro.');
      }
      loadMembers();
    } catch (e: any) {
      alert(e.message || 'Falha ao suspender membro.');
    } finally {
      setSuspendingId(null);
    }
  }

  async function handleReactivate(m: Member) {
    setReactivatingId(m.user_id);
    try {
      const res = await fetch(`/api/equipe/members/${m.user_id}/reactivate`, { method: 'PATCH', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao reativar membro.');
      }
      loadMembers();
    } catch (e: any) {
      alert(e.message || 'Falha ao reativar membro.');
    } finally {
      setReactivatingId(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Equipe</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const pct = goal?.goal ? Math.min(100, Math.round((goal.progress / goal.goal) * 100)) : 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Equipe</h2>

      <GlassCard className="!p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-violet-200" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Meta do mês</h3>
          </div>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-[var(--text-mid)]
              bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
            <Pencil className="w-3.5 h-3.5" /> {goal?.goal ? 'Editar' : 'Definir meta'}
          </button>
        </div>

        {goal?.goal ? (
          <>
            <p className="text-3xl font-black text-[var(--text-hi)] leading-none">
              {goal.progress} <span className="text-[var(--text-low)] text-xl">/ {goal.goal} negócios fechados</span>
            </p>
            <div className="w-full h-2 rounded-full bg-[var(--control-fill)] mt-4 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-400 to-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-[14px] text-[var(--text-low)]">Nenhuma meta definida pra este mês ainda.</p>
        )}
      </GlassCard>

      <GlassCard className="!p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--text-low)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Membros da conta</h3>
          </div>
          {iAmOwner && (
            <button onClick={() => setInviting(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-[var(--text-mid)]
                bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
              <UserPlus className="w-3.5 h-3.5" /> Convidar
            </button>
          )}
        </div>

        {membersError ? (
          <p className="text-[13px] text-red-300">{membersError}</p>
        ) : !members ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold text-[var(--text-hi)] truncate">{m.name}</p>
                    {m.is_owner && <span title="Administrador da conta"><Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" /></span>}
                    {m.suspended_at && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-400/15 text-amber-300 border border-amber-300/25 shrink-0">Suspenso</span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--text-low)] truncate">{m.email}</p>
                </div>
                {iAmOwner && !m.is_owner && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onOpenMemberReport?.({ id: m.user_id, name: m.name })} title="Ver desempenho"
                      className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                      <BarChart3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setGoalEditorTarget(m)} title="Meta individual"
                      className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                      <Target className="w-4 h-4" />
                    </button>
                    <button onClick={() => setReassigningMember(m)} title="Reatribuir dados"
                      className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                      <Repeat className="w-4 h-4" />
                    </button>
                    <button onClick={() => setPermissionsTarget(m)} title="Permissões"
                      className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                    {m.suspended_at ? (
                      <button onClick={() => handleReactivate(m)} disabled={reactivatingId === m.user_id} title="Reativar"
                        className="p-2 rounded-xl text-emerald-300/80 hover:text-emerald-300 bg-[var(--control-fill)] hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
                        {reactivatingId === m.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                      </button>
                    ) : (
                      <button onClick={() => handleSuspend(m)} disabled={suspendingId === m.user_id} title="Suspender"
                        className="p-2 rounded-xl text-amber-300/70 hover:text-amber-300 bg-[var(--control-fill)] hover:bg-amber-500/10 transition-colors disabled:opacity-50">
                        {suspendingId === m.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={() => handleRemove(m)} disabled={removingId === m.user_id} title="Remover"
                      className="p-2 rounded-xl text-red-300/70 hover:text-red-300 bg-[var(--control-fill)] hover:bg-red-500/10 transition-colors disabled:opacity-50">
                      {removingId === m.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[var(--text-low)] mt-4 leading-relaxed">
          {iAmOwner
            ? 'Como administrador, você pode ver o desempenho, definir meta, reatribuir dados e suspender ou remover qualquer corretor da equipe.'
            : 'Você vê e edita os próprios dados. Quem administra a conta pode ver seu desempenho e reatribuir seus dados se você sair da equipe.'}
        </p>
      </GlassCard>

      {iAmOwner && invites && invites.length > 0 && (
        <GlassCard className="!p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-[var(--text-low)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Convites pendentes</h3>
          </div>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-hi)] truncate">
                    {inv.whatsapp_mode === 'own' ? 'WhatsApp próprio' : 'Compartilhado'}
                  </p>
                  <p className="text-[12px] text-[var(--text-low)] truncate">
                    Expira em {new Date(inv.expires_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button onClick={() => handleRevoke(inv)} disabled={revokingId === inv.id}
                  className="p-2 rounded-xl text-red-300/70 hover:text-red-300 bg-[var(--control-fill)] hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0">
                  {revokingId === inv.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {iAmOwner && ranking && ranking.length > 0 && (
        <GlassCard className="!p-6 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4 text-amber-300" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Ranking (só você vê)</h3>
          </div>
          <div className="space-y-2">
            {ranking.map((r, i) => (
              <div key={r.user_id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-[var(--control-fill-hover)] border border-[var(--glass-border)] flex items-center justify-center text-[11px] font-bold text-[var(--text-mid)] shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-sm font-semibold text-[var(--text-hi)] truncate">{r.name}{r.is_owner ? ' (você)' : ''}</p>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-[var(--text-low)] shrink-0">
                  <span>{r.closed_leads_month} lead{r.closed_leads_month === 1 ? '' : 's'} fechado{r.closed_leads_month === 1 ? '' : 's'} (mês)</span>
                  <span className="cr-money font-semibold">{centsToReais(r.sales_total_cents)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-low)] mt-4">Vendas somam todo o histórico de Lançamentos; leads fechados são só do mês corrente.</p>
        </GlassCard>
      )}

      {editing && <GoalEditor current={goal?.goal ?? null} onClose={() => setEditing(false)} onSaved={load} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} onCreated={loadInvites} />}
      {goalEditorTarget && (
        <GoalEditor
          current={null}
          targetUserId={goalEditorTarget.user_id}
          targetName={goalEditorTarget.name}
          onClose={() => setGoalEditorTarget(null)}
          onSaved={() => {}}
        />
      )}
      {reassigningMember && (
        <ReassignModal
          member={reassigningMember}
          others={(members || []).filter((m) => m.user_id !== reassigningMember.user_id && !m.suspended_at)}
          onClose={() => setReassigningMember(null)}
          onReassigned={() => {}}
        />
      )}
      {permissionsTarget && (
        <PermissionsModal member={permissionsTarget} onClose={() => setPermissionsTarget(null)} />
      )}
    </div>
  );
}
