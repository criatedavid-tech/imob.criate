import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Home, TrendingUp, DollarSign, Shield, CheckCircle2,
  XCircle, Clock, ChevronRight, Loader2, RefreshCw, LogOut,
  Building2, X, Search, Ban, Trash2, Zap, Activity, Plus, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from '../services/auth';
import Copyright from '../components/Copyright';

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
  zpro_tenant_id: string | null;
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

const glassCard = 'rounded-2xl backdrop-blur-xl bg-white/10 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.2)]';

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

  const headers = authService.getAuthHeaders();

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [bRes, mRes] = await Promise.all([
        fetch('/api/admin/brokers', { headers }),
        fetch('/api/admin/metrics', { headers })
      ]);
      if (bRes.status === 403) { setError('Acesso negado. Você não é administrador.'); return; }
      if (!bRes.ok || !mRes.ok) throw new Error('Erro ao carregar dados');
      setBrokers(await bRes.json());
      setMetrics(await mRes.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id);
    try {
      await fetch(`/api/admin/brokers/${id}/status`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setBrokers(prev => prev.map(b => b.id === id ? { ...b, status: status as any } : b));
      if (detail?.broker?.id === id) setDetail(d => d ? { ...d, broker: { ...d.broker, status } } : d);
    } finally {
      setUpdatingId(null);
    }
  }

  async function openDetail(id: string) {
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
      setDetail(await dRes.json());
      if (uRes.ok) setTicketUsage(await uRes.json());
    } finally {
      setLoadingDetail(false);
    }
  }

  async function applyAdjustment(brokerId: string) {
    const amount = parseInt(adjAmount, 10);
    if (!adjAmount || isNaN(amount) || amount === 0) {
      setActionMsg({ type: 'error', text: 'Informe um valor diferente de zero.' });
      return;
    }
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex items-center justify-center">
      <div className="text-center">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-white/70 font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-white/40 hover:text-white transition-colors">
          Voltar ao Dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 font-sans relative">
      {/* Noise */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-white/8 border-b border-white/10 px-6 py-4 flex items-center justify-between shadow-[0_1px_0_rgba(255,255,255,0.08),0_4px_16px_rgba(0,0,0,0.2)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center backdrop-blur-md bg-amber-500/20 border border-amber-400/30">
            <Shield className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h1 className="text-base font-black text-white">Painel Admin</h1>
            <p className="text-[10px] text-white/30">ImobiFlow</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
            <Home className="w-3.5 h-3.5" /> Dashboard
          </button>
          <button onClick={() => authService.logout()} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin w-6 h-6 text-white/30" />
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
                    <p className="text-xl font-black text-white">{m.value}</p>
                    <p className="text-[11px] text-white/40">{m.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Busca */}
            <div className="mb-4 relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, email ou telefone..."
                className="w-full pl-9 pr-4 py-2.5 rounded-2xl text-sm text-white placeholder:text-white/30 bg-white/10 border border-white/15 focus:ring-2 focus:ring-white/25 outline-none"
              />
            </div>

            {/* Tabela */}
            <div className={`${glassCard} overflow-hidden`}>
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">Corretores <span className="text-white/40 font-normal">({filtered.length})</span></h2>
              </div>

              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-white/30">Nenhum corretor encontrado</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {filtered.map(broker => {
                    const s = STATUS[broker.status] || STATUS.pendente;
                    return (
                      <div key={broker.id} className="px-6 py-4 flex items-center gap-4 hover:bg-white/5 transition-colors">
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-white/10 border border-white/15">
                          <span className="text-sm font-bold text-white/70">
                            {(broker.name || '?')[0].toUpperCase()}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white truncate">{broker.name || '—'}</p>
                            {broker.is_admin && (
                              <span className="text-[10px] bg-amber-500/20 border border-amber-400/30 text-amber-300 px-1.5 py-0.5 rounded-full">admin</span>
                            )}
                          </div>
                          <p className="text-xs text-white/40 truncate">{broker.email || broker.phone || '—'}</p>
                        </div>

                        {/* Status badge */}
                        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${s.cls}`}>
                          {s.icon} {s.label}
                        </span>

                        {/* Validade */}
                        <span className="text-xs text-white/30 shrink-0 hidden md:block w-24 text-right">
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
                          <button onClick={() => openDetail(broker.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-full text-white/30 hover:bg-white/10 hover:text-white transition-all">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
              onClick={() => setDetail(null)}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full max-w-md z-50 overflow-y-auto
                backdrop-blur-2xl bg-slate-900/95 border-l border-white/12
                shadow-[-8px_0_32px_rgba(0,0,0,0.5)]"
            >
              <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between sticky top-0 backdrop-blur-xl bg-white/5">
                <h3 className="text-sm font-bold text-white">Detalhes do Corretor</h3>
                <button onClick={() => setDetail(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="animate-spin w-5 h-5 text-white/30" />
                </div>
              ) : detail && (
                <div className="px-6 py-5 space-y-6">
                  {/* Info básica */}
                  <div className={`${glassCard} p-4 space-y-1`}>
                    <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Informações</h4>
                    {[
                      ['Nome', detail.broker.name],
                      ['Email', detail.broker.email],
                      ['Telefone', detail.broker.phone],
                      ['Status', detail.broker.status],
                      ['Plano', detail.broker.plan || '—'],
                      ['Válido até', fmtDate(detail.broker.valid_until)],
                      ['Cadastro', fmtDate(detail.broker.created_at)],
                      ['Asaas ID', detail.broker.asaas_customer_id || '—'],
                      ['Z-PRO Tenant', detail.broker.zpro_tenant_id || '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-1.5 border-b border-white/5 last:border-0">
                        <span className="text-white/40">{k}</span>
                        <span className="text-white/80 font-medium text-right max-w-[60%] truncate">{v || '—'}</span>
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
                        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-widest flex items-center gap-1.5">
                          <Activity className="w-3 h-3" /> Atendimentos
                        </h4>

                        {/* Barra de progresso */}
                        <div>
                          <div className="flex items-end justify-between mb-1.5">
                            <span className={`text-2xl font-extrabold ${isOver ? 'text-red-300' : isWarn ? 'text-amber-300' : 'text-white'}`}>
                              {tickets_used}
                            </span>
                            <span className="text-xs text-white/40">/ {tickets_included} inclusos</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mb-1">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-white/30">
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
                        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                          <button
                            onClick={() => { setAdjType('bonus'); setAdjAmount(''); }}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${adjType === 'bonus' ? 'bg-emerald-500/25 border border-emerald-400/40 text-emerald-300' : 'text-white/30 hover:text-white/60'}`}
                          >
                            Bônus
                          </button>
                          <button
                            onClick={() => { setAdjType('charge'); setAdjAmount(''); }}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${adjType === 'charge' ? 'bg-orange-500/25 border border-orange-400/40 text-orange-300' : 'text-white/30 hover:text-white/60'}`}
                          >
                            Cobrança
                          </button>
                        </div>

                        {/* Descrição do tipo selecionado */}
                        <p className="text-[10px] text-white/30 -mt-2">
                          {adjType === 'bonus'
                            ? `Positivo: concede atendimentos grátis. Negativo: estorna bônus indevido (máx. ${tickets_bonus > 0 ? tickets_bonus : 0} disponível). Os ${tickets_included_base} do plano são intocáveis.`
                            : `Positivo: cobra atendimentos extras. Negativo: estorna cobrança indevida (máx. ${tickets_charge_adj > 0 ? tickets_charge_adj : 0} disponível).`}
                        </p>

                        {/* Input de quantidade */}
                        <div className="space-y-2">
                          <div className="flex items-center rounded-xl bg-white/10 border border-white/15 overflow-hidden">
                            <button
                              onClick={() => setAdjAmount(v => String((parseInt(v || '0', 10)) - 1))}
                              className="px-3 py-2 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                            ><Minus className="w-3.5 h-3.5" /></button>
                            <input
                              type="number"
                              value={adjAmount}
                              onChange={e => setAdjAmount(e.target.value)}
                              placeholder="0"
                              className="flex-1 bg-transparent text-center text-sm text-white outline-none py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onClick={() => setAdjAmount(v => String((parseInt(v || '0', 10)) + 1))}
                              className="px-3 py-2 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
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
                            className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder:text-white/30 bg-white/10 border border-white/15 outline-none focus:ring-1 focus:ring-white/25"
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
                            <p className="text-[10px] font-semibold text-white/30 mb-2">Histórico</p>
                            <div className="space-y-1">
                              {adjustments.map((a: any) => (
                                <div key={a.id} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px]">
                                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${a.type === 'bonus' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-orange-500/20 text-orange-300'}`}>
                                    {a.type === 'bonus' ? 'bônus' : 'cobr.'}
                                  </span>
                                  <span className={`font-bold shrink-0 ${a.amount > 0 ? 'text-white/70' : 'text-red-300'}`}>
                                    {a.amount > 0 ? '+' : ''}{a.amount}
                                  </span>
                                  <span className="text-white/40 flex-1 truncate">{a.reason || '—'}</span>
                                  <span className="text-white/25 shrink-0">{new Date(a.created_at).toLocaleDateString('pt-BR')}</span>
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
                            className="flex-1 py-2.5 text-sm font-semibold rounded-2xl bg-white/10 border border-white/20 text-white/70 hover:bg-white/20 transition-colors disabled:opacity-40">
                            Desbloquear
                          </button>
                        )}
                      </div>

                      {/* Provisionar Tenant */}
                      {!detail.broker.zpro_tenant_id && (
                        <button
                          onClick={() => provisionTenant(detail.broker.id)}
                          disabled={updatingId === detail.broker.id}
                          className="w-full py-2.5 text-sm font-semibold rounded-2xl flex items-center justify-center gap-2
                            bg-violet-500/20 border border-violet-400/30 text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                        >
                          {updatingId === detail.broker.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                          Provisionar Tenant Z-PRO
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
                    <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
                      Imóveis ({detail.properties.length})
                    </h4>
                    {detail.properties.length === 0 ? (
                      <p className="text-xs text-white/30">Nenhum imóvel cadastrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.properties.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                            <span className="text-xs text-white/70 truncate">{p.title}</span>
                            <span className="text-[10px] text-white/30 shrink-0 ml-2">{fmtDate(p.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pagamentos */}
                  <div>
                    <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
                      Pagamentos ({detail.subscriptions.length})
                    </h4>
                    {detail.subscriptions.length === 0 ? (
                      <p className="text-xs text-white/30">Nenhum pagamento registrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.subscriptions.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                            <div>
                              <p className="text-xs font-semibold text-white/80">{fmt(s.amount)}</p>
                              <p className="text-[10px] text-white/30">{s.asaas_payment_id || s.stripe_session_id || '—'}</p>
                            </div>
                            <span className="text-[10px] text-white/30">{fmtDate(s.paid_at)}</span>
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
