import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Home, TrendingUp, DollarSign, Shield, CheckCircle2,
  XCircle, Clock, ChevronRight, Loader2, RefreshCw, LogOut,
  Building2, X, Search, Ban, Trash2, Zap, Activity, Plus, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from '../services/auth';
import Copyright from '../components/Copyright';

// Painel pesado e usado só quando há incidente — carregado sob demanda.
const AdminHealth = lazy(() => import('../components/AdminHealth'));

interface Broker {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'ativo' | 'pendente' | 'bloqueado';
  plan: string;
  valid_until: string | null;
  created_at: string;
  is_admin: boolean;
  asaas_customer_id: string | null;
  uazapi_instance_id: string | null;
}

interface Metrics {
  totalBrokers: number;
  activeBrokers: number;
  totalProperties: number;
  totalLeads: number;
  totalRevenueCents: number;
}

interface BrokerDetail {
  broker: any;
  properties: any[];
  subscriptions: any[];
}

interface TicketUsage {
  broker_name: string;
  period_start: string;
  period_end: string;
  tickets_used: number;
  tickets_included_base: number;
  tickets_bonus: number;
  tickets_charge_adj: number;
  tickets_included: number;
  overage_price_per_ticket: number;
  adjustments: { id: string; amount: number; type: 'bonus' | 'charge'; reason: string | null; created_at: string }[];
}

const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" /> },
  pendente:  { label: 'Pendente',  cls: 'bg-amber-500/20 border-amber-400/30 text-amber-300',       icon: <Clock className="w-3 h-3" /> },
  bloqueado: { label: 'Bloqueado', cls: 'bg-red-500/20 border-red-400/30 text-red-300',             icon: <XCircle className="w-3 h-3" /> },
};

function fmt(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

const glassCard = 'rounded-2xl backdrop-blur-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.2)]';
const BROKERS_PAGE_SIZE = 100;

export default function Admin() {
  const navigate = useNavigate();
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<BrokerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [ticketUsage, setTicketUsage] = useState<TicketUsage | null>(null);
  const [adjType, setAdjType] = useState<'bonus' | 'charge'>('bonus');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [applyingAdj, setApplyingAdj] = useState(false);
  const [memberLimitInput, setMemberLimitInput] = useState('');
  const [savingMemberLimit, setSavingMemberLimit] = useState(false);
  const [totalBrokers, setTotalBrokers] = useState(0);
  const [view, setView] = useState<'contas' | 'saude'>('contas');
  const [hasMoreBrokers, setHasMoreBrokers] = useState(false);
  const [loadingMoreBrokers, setLoadingMoreBrokers] = useState(false);
  const detailRequestIdRef = useRef(0);

  const headers = authService.getAuthHeaders();

  async function load(append = false) {
    if (append) setLoadingMoreBrokers(true);
    else setLoading(true);
    setError('');
    try {
      const offset = append ? brokers.length : 0;
      const [bRes, mRes] = await Promise.all([
        fetch(`/api/admin/brokers?limit=${BROKERS_PAGE_SIZE}&offset=${offset}`, { headers }),
        fetch('/api/admin/metrics', { headers })
      ]);
      if (bRes.status === 403) { setError('Acesso negado. Você não é administrador.'); return; }
      if (!bRes.ok || !mRes.ok) throw new Error('Erro ao carregar dados');
      const page = await bRes.json();
      setTotalBrokers(Number(bRes.headers.get('X-Total-Count') || 0));
      setHasMoreBrokers(bRes.headers.get('X-Has-More') === 'true');
      setBrokers((current) => {
        if (!append) return Array.isArray(page) ? page : [];
        const byId = new Map(current.map((broker) => [broker.id, broker]));
        for (const broker of Array.isArray(page) ? page : []) byId.set(broker.id, broker);
        return Array.from(byId.values());
      });
      setMetrics(await mRes.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMoreBrokers(false);
    }
  }

  async function updateStatus(id: string, status: Broker['status']) {
    const broker = detail?.broker?.id === id
      ? detail.broker
      : brokers.find((item) => item.id === id);
    const brokerName = broker?.name || 'este corretor';
    const confirmationByStatus: Record<Broker['status'], string> = {
      ativo: `Ativar a conta de "${brokerName}"?`,
      bloqueado: `Bloquear a conta de "${brokerName}"? O acesso será interrompido imediatamente.`,
      pendente: `Desbloquear a conta de "${brokerName}" e retorná-la para pendente?`,
    };
    if (!confirm(confirmationByStatus[status])) return;

    setUpdatingId(id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${id}/status`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao atualizar o status da conta.');
      setBrokers(prev => prev.map(b => b.id === id ? { ...b, status: status as any } : b));
      if (detail?.broker?.id === id) setDetail(d => d ? { ...d, broker: { ...d.broker, status } } : d);
      setActionMsg({ type: 'success', text: 'Status atualizado com sucesso.' });
    } catch (err: any) {
      const message = err?.message || 'Erro ao atualizar o status da conta.';
      setActionMsg({ type: 'error', text: message });
      alert(message);
    } finally {
      setUpdatingId(null);
    }
  }

  const closeDetail = useCallback(() => {
    detailRequestIdRef.current += 1;
    setDetail(null);
    setLoadingDetail(false);
    setActionMsg(null);
  }, []);

  useEffect(() => {
    if (!detail && !loadingDetail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeDetail, detail, loadingDetail]);

  async function openDetail(id: string) {
    const requestId = ++detailRequestIdRef.current;
    setLoadingDetail(true);
    setDetail(null);
    setTicketUsage(null);
    setAdjType('bonus');
    setAdjAmount('');
    setAdjReason('');
    setActionMsg(null);
    try {
      const [dRes, uRes] = await Promise.all([
        fetch(`/api/admin/brokers/${id}`, { headers }),
        fetch(`/api/admin/brokers/${id}/ticket-usage`, { headers })
      ]);
      if (!dRes.ok) throw new Error('Erro ao carregar os detalhes do corretor.');
      const detailData = await dRes.json();
      if (requestId !== detailRequestIdRef.current) return;
      setDetail(detailData);
      setMemberLimitInput(String(detailData?.broker?.member_limit ?? 0));
      if (uRes.ok) setTicketUsage(await uRes.json());
    } catch (err: any) {
      if (requestId !== detailRequestIdRef.current) return;
      setActionMsg({ type: 'error', text: err?.message || 'Erro ao carregar os detalhes do corretor.' });
    } finally {
      if (requestId === detailRequestIdRef.current) setLoadingDetail(false);
    }
  }

  // Quantos corretores da equipe podem ter WhatsApp próprio nessa conta —
  // sem sistema formal de tiers de plano ainda, ajuste manual do admin
  // (mesmo padrão do bônus/cobrança de tickets). Validado em
  // server/routes/equipe.ts::POST /api/equipe/members/invite.
  async function saveMemberLimit(id: string) {
    const value = Number(memberLimitInput);
    if (!Number.isInteger(value) || value < 0) {
      setActionMsg({ type: 'error', text: 'Informe um número inteiro ≥ 0.' });
      return;
    }
    const currentValue = Number(detail?.broker?.member_limit ?? 0);
    if (value === currentValue) {
      setActionMsg({ type: 'success', text: 'O limite já está com esse valor.' });
      return;
    }
    if (!confirm(`Alterar o limite de WhatsApp próprio de ${currentValue} para ${value}?`)) return;
    setSavingMemberLimit(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${id}/member-limit`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_limit: value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar o limite.');
      setDetail(d => d ? { ...d, broker: { ...d.broker, member_limit: value } } : d);
      setActionMsg({ type: 'success', text: 'Limite atualizado.' });
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message });
    } finally {
      setSavingMemberLimit(false);
    }
  }

  async function applyAdjustment(brokerId: string) {
    const amount = parseInt(adjAmount, 10);
    if (!adjAmount || isNaN(amount) || amount === 0) {
      setActionMsg({ type: 'error', text: 'Informe um valor diferente de zero.' });
      return;
    }
    const adjustmentName = adjType === 'bonus' ? 'bônus' : 'cobrança';
    const adjustmentAction = amount > 0 ? 'Aplicar' : 'Estornar';
    if (!confirm(`${adjustmentAction} ${Math.abs(amount)} atendimento(s) como ${adjustmentName}?`)) return;
    setApplyingAdj(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${brokerId}/ticket-adjustment`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, type: adjType, reason: adjReason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao aplicar ajuste');
      setActionMsg({ type: 'success', text: `Ajuste de ${amount > 0 ? '+' : ''}${amount} aplicado com sucesso.` });
      setAdjAmount('');
      setAdjReason('');
      // Recarrega o uso de tickets
      const uRes = await fetch(`/api/admin/brokers/${brokerId}/ticket-usage`, { headers });
      if (uRes.ok) setTicketUsage(await uRes.json());
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message });
    } finally {
      setApplyingAdj(false);
    }
  }

  async function provisionTenant(id: string) {
    const brokerName = detail?.broker?.name || 'este corretor';
    if (!confirm(`Provisionar uma nova instância de WhatsApp para "${brokerName}"?`)) return;
    setUpdatingId(id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${id}/provision`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao provisionar');
      setActionMsg({ type: 'success', text: 'Provisionamento disparado! Aguarde ~30s e recarregue os detalhes.' });
      setTimeout(() => openDetail(id), 30000);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingId(null);
    }
  }

  async function cancelPlan(id: string) {
    if (!confirm('Cancelar o plano deste corretor?\n\nEle manterá acesso até o fim do período pago e depois perderá o acesso automaticamente.')) return;
    setUpdatingId(id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${id}/cancel-plan`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar plano');
      setActionMsg({ type: 'success', text: 'Plano cancelado. Acesso mantido até o fim do período pago.' });
      // Atualiza status local
      setBrokers(prev => prev.map(b => b.id === id ? { ...b, status: 'bloqueado' as any } : b));
      if (detail?.broker?.id === id) setDetail(d => d ? { ...d, broker: { ...d.broker, status: 'cancelado' } } : d);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteAccount(id: string, name: string) {
    if (!confirm(`Tem certeza que deseja EXCLUIR a conta de "${name}"?\n\nEssa ação não poderá ser desfeita. A assinatura será cancelada e o acesso encerrado imediatamente.`)) return;
    setUpdatingId(id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/brokers/${id}`, {
        method: 'DELETE',
        headers
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir conta');
      setActionMsg({ type: 'success', text: 'Conta excluída com sucesso.' });
      setBrokers(prev => prev.filter(b => b.id !== id));
      setTotalBrokers((current) => Math.max(0, current - 1));
      setDetail(null);
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err.message });
    } finally {
      setUpdatingId(null);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = brokers.filter(b =>
    (b.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.phone || '').includes(search)
  );

  if (error) return (
    <div className="min-h-screen app-bg flex items-center justify-center">
      <div className="text-center">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-[var(--text-mid)] font-semibold">{error}</p>
        <button onClick={() => navigate('/app')} className="mt-4 text-sm text-[var(--text-low)] hover:text-[var(--text-hi)] transition-colors">
          Voltar
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen app-bg font-sans relative">
      {/* Noise */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[var(--control-fill)] border-b border-[var(--hairline)] px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 shadow-[0_1px_0_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center backdrop-blur-md bg-amber-500/20 border border-amber-400/30">
            <Shield className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h1 className="text-base font-black text-[var(--text-hi)]">Painel Admin</h1>
            <p className="text-[10px] text-[var(--text-low)]">ImobiFlow</p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button type="button" aria-label="Atualizar painel" title="Atualizar" onClick={() => load()} className="flex items-center gap-1.5 text-xs text-[var(--text-low)] hover:text-[var(--text-hi)] transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[var(--control-fill-hover)]">
            <RefreshCw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Atualizar</span>
          </button>
          <button type="button" aria-label="Voltar ao app" title="Voltar ao app" onClick={() => navigate('/app')} className="flex items-center gap-1.5 text-xs text-[var(--text-low)] hover:text-[var(--text-hi)] transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-[var(--control-fill-hover)]">
            <Home className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Voltar ao app</span>
          </button>
          <button type="button" aria-label="Sair da conta" title="Sair" onClick={() => authService.logout()} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-red-500/10">
            <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-8">
        {/* Duas visões: as CONTAS (assinatura, cobrança) e a SAÚDE do sistema
            (filas, WhatsApp por corretor, intervenção manual em incidente). */}
        <div className="flex gap-1 p-1 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] w-fit mb-6">
          {([['contas', 'Contas'], ['saude', 'Saúde do sistema']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                view === key ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)]' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'saude' ? (
          <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="animate-spin w-6 h-6 text-[var(--text-low)]" /></div>}>
            <AdminHealth />
          </Suspense>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin w-6 h-6 text-[var(--text-low)]" />
          </div>
        ) : (
          <>
            {/* Métricas */}
            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                {[
                  { label: 'Corretores',  value: metrics.totalBrokers,     icon: <Users className="w-4 h-4 text-blue-300" />,    bg: 'bg-blue-500/20 border-blue-400/30' },
                  { label: 'Ativos',      value: metrics.activeBrokers,    icon: <CheckCircle2 className="w-4 h-4 text-emerald-300" />, bg: 'bg-emerald-500/20 border-emerald-400/30' },
                  { label: 'Imóveis',     value: metrics.totalProperties,  icon: <Building2 className="w-4 h-4 text-violet-300" />, bg: 'bg-violet-500/20 border-violet-400/30' },
                  { label: 'Leads',       value: metrics.totalLeads,       icon: <TrendingUp className="w-4 h-4 text-orange-300" />, bg: 'bg-orange-500/20 border-orange-400/30' },
                  { label: 'Receita',     value: fmt(metrics.totalRevenueCents), icon: <DollarSign className="w-4 h-4 text-green-300" />, bg: 'bg-green-500/20 border-green-400/30' },
                ].map(m => (
                  <div key={m.label} className={`${glassCard} p-4`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 border ${m.bg}`}>
                      {m.icon}
                    </div>
                    <p className="text-xl font-black text-[var(--text-hi)]">{m.value}</p>
                    <p className="text-[11px] text-[var(--text-low)]">{m.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Busca */}
            <div className="mb-4 relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-low)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, email ou telefone..."
                className="w-full pl-9 pr-4 py-2.5 rounded-2xl text-sm text-[var(--text-hi)] placeholder:text-[var(--text-low)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] focus:ring-2 focus:ring-white/25 outline-none"
              />
            </div>

            {/* Tabela */}
            <div className={`${glassCard} overflow-hidden`}>
              <div className="px-6 py-4 border-b border-[var(--hairline)] flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--text-hi)]">
                  Corretores <span className="text-[var(--text-low)] font-normal">({filtered.length}{totalBrokers > brokers.length ? ` de ${totalBrokers}` : ''})</span>
                </h2>
              </div>

              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-[var(--text-low)]">Nenhum corretor encontrado</div>
              ) : (
                <div className="divide-y divide-[var(--hairline)]">
                  {filtered.map(broker => {
                    const s = STATUS[broker.status] || STATUS.pendente;
                    return (
                      <div key={broker.id} className="px-6 py-4 flex items-center gap-4 hover:bg-[var(--control-fill)] transition-colors">
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--control-fill-hover)] border border-[var(--glass-border)]">
                          <span className="text-sm font-bold text-[var(--text-mid)]">
                            {(broker.name || '?')[0].toUpperCase()}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[var(--text-hi)] truncate">{broker.name || '—'}</p>
                            {broker.is_admin && (
                              <span className="text-[10px] bg-amber-500/20 border border-amber-400/30 text-amber-300 px-1.5 py-0.5 rounded-full">admin</span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--text-low)] truncate">{broker.email || broker.phone || '—'}</p>
                        </div>

                        {/* Status badge */}
                        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${s.cls}`}>
                          {s.icon} {s.label}
                        </span>

                        {/* Validade */}
                        <span className="text-xs text-[var(--text-low)] shrink-0 hidden md:block w-24 text-right">
                          {broker.valid_until ? `até ${fmtDate(broker.valid_until)}` : 'sem plano'}
                        </span>

                        {/* Ações */}
                        <div className="flex items-center gap-1 shrink-0">
                          {!broker.is_admin && broker.status !== 'ativo' && (
                            <button onClick={() => updateStatus(broker.id, 'ativo')} disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 rounded-full hover:bg-emerald-500/30 transition-colors disabled:opacity-40">
                              Ativar
                            </button>
                          )}
                          {!broker.is_admin && broker.status === 'ativo' && (
                            <button onClick={() => updateStatus(broker.id, 'bloqueado')} disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-red-500/20 border border-red-400/30 text-red-300 rounded-full hover:bg-red-500/30 transition-colors disabled:opacity-40">
                              Bloquear
                            </button>
                          )}
                          {!broker.is_admin && broker.status === 'bloqueado' && (
                            <button onClick={() => updateStatus(broker.id, 'pendente')} disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-amber-500/20 border border-amber-400/30 text-amber-300 rounded-full hover:bg-amber-500/30 transition-colors disabled:opacity-40">
                              Desbloquear
                            </button>
                          )}
                          <button type="button" aria-label={`Abrir detalhes de ${broker.name}`} title={`Abrir detalhes de ${broker.name}`} onClick={() => openDetail(broker.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-all">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {hasMoreBrokers && (
                <div className="px-6 py-4 border-t border-[var(--hairline)] flex justify-center">
                  <button
                    onClick={() => load(true)}
                    disabled={loadingMoreBrokers}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-[var(--text-mid)]
                      bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50"
                  >
                    {loadingMoreBrokers && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Carregar mais corretores
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        <Copyright className="mt-10 pb-4" />
      </div>

      {/* Drawer de detalhes */}
      <AnimatePresence>
        {(detail || loadingDetail) && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              aria-hidden="true"
              onClick={closeDetail}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-broker-detail-title"
              className="fixed right-0 top-0 h-full w-full max-w-md z-50 overflow-y-auto
                backdrop-blur-2xl bg-slate-900/95 border-l border-[var(--hairline-strong)]
                shadow-[-8px_0_32px_rgba(0,0,0,0.5)]"
            >
              <div className="px-6 py-5 border-b border-[var(--hairline)] flex items-center justify-between sticky top-0 backdrop-blur-xl bg-[var(--control-fill)]">
                <h3 id="admin-broker-detail-title" className="text-sm font-bold text-[var(--text-hi)]">Detalhes do Corretor</h3>
                <button type="button" aria-label="Fechar detalhes do corretor" title="Fechar" onClick={closeDetail}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" />
                </div>
              ) : detail && (
                <div className="px-6 py-5 space-y-6">
                  {/* Info básica */}
                  <div className={`${glassCard} p-4 space-y-1`}>
                    <h4 className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest mb-3">Informações</h4>
                    {[
                      ['Nome', detail.broker.name],
                      ['Email', detail.broker.email],
                      ['Telefone', detail.broker.phone],
                      ['Status', detail.broker.status],
                      ['Plano', detail.broker.plan || '—'],
                      ['Válido até', fmtDate(detail.broker.valid_until)],
                      ['Cadastro', fmtDate(detail.broker.created_at)],
                      ['Asaas ID', detail.broker.asaas_customer_id || '—'],
                      ['Instância WhatsApp', detail.broker.uazapi_instance_id || '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-1.5 border-b border-[var(--hairline)] last:border-0">
                        <span className="text-[var(--text-low)]">{k}</span>
                        <span className="text-[var(--text-hi)] font-medium text-right max-w-[60%] truncate">{v || '—'}</span>
                      </div>
                    ))}
                  </div>

                  {/* Atendimentos — ajuste manual */}
                  {ticketUsage && (() => {
                    const { tickets_used, tickets_included, tickets_included_base, tickets_bonus, tickets_charge_adj, overage_price_per_ticket, adjustments, period_start, period_end } = ticketUsage;
                    const pct = Math.min(100, Math.round((tickets_used / tickets_included) * 100));
                    const isOver = tickets_used > tickets_included;
                    const isWarn = !isOver && pct >= 80;
                    const barColor = isOver ? 'bg-red-400' : isWarn ? 'bg-amber-400' : 'bg-violet-400';
                    const fmtPeriod = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                    const parsedAmt = parseInt(adjAmount || '0', 10);

                    return (
                      <div className={`${glassCard} p-4 space-y-4`}>
                        <h4 className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest flex items-center gap-1.5">
                          <Activity className="w-3 h-3" /> Atendimentos
                        </h4>

                        {/* Barra de progresso */}
                        <div>
                          <div className="flex items-end justify-between mb-1.5">
                            <span className={`text-2xl font-extrabold ${isOver ? 'text-red-300' : isWarn ? 'text-amber-300' : 'text-[var(--text-hi)]'}`}>
                              {tickets_used}
                            </span>
                            <span className="text-xs text-[var(--text-low)]">/ {tickets_included} inclusos</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-[var(--control-fill-hover)] overflow-hidden mb-1">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-[var(--text-low)]">
                            <span>{fmtPeriod(period_start)} – {fmtPeriod(period_end)}</span>
                            <span>{pct}% usado</span>
                          </div>
                          {tickets_bonus > 0 && (
                            <p className="text-[10px] text-emerald-400/70 mt-1">
                              Base {tickets_included_base} + bônus {tickets_bonus} = {tickets_included} inclusos
                            </p>
                          )}
                          {tickets_charge_adj > 0 && (
                            <p className="text-[10px] text-orange-400/70 mt-0.5">
                              Cobrança manual: {tickets_charge_adj} atend. = R$ {(tickets_charge_adj * overage_price_per_ticket).toFixed(2)} já lançados no excedente
                            </p>
                          )}
                        </div>

                        {/* Seletor de tipo */}
                        <div className="flex gap-1 p-1 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                          <button
                            onClick={() => { setAdjType('bonus'); setAdjAmount(''); }}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${adjType === 'bonus' ? 'bg-emerald-500/25 border border-emerald-400/40 text-emerald-300' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]'}`}
                          >
                            Bônus
                          </button>
                          <button
                            onClick={() => { setAdjType('charge'); setAdjAmount(''); }}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${adjType === 'charge' ? 'bg-orange-500/25 border border-orange-400/40 text-orange-300' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]'}`}
                          >
                            Cobrança
                          </button>
                        </div>

                        {/* Descrição do tipo selecionado */}
                        <p className="text-[10px] text-[var(--text-low)] -mt-2">
                          {adjType === 'bonus'
                            ? `Positivo: concede atendimentos grátis. Negativo: estorna bônus indevido (máx. ${tickets_bonus > 0 ? tickets_bonus : 0} disponível). Os ${tickets_included_base} do plano são intocáveis.`
                            : `Positivo: cobra atendimentos extras. Negativo: estorna cobrança indevida (máx. ${tickets_charge_adj > 0 ? tickets_charge_adj : 0} disponível).`}
                        </p>

                        {/* Input de quantidade */}
                        <div className="space-y-2">
                          <div className="flex items-center rounded-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] overflow-hidden">
                            <button
                              onClick={() => setAdjAmount(v => String((parseInt(v || '0', 10)) - 1))}
                              className="px-3 py-2 text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors"
                            ><Minus className="w-3.5 h-3.5" /></button>
                            <input
                              type="number"
                              value={adjAmount}
                              onChange={e => setAdjAmount(e.target.value)}
                              placeholder="0"
                              className="flex-1 bg-transparent text-center text-sm text-[var(--text-hi)] outline-none py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onClick={() => setAdjAmount(v => String((parseInt(v || '0', 10)) + 1))}
                              className="px-3 py-2 text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors"
                            ><Plus className="w-3.5 h-3.5" /></button>
                          </div>

                          {/* Preview do efeito */}
                          {/* Bônus positivo */}
                          {adjAmount && parsedAmt > 0 && adjType === 'bonus' && (
                            <p className="text-[10px] text-emerald-400/80">
                              Limite passa de {tickets_included} → {tickets_included + parsedAmt} atendimentos inclusos (grátis).
                            </p>
                          )}
                          {/* Bônus negativo — estorno válido */}
                          {adjAmount && parsedAmt < 0 && adjType === 'bonus' && tickets_bonus > 0 && (tickets_bonus + parsedAmt) >= 0 && (
                            <p className="text-[10px] text-amber-400/80">
                              Estorna {Math.abs(parsedAmt)} de bônus. Limite volta de {tickets_included} → {tickets_included + parsedAmt}. Bônus restante: {tickets_bonus + parsedAmt}.
                            </p>
                          )}
                          {/* Bônus negativo — excede o concedido */}
                          {adjAmount && parsedAmt < 0 && adjType === 'bonus' && (tickets_bonus === 0 || (tickets_bonus + parsedAmt) < 0) && (
                            <p className="text-[10px] text-red-400/90 font-semibold">
                              {tickets_bonus === 0
                                ? 'Nenhum bônus concedido neste período. Não há o que estornar.'
                                : `Bônus concedido: +${tickets_bonus}. Estorno máximo: ${tickets_bonus}. Os ${tickets_included_base} do plano são intocáveis.`}
                            </p>
                          )}
                          {/* Cobrança positiva */}
                          {adjAmount && parsedAmt > 0 && adjType === 'charge' && (
                            <p className="text-[10px] text-orange-400/80">
                              {parsedAmt} × R$ {overage_price_per_ticket.toFixed(2)} = <strong>R$ {(parsedAmt * overage_price_per_ticket).toFixed(2)}</strong> adicionado ao excedente da próxima renovação.
                            </p>
                          )}
                          {/* Cobrança negativa — estorno válido */}
                          {adjAmount && parsedAmt < 0 && adjType === 'charge' && tickets_charge_adj > 0 && (tickets_charge_adj + parsedAmt) >= 0 && (
                            <p className="text-[10px] text-amber-400/80">
                              Estorna {Math.abs(parsedAmt)} de cobrança. Reduz excedente em R$ {(Math.abs(parsedAmt) * overage_price_per_ticket).toFixed(2)}. Cobrança restante: {tickets_charge_adj + parsedAmt}.
                            </p>
                          )}
                          {/* Cobrança negativa — excede o cobrado */}
                          {adjAmount && parsedAmt < 0 && adjType === 'charge' && (tickets_charge_adj === 0 || (tickets_charge_adj + parsedAmt) < 0) && (
                            <p className="text-[10px] text-red-400/90 font-semibold">
                              {tickets_charge_adj === 0
                                ? 'Nenhuma cobrança manual aplicada neste período. Não há o que estornar.'
                                : `Cobrança aplicada: +${tickets_charge_adj}. Estorno máximo: ${tickets_charge_adj}.`}
                            </p>
                          )}

                          <input
                            type="text"
                            value={adjReason}
                            onChange={e => setAdjReason(e.target.value)}
                            placeholder="Motivo (opcional)"
                            maxLength={200}
                            className="w-full px-3 py-2 rounded-xl text-sm text-[var(--text-hi)] placeholder:text-[var(--text-low)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] outline-none focus:ring-1 focus:ring-white/25"
                          />

                          <button
                            onClick={() => applyAdjustment(detail!.broker.id)}
                            disabled={
                              applyingAdj || !adjAmount || parsedAmt === 0 ||
                              (parsedAmt < 0 && adjType === 'bonus'  && (tickets_bonus  + parsedAmt) < 0) ||
                              (parsedAmt < 0 && adjType === 'charge' && (tickets_charge_adj + parsedAmt) < 0)
                            }
                            className={`w-full py-2 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-40 ${
                              adjType === 'bonus'
                                ? 'bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-orange-500/20 border border-orange-400/30 text-orange-300 hover:bg-orange-500/30'
                            }`}
                          >
                            {applyingAdj ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                            {adjType === 'bonus' ? 'Aplicar bônus' : 'Aplicar cobrança'}
                          </button>
                        </div>

                        {/* Histórico de ajustes */}
                        {adjustments.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-[var(--text-low)] mb-2">Histórico</p>
                            <div className="space-y-1">
                              {adjustments.map((a: any) => (
                                <div key={a.id} className="flex items-center gap-2 bg-[var(--control-fill)] border border-[var(--hairline)] rounded-lg px-2.5 py-1.5 text-[11px]">
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${a.type === 'bonus' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-orange-500/20 text-orange-300'}`}>
                                    {a.type === 'bonus' ? 'bônus' : 'cobr.'}
                                  </span>
                                  <span className={`font-bold shrink-0 ${a.amount > 0 ? 'text-[var(--text-mid)]' : 'text-red-300'}`}>
                                    {a.amount > 0 ? '+' : ''}{a.amount}
                                  </span>
                                  <span className="text-[var(--text-low)] flex-1 truncate">{a.reason || '—'}</span>
                                  <span className="text-[var(--text-low)] shrink-0">{new Date(a.created_at).toLocaleDateString('pt-BR')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Mensagem de ação */}
                  {actionMsg && (
                    <div className={`flex items-center gap-2 p-3 rounded-2xl text-xs font-medium border ${
                      actionMsg.type === 'success'
                        ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                        : 'bg-red-500/20 border-red-400/30 text-red-300'
                    }`}>
                      {actionMsg.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                      {actionMsg.text}
                    </div>
                  )}

                  {/* Ações de status */}
                  {!detail.broker.is_admin && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        {detail.broker.status !== 'ativo' && (
                          <button onClick={() => updateStatus(detail.broker.id, 'ativo')} disabled={updatingId === detail.broker.id}
                            className="flex-1 py-2.5 text-sm font-semibold rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-40">
                            Ativar conta
                          </button>
                        )}
                        {detail.broker.status === 'ativo' && (
                          <button onClick={() => updateStatus(detail.broker.id, 'bloqueado')} disabled={updatingId === detail.broker.id}
                            className="flex-1 py-2.5 text-sm font-semibold rounded-2xl bg-amber-500/20 border border-amber-400/30 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-40">
                            Bloquear conta
                          </button>
                        )}
                        {detail.broker.status === 'bloqueado' && (
                          <button onClick={() => updateStatus(detail.broker.id, 'pendente')} disabled={updatingId === detail.broker.id}
                            className="flex-1 py-2.5 text-sm font-semibold rounded-2xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] text-[var(--text-mid)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-40">
                            Desbloquear
                          </button>
                        )}
                      </div>

                      {/* Limite de WhatsApp próprio por membro da equipe */}
                      <div className={`${glassCard} p-4`}>
                        <h4 className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest mb-2">
                          WhatsApp próprio por corretor
                        </h4>
                        <p className="text-[12px] text-[var(--text-low)] mb-3">
                          Quantos corretores da equipe podem ter instância própria (em vez de compartilhar a da conta).
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={0}
                            value={memberLimitInput}
                            onChange={(e) => setMemberLimitInput(e.target.value)}
                            className="w-24 py-2 px-3 text-sm rounded-xl bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] text-center"
                          />
                          <button
                            onClick={() => saveMemberLimit(detail.broker.id)}
                            disabled={savingMemberLimit}
                            className="flex-1 py-2 text-sm font-semibold rounded-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-40"
                          >
                            {savingMemberLimit ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Salvar limite'}
                          </button>
                        </div>
                      </div>

                      {/* Provisionar WhatsApp */}
                      {!detail.broker.uazapi_instance_id && (
                        <button
                          onClick={() => provisionTenant(detail.broker.id)}
                          disabled={updatingId === detail.broker.id}
                          className="w-full py-2.5 text-sm font-semibold rounded-2xl flex items-center justify-center gap-2
                            bg-violet-500/20 border border-violet-400/30 text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                        >
                          {updatingId === detail.broker.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                          Provisionar WhatsApp
                        </button>
                      )}

                      {/* Cancelar plano */}
                      {detail.broker.asaas_customer_id && (
                        <button
                          onClick={() => cancelPlan(detail.broker.id)}
                          disabled={updatingId === detail.broker.id}
                          className="w-full py-2.5 text-sm font-semibold rounded-2xl flex items-center justify-center gap-2
                            bg-orange-500/20 border border-orange-400/30 text-orange-300 hover:bg-orange-500/30 transition-colors disabled:opacity-40"
                        >
                          {updatingId === detail.broker.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                          Cancelar Plano
                        </button>
                      )}

                      {/* Excluir conta */}
                      <button
                        onClick={() => deleteAccount(detail.broker.id, detail.broker.name)}
                        disabled={updatingId === detail.broker.id}
                        className="w-full py-2.5 text-sm font-semibold rounded-2xl flex items-center justify-center gap-2
                          bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40"
                      >
                        {updatingId === detail.broker.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Excluir Conta
                      </button>
                    </div>
                  )}

                  {/* Imóveis */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest mb-3">
                      Imóveis ({detail.properties.length})
                    </h4>
                    {detail.properties.length === 0 ? (
                      <p className="text-xs text-[var(--text-low)]">Nenhum imóvel cadastrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.properties.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between bg-[var(--control-fill)] border border-[var(--hairline)] rounded-xl px-3 py-2">
                            <span className="text-xs text-[var(--text-mid)] truncate">{p.title}</span>
                            <span className="text-[10px] text-[var(--text-low)] shrink-0 ml-2">{fmtDate(p.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pagamentos */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest mb-3">
                      Pagamentos ({detail.subscriptions.length})
                    </h4>
                    {detail.subscriptions.length === 0 ? (
                      <p className="text-xs text-[var(--text-low)]">Nenhum pagamento registrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.subscriptions.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between bg-[var(--control-fill)] border border-[var(--hairline)] rounded-xl px-3 py-2">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text-hi)]">{fmt(s.amount)}</p>
                              <p className="text-[10px] text-[var(--text-low)]">{s.asaas_payment_id || s.stripe_session_id || '—'}</p>
                            </div>
                            <span className="text-[10px] text-[var(--text-low)]">{fmtDate(s.paid_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
