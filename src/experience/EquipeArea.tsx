import React, { useEffect, useState } from 'react';
import { Loader2, Target, Users, Pencil, UserPlus, Trash2, Copy, Check, Crown, Trophy, Mail } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

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
}

interface Invite {
  id: string;
  code: string;
  url: string;
  created_at: string;
  expires_at: string;
  whatsapp_mode: 'shared' | 'own';
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

  function generate(chosenMode: 'shared' | 'own') {
    setMode(chosenMode);
    setLoading(true);
    setError('');
    fetch('/api/equipe/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
      body: JSON.stringify({ whatsapp_mode: chosenMode }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || 'Falha ao gerar convite.');
        setUrl(body.url);
        onCreated();
      })
      .catch((e) => setError(e.message || 'Falha ao gerar convite.'))
      .finally(() => setLoading(false));
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
        ) : error ? (
          <>
            <p className="text-sm text-red-300 mb-3">{error}</p>
            <button onClick={() => setMode(null)} className="text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
              ← Escolher outra opção
            </button>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--text-low)] mb-4">Envie este link pra pessoa — ele vale por 48h e só pode ser usado uma vez.</p>
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

function GoalEditor({ current, onClose, onSaved }: { current: number | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(current ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    const n = Number(value);
    if (!n || n <= 0) { setError('Informe um número maior que zero.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/equipe/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ deals_goal: n }),
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
        <h3 className="text-lg font-bold text-[var(--text-hi)] mb-4">Meta de negócios do mês</h3>
        {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2 mb-4">{error}</div>}
        <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Quantos negócios fechar</label>
        <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="5"
          className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
            focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors mb-5" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Equipe real: meta pessoal do mês vs. negócios fechados de verdade
// (leads.closed_at, ver server/routes/leads.ts) + multi-usuário leve (Etapa 9
// revisada) — vários logins acessando a MESMA conta, mesmos dados, mesma
// permissão. Sem hierarquia/papéis/ranking/distribuição de leads ainda —
// isso segue como decisão de produto em aberto.
export function EquipeArea() {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
    if (!confirm(`Remover ${m.name} da equipe? A pessoa perde acesso à conta imediatamente.`)) return;
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
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-[var(--text-hi)] truncate">{m.name}</p>
                    {m.is_owner && <span title="Dono da conta"><Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" /></span>}
                  </div>
                  <p className="text-[12px] text-[var(--text-low)] truncate">{m.email}</p>
                </div>
                {iAmOwner && !m.is_owner && (
                  <button onClick={() => handleRemove(m)} disabled={removingId === m.user_id}
                    className="p-2 rounded-xl text-red-300/70 hover:text-red-300 bg-[var(--control-fill)] hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0">
                    {removingId === m.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[var(--text-low)] mt-4 leading-relaxed">
          Todo membro vê e edita os mesmos dados dele, sem hierarquia nem permissões diferentes ainda — isso é o
          próximo passo, ainda em decisão de produto.
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
                  <span className="text-[var(--text-hi)] font-semibold">{centsToReais(r.sales_total_cents)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-low)] mt-4">Vendas somam todo o histórico de Lançamentos; leads fechados são só do mês corrente.</p>
        </GlassCard>
      )}

      {editing && <GoalEditor current={goal?.goal ?? null} onClose={() => setEditing(false)} onSaved={load} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} onCreated={loadInvites} />}
    </div>
  );
}
