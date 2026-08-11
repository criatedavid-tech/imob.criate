import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

type LogStatus = 'pendente' | 'em_analise' | 'resolvido';

interface SystemLog {
  id: string;
  user_id: string | null;
  user_label: string;
  account_label: string;
  channel: string;
  category: string;
  requested_action: string | null;
  stage: string;
  public_message: string | null;
  technical_message: string;
  status: LogStatus;
  context: Record<string, unknown>;
  occurred_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const STATUS_LABEL: Record<LogStatus, string> = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  resolvido: 'Resolvido',
};
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp_pai: 'WhatsApp Pai',
  painel_interno: 'Painel interno',
  integracao: 'Integração',
  worker: 'Worker',
  sistema: 'Sistema',
};
const CATEGORY_LABEL: Record<string, string> = {
  execution_error: 'Erro de execução',
  integration_failure: 'Falha de integração',
  agent_unhandled: 'IA não interpretou',
  tool_failure: 'Falha de ferramenta',
  validation_error: 'Falha de validação',
  queue_failure: 'Falha de fila',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function statusClass(status: LogStatus): string {
  if (status === 'resolvido') return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20';
  if (status === 'em_analise') return 'text-amber-200 bg-amber-400/10 border-amber-400/20';
  return 'text-red-200 bg-red-400/10 border-red-400/20';
}

export function LogsArea() {
  const [items, setItems] = useState<SystemLog[]>([]);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status) params.set('status', status);
      if (channel) params.set('channel', channel);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/system-logs?${params}`, { headers: authService.getAuthHeaders() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar os logs.');
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar os logs.');
    } finally {
      setLoading(false);
    }
  }, [status, channel, search]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    pendente: items.filter((item) => item.status === 'pendente').length,
    em_analise: items.filter((item) => item.status === 'em_analise').length,
    resolvido: items.filter((item) => item.status === 'resolvido').length,
  }), [items]);

  const updateStatus = async (id: string, next: LogStatus) => {
    setUpdating(id);
    try {
      const response = await fetch(`/api/system-logs/${id}/status`, {
        method: 'PATCH',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Falha ao atualizar o log.');
      setItems((current) => current.map((item) => item.id === id ? { ...item, ...body } : item));
    } catch (e: any) {
      setError(e?.message || 'Falha ao atualizar o log.');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-300" />
            <h2 className="text-2xl font-black text-[var(--text-hi)]">Logs do sistema</h2>
          </div>
          <p className="text-[12px] text-[var(--text-low)] mt-1">Rastreabilidade técnica global · acesso exclusivo do administrador do sistema</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-semibold text-[var(--text-mid)] hover:text-[var(--text-hi)] disabled:opacity-50"
          style={{ background: 'var(--control-fill)', borderColor: 'var(--hairline)' }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {(['pendente', 'em_analise', 'resolvido'] as LogStatus[]).map((key) => (
          <GlassCard key={key} className="!p-4">
            <p className="text-[11px] text-[var(--text-low)]">{STATUS_LABEL[key]}</p>
            <p className="text-2xl font-black text-[var(--text-hi)] mt-1">{counts[key]}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="!p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-3">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-low)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ação, etapa ou erro"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border bg-[var(--control-fill)] border-[var(--hairline)] text-[13px] text-[var(--text-hi)] outline-none focus:border-[var(--glass-border-strong)]" />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2.5 rounded-xl border bg-[var(--control-fill)] border-[var(--hairline)] text-[13px] text-[var(--text-mid)]">
            <option value="">Todos os status</option>
            <option value="pendente">Pendentes</option>
            <option value="em_analise">Em análise</option>
            <option value="resolvido">Resolvidos</option>
          </select>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="px-3 py-2.5 rounded-xl border bg-[var(--control-fill)] border-[var(--hairline)] text-[13px] text-[var(--text-mid)]">
            <option value="">Todos os canais</option>
            <option value="whatsapp_pai">WhatsApp Pai</option>
            <option value="painel_interno">Painel interno</option>
            <option value="integracao">Integrações</option>
            <option value="worker">Workers</option>
            <option value="sistema">Sistema</option>
          </select>
        </div>
      </GlassCard>

      {error && <div className="mb-4 px-4 py-3 rounded-xl border border-red-400/20 bg-red-400/10 text-red-200 text-[13px]">{error}</div>}
      {loading ? (
        <div className="flex justify-center pt-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-low)]" /></div>
      ) : items.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <CheckCircle2 className="w-9 h-9 text-emerald-300 mx-auto mb-3" />
          <p className="text-[15px] text-[var(--text-mid)]">Nenhuma ocorrência encontrada com estes filtros.</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const open = expanded === item.id;
            return (
              <GlassCard key={item.id} className="!p-0 overflow-hidden">
                <button onClick={() => setExpanded(open ? null : item.id)} className="w-full p-4 text-left flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${statusClass(item.status)}`}>
                    {item.status === 'resolvido' ? <CheckCircle2 className="w-4 h-4" /> : item.status === 'em_analise' ? <Clock3 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-bold text-[var(--text-hi)]">{CATEGORY_LABEL[item.category] || item.category}</span>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusClass(item.status)}`}>{STATUS_LABEL[item.status]}</span>
                    </div>
                    <p className="text-[12px] text-[var(--text-mid)] mt-1 truncate">{item.requested_action || item.public_message || item.technical_message}</p>
                    <p className="text-[10px] text-[var(--text-low)] mt-2">{formatDate(item.occurred_at)} · {CHANNEL_LABEL[item.channel] || item.channel} · {item.account_label} · {item.user_label}</p>
                  </div>
                  {open ? <ChevronUp className="w-4 h-4 text-[var(--text-low)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-low)]" />}
                </button>
                {open && (
                  <div className="border-t border-[var(--hairline)] p-4 bg-black/10 space-y-3">
                    <div className="grid md:grid-cols-2 gap-3 text-[12px]">
                      <div><span className="text-[var(--text-low)]">Etapa</span><p className="text-[var(--text-hi)] mt-1">{item.stage}</p></div>
                      <div><span className="text-[var(--text-low)]">Canal</span><p className="text-[var(--text-hi)] mt-1">{CHANNEL_LABEL[item.channel] || item.channel}</p></div>
                    </div>
                    {item.requested_action && <div><span className="text-[11px] text-[var(--text-low)]">Ação solicitada</span><p className="text-[12px] text-[var(--text-mid)] mt-1 whitespace-pre-wrap">{item.requested_action}</p></div>}
                    {item.public_message && <div><span className="text-[11px] text-[var(--text-low)]">Mensagem mostrada ao usuário</span><p className="text-[12px] text-[var(--text-mid)] mt-1 whitespace-pre-wrap">{item.public_message}</p></div>}
                    <div><span className="text-[11px] text-[var(--text-low)]">Detalhe técnico protegido</span><pre className="mt-1 p-3 rounded-xl bg-black/20 text-[11px] leading-relaxed text-[var(--text-mid)] whitespace-pre-wrap break-words font-mono">{item.technical_message}</pre></div>
                    {Object.keys(item.context || {}).length > 0 && <div><span className="text-[11px] text-[var(--text-low)]">Contexto seguro</span><pre className="mt-1 p-3 rounded-xl bg-black/20 text-[11px] text-[var(--text-mid)] whitespace-pre-wrap break-words font-mono">{JSON.stringify(item.context, null, 2)}</pre></div>}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      {(['pendente', 'em_analise', 'resolvido'] as LogStatus[]).map((next) => (
                        <button key={next} onClick={() => updateStatus(item.id, next)} disabled={updating === item.id || item.status === next}
                          className={`px-3 py-2 rounded-xl border text-[11px] font-semibold disabled:opacity-40 ${statusClass(next)}`}>
                          {updating === item.id ? 'Salvando...' : STATUS_LABEL[next]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
