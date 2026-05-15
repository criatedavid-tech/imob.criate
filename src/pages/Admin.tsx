import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Home, TrendingUp, DollarSign, Shield, CheckCircle2,
  XCircle, Clock, ChevronRight, Loader2, RefreshCw, LogOut,
  BarChart3, Building2, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from '../services/auth';

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

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ativo:     { label: 'Ativo',     color: 'bg-green-100 text-green-700',  icon: <CheckCircle2 className="w-3 h-3" /> },
  pendente:  { label: 'Pendente',  color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3 h-3" /> },
  bloqueado: { label: 'Bloqueado', color: 'bg-red-100 text-red-700',      icon: <XCircle className="w-3 h-3" /> },
};

function fmt(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

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
    try {
      const res = await fetch(`/api/admin/brokers/${id}`, { headers });
      setDetail(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = brokers.filter(b =>
    (b.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.phone || '').includes(search)
  );

  if (error) return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
      <div className="text-center">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-[#374151] font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-[#6B7280] hover:text-black">
          Voltar ao Dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans">
      {/* Header */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-[#1A1A1A]">Painel Admin</h1>
            <p className="text-[10px] text-[#9CA3AF]">ImobiFlow</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-black transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-black transition-colors">
            <Home className="w-3.5 h-3.5" /> Dashboard
          </button>
          <button onClick={() => authService.logout()} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Métricas */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin w-6 h-6 text-[#9CA3AF]" /></div>
        ) : (
          <>
            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                {[
                  { label: 'Corretores', value: metrics.totalBrokers, icon: <Users className="w-4 h-4" />, color: 'text-blue-600 bg-blue-50' },
                  { label: 'Ativos', value: metrics.activeBrokers, icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-green-600 bg-green-50' },
                  { label: 'Imóveis', value: metrics.totalProperties, icon: <Building2 className="w-4 h-4" />, color: 'text-purple-600 bg-purple-50' },
                  { label: 'Leads', value: metrics.totalLeads, icon: <TrendingUp className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
                  { label: 'Receita', value: fmt(metrics.totalRevenueCents), icon: <DollarSign className="w-4 h-4" />, color: 'text-emerald-600 bg-emerald-50' },
                ].map(m => (
                  <div key={m.label} className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-sm">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${m.color}`}>
                      {m.icon}
                    </div>
                    <p className="text-xl font-black text-[#1A1A1A]">{m.value}</p>
                    <p className="text-[11px] text-[#9CA3AF]">{m.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Busca */}
            <div className="mb-4">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, email ou telefone..."
                className="w-full max-w-sm px-4 py-2.5 bg-white border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none"
              />
            </div>

            {/* Tabela */}
            <div className="bg-white rounded-3xl border border-[#E5E7EB] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[#F3F4F6] flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1A1A1A]">Corretores ({filtered.length})</h2>
              </div>

              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-[#9CA3AF]">Nenhum corretor encontrado</div>
              ) : (
                <div className="divide-y divide-[#F3F4F6]">
                  {filtered.map(broker => {
                    const s = STATUS_LABELS[broker.status] || STATUS_LABELS.pendente;
                    return (
                      <div key={broker.id} className="px-6 py-4 flex items-center gap-4 hover:bg-[#F9FAFB] transition-colors">
                        {/* Avatar */}
                        <div className="w-9 h-9 bg-[#F3F4F6] rounded-full flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-[#374151]">
                            {(broker.name || '?')[0].toUpperCase()}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#1A1A1A] truncate">{broker.name || '—'}</p>
                            {broker.is_admin && (
                              <span className="text-[10px] bg-black text-white px-1.5 py-0.5 rounded-full">admin</span>
                            )}
                          </div>
                          <p className="text-xs text-[#6B7280] truncate">{broker.email || broker.phone || '—'}</p>
                        </div>

                        {/* Status badge */}
                        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${s.color}`}>
                          {s.icon} {s.label}
                        </span>

                        {/* Validade */}
                        <span className="text-xs text-[#9CA3AF] shrink-0 hidden md:block w-24 text-right">
                          {broker.valid_until ? `até ${fmtDate(broker.valid_until)}` : 'sem plano'}
                        </span>

                        {/* Ações rápidas */}
                        <div className="flex items-center gap-1 shrink-0">
                          {broker.status !== 'ativo' && !broker.is_admin && (
                            <button
                              onClick={() => updateStatus(broker.id, 'ativo')}
                              disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-green-50 text-green-700 rounded-full hover:bg-green-100 transition-colors disabled:opacity-50"
                            >
                              Ativar
                            </button>
                          )}
                          {broker.status === 'ativo' && !broker.is_admin && (
                            <button
                              onClick={() => updateStatus(broker.id, 'bloqueado')}
                              disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              Bloquear
                            </button>
                          )}
                          {broker.status === 'bloqueado' && !broker.is_admin && (
                            <button
                              onClick={() => updateStatus(broker.id, 'pendente')}
                              disabled={updatingId === broker.id}
                              className="text-[11px] px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded-full hover:bg-yellow-100 transition-colors disabled:opacity-50"
                            >
                              Desbloquear
                            </button>
                          )}
                          <button
                            onClick={() => openDetail(broker.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#F3F4F6] transition-colors"
                          >
                            <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
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
      </div>

      {/* Drawer de detalhes */}
      <AnimatePresence>
        {(detail || loadingDetail) && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setDetail(null)}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto"
            >
              <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#1A1A1A]">Detalhes do Corretor</h3>
                <button onClick={() => setDetail(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F3F4F6]">
                  <X className="w-4 h-4 text-[#6B7280]" />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin w-5 h-5 text-[#9CA3AF]" /></div>
              ) : detail && (
                <div className="px-6 py-5 space-y-6">
                  {/* Info básica */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest">Informações</h4>
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
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-[#9CA3AF]">{k}</span>
                        <span className="text-[#374151] font-medium">{v || '—'}</span>
                      </div>
                    ))}
                  </div>

                  {/* Ação de status */}
                  {!detail.broker.is_admin && (
                    <div className="flex gap-2">
                      {detail.broker.status !== 'ativo' && (
                        <button onClick={() => updateStatus(detail.broker.id, 'ativo')}
                          className="flex-1 py-2 bg-green-50 text-green-700 text-sm font-semibold rounded-2xl hover:bg-green-100 transition-colors">
                          Ativar conta
                        </button>
                      )}
                      {detail.broker.status === 'ativo' && (
                        <button onClick={() => updateStatus(detail.broker.id, 'bloqueado')}
                          className="flex-1 py-2 bg-red-50 text-red-600 text-sm font-semibold rounded-2xl hover:bg-red-100 transition-colors">
                          Bloquear conta
                        </button>
                      )}
                      {detail.broker.status === 'bloqueado' && (
                        <button onClick={() => updateStatus(detail.broker.id, 'pendente')}
                          className="flex-1 py-2 bg-yellow-50 text-yellow-700 text-sm font-semibold rounded-2xl hover:bg-yellow-100 transition-colors">
                          Desbloquear
                        </button>
                      )}
                    </div>
                  )}

                  {/* Imóveis */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-2">
                      Imóveis ({detail.properties.length})
                    </h4>
                    {detail.properties.length === 0 ? (
                      <p className="text-xs text-[#9CA3AF]">Nenhum imóvel cadastrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.properties.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-xl px-3 py-2">
                            <span className="text-xs text-[#374151] truncate">{p.title}</span>
                            <span className="text-[10px] text-[#9CA3AF] shrink-0 ml-2">{fmtDate(p.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pagamentos */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-2">
                      Pagamentos ({detail.subscriptions.length})
                    </h4>
                    {detail.subscriptions.length === 0 ? (
                      <p className="text-xs text-[#9CA3AF]">Nenhum pagamento registrado</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.subscriptions.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between bg-[#F9FAFB] rounded-xl px-3 py-2">
                            <div>
                              <p className="text-xs font-semibold text-[#374151]">{fmt(s.amount)}</p>
                              <p className="text-[10px] text-[#9CA3AF]">{s.asaas_payment_id || s.stripe_session_id || '—'}</p>
                            </div>
                            <span className="text-[10px] text-[#9CA3AF]">{fmtDate(s.paid_at)}</span>
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
