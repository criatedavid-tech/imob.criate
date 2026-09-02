import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, RefreshCw, Loader2, Database,
  MessageSquare, Cpu, Unlock, RotateCcw, Trash2, Radio, Play,
} from 'lucide-react';
import { authService } from '../services/auth';
import { usePolling } from '../lib/usePolling';

type Level = 'ok' | 'atencao' | 'critico';

interface Queue {
  name: string; pending: number; processing: number; dead: number;
  completed24h: number; oldestPendingSeconds: number | null; staleLeases: number; level: Level;
}
interface Health {
  generated_at: string;
  queues: Queue[];
  traffic: { inbound_messages_24h: number; outbound_messages_24h: number; open_tickets: number; ai_paused_tickets: number };
  dead_letters: { id: string; broker_id: string; event_type: string; attempts: number; last_error: string | null; created_at: string }[];
  rejected_webhooks_24h: number;
  runtime: { uptime_seconds: number; rss_mb: number; heap_used_mb: number; node_version: string };
  config: {
    public_app_url: string;
    redis_configured: boolean;
    redis_connected: boolean;
    redis_error: string | null;
    sentry_configured: boolean;
    n8n_webhook_configured: boolean;
    n8n_dedicated_auth: boolean;
  };
}
interface BrokerRow {
  broker_id: string; name: string; status: string | null; instance_id: string | null;
  provisioning_status: string | null; has_token: boolean; last_inbound_at: string | null;
  minutes_since_inbound: number | null; open_tickets: number; ai_paused_tickets: number; level: Level;
}

const LEVEL_STYLE: Record<Level, { chip: string; label: string }> = {
  ok: { chip: 'text-emerald-300 bg-emerald-500/15', label: 'Saudável' },
  atencao: { chip: 'text-amber-300 bg-amber-500/15', label: 'Atenção' },
  critico: { chip: 'text-red-300 bg-red-500/15', label: 'Crítico' },
};

function humanAge(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.round(seconds / 3600)}h`;
}

async function api(url: string, opts: RequestInit = {}, signal?: AbortSignal) {
  const res = await fetch(url, {
    ...opts,
    signal,
    headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

export default function AdminHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [brokers, setBrokers] = useState<BrokerRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [h, b] = await Promise.all([
        api('/api/admin/health', {}, signal),
        api('/api/admin/health/brokers', {}, signal),
      ]);
      setHealth(h);
      setBrokers(b);
      setError('');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e.message || 'Falha ao carregar a saúde do sistema.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  usePolling((signal) => load(signal), 15_000);

  const runAction = async (action: string, queue?: 'inbox' | 'outbox', label?: string) => {
    setBusy(action + (queue || ''));
    setMsg(null);
    try {
      const r = await api(`/api/admin/health/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify({ queue: queue || 'inbox' }),
      });
      setMsg(`${label || action}: ${r.affected !== undefined ? `${r.affected} registro(s)` : 'concluído'}.`);
      await load();
    } catch (e: any) {
      setMsg(`Falha em ${label || action}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (error && !health) {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-red-200">
        <p className="font-semibold mb-1">Não deu para carregar a saúde do sistema.</p>
        <p className="text-sm opacity-80">{error}</p>
      </div>
    );
  }
  if (!health) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-low)]" /></div>;
  }

  const configNeedsAttention = health.config.n8n_webhook_configured && !health.config.n8n_dedicated_auth;
  const worst: Level = health.queues.some((q) => q.level === 'critico') ? 'critico'
    : health.queues.some((q) => q.level === 'atencao') || configNeedsAttention ? 'atencao' : 'ok';

  return (
    <div className="space-y-6">
      {/* Resumo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-violet-300" />
          <h2 className="text-xl font-bold text-[var(--text-hi)]">Saúde do sistema</h2>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${LEVEL_STYLE[worst].chip}`}>
            {worst === 'ok' ? <CheckCircle2 className="w-3 h-3 inline mr-1" /> : <AlertTriangle className="w-3 h-3 inline mr-1" />}
            {LEVEL_STYLE[worst].label}
          </span>
        </div>
        <button onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)]">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>
      <p className="text-[12px] text-[var(--text-low)] -mt-4">
        Atualiza sozinho a cada 15s · última leitura {new Date(health.generated_at).toLocaleTimeString('pt-BR')}
      </p>

      {msg && <div className="rounded-xl bg-violet-500/15 border border-violet-400/25 px-4 py-3 text-[13px] text-violet-100">{msg}</div>}

      {/* Filas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {health.queues.map((q) => (
          <div key={q.name} className="rounded-2xl bg-[var(--surface-glass)] border border-[var(--hairline)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[var(--text-hi)] font-semibold text-[14px]">
                <Database className="w-4 h-4 text-violet-300" /> {q.name}
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${LEVEL_STYLE[q.level].chip}`}>{LEVEL_STYLE[q.level].label}</span>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div><div className="text-xl font-bold text-[var(--text-hi)] tabular-nums">{q.pending}</div><div className="text-[10px] uppercase tracking-wider text-[var(--text-low)]">Na fila</div></div>
              <div><div className="text-xl font-bold text-[var(--text-hi)] tabular-nums">{q.processing}</div><div className="text-[10px] uppercase tracking-wider text-[var(--text-low)]">Processando</div></div>
              <div><div className={`text-xl font-bold tabular-nums ${q.dead ? 'text-red-300' : 'text-[var(--text-hi)]'}`}>{q.dead}</div><div className="text-[10px] uppercase tracking-wider text-[var(--text-low)]">Falharam</div></div>
              <div><div className="text-xl font-bold text-[var(--text-hi)] tabular-nums">{q.completed24h}</div><div className="text-[10px] uppercase tracking-wider text-[var(--text-low)]">24h</div></div>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--hairline)] flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--text-mid)]">
              <span>Mais antiga na fila: <b className="text-[var(--text-hi)]">{humanAge(q.oldestPendingSeconds)}</b></span>
              {q.staleLeases > 0 && <span className="text-amber-300">Travadas: <b>{q.staleLeases}</b></span>}
            </div>
          </div>
        ))}
      </div>

      {/* Ações */}
      <div className="rounded-2xl bg-[var(--surface-glass)] border border-[var(--hairline)] p-5">
        <h3 className="text-[13px] font-bold text-[var(--text-hi)] mb-1">Intervenção manual</h3>
        <p className="text-[12px] text-[var(--text-low)] mb-4">
          Todas são seguras de repetir: no pior caso reprocessam algo que já estava certo — nunca apagam mensagem.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { a: 'drain-queues', icon: Play, label: 'Processar filas agora' },
            { a: 'requeue-dead', q: 'inbox' as const, icon: RotateCcw, label: 'Reprocessar falhas (entrada)' },
            { a: 'requeue-dead', q: 'outbox' as const, icon: RotateCcw, label: 'Reprocessar falhas (saída)' },
            { a: 'release-stale-leases', q: 'inbox' as const, icon: Unlock, label: 'Destravar presas (entrada)' },
            { a: 'release-stale-leases', q: 'outbox' as const, icon: Unlock, label: 'Destravar presas (saída)' },
            { a: 'reassert-webhooks', icon: Radio, label: 'Reapontar webhooks do WhatsApp' },
            { a: 'purge-queues', icon: Trash2, label: 'Limpar histórico das filas' },
          ].map(({ a, q, icon: Icon, label }) => (
            <button
              key={a + (q || '')}
              onClick={() => runAction(a, q, label)}
              disabled={!!busy}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-semibold text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] disabled:opacity-40 transition-colors"
            >
              {busy === a + (q || '') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tráfego + runtime */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[var(--surface-glass)] border border-[var(--hairline)] p-5">
          <div className="flex items-center gap-2 text-[var(--text-hi)] font-semibold text-[14px] mb-3"><MessageSquare className="w-4 h-4 text-violet-300" /> Atendimento (24h)</div>
          <div className="grid grid-cols-2 gap-4 text-[13px] text-[var(--text-mid)]">
            <div>Recebidas: <b className="text-[var(--text-hi)] tabular-nums">{health.traffic.inbound_messages_24h}</b></div>
            <div>Enviadas: <b className="text-[var(--text-hi)] tabular-nums">{health.traffic.outbound_messages_24h}</b></div>
            <div>Conversas abertas: <b className="text-[var(--text-hi)] tabular-nums">{health.traffic.open_tickets}</b></div>
            <div>Com IA pausada: <b className="text-[var(--text-hi)] tabular-nums">{health.traffic.ai_paused_tickets}</b></div>
            <div className="col-span-2">Webhooks rejeitados: <b className="text-[var(--text-hi)] tabular-nums">{health.rejected_webhooks_24h}</b></div>
          </div>
        </div>
        <div className="rounded-2xl bg-[var(--surface-glass)] border border-[var(--hairline)] p-5">
          <div className="flex items-center gap-2 text-[var(--text-hi)] font-semibold text-[14px] mb-3"><Cpu className="w-4 h-4 text-violet-300" /> Servidor</div>
          <div className="grid grid-cols-2 gap-4 text-[13px] text-[var(--text-mid)]">
            <div>No ar há: <b className="text-[var(--text-hi)]">{humanAge(health.runtime.uptime_seconds)}</b></div>
            <div>Memória: <b className="text-[var(--text-hi)] tabular-nums">{health.runtime.rss_mb} MB</b></div>
            <div className="col-span-2 flex flex-wrap gap-2 pt-1">
              {[
                { ok: health.config.redis_configured && health.config.redis_connected, label: 'Redis' },
                { ok: health.config.sentry_configured, label: 'Sentry' },
                {
                  ok: health.config.n8n_webhook_configured && health.config.n8n_dedicated_auth,
                  warning: health.config.n8n_webhook_configured && !health.config.n8n_dedicated_auth,
                  label: 'n8n',
                },
              ].map(({ ok, warning, label }) => (
                <span key={label} className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                  ok ? 'text-emerald-300 bg-emerald-500/15'
                    : warning ? 'text-amber-300 bg-amber-500/15'
                      : 'text-[var(--text-low)] bg-[var(--control-fill)]'
                }`}>
                  {label}: {ok ? 'ativo' : warning ? 'ativo com token compartilhado' : 'não configurado'}
                </span>
              ))}
            </div>
            {configNeedsAttention && (
              <div className="col-span-2 text-[12px] text-amber-300">
                n8n usa o token interno como fallback. Configure um N8N_WEBHOOK_TOKEN dedicado e Header Auth no workflow.
              </div>
            )}
            {health.config.redis_configured && !health.config.redis_connected && (
              <div className="col-span-2 text-[12px] text-red-300">
                Redis configurado mas SEM conexão{health.config.redis_error ? `: ${health.config.redis_error}` : '.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Falhas */}
      {health.dead_letters.length > 0 && (
        <div className="rounded-2xl bg-red-500/[0.06] border border-red-400/20 p-5">
          <h3 className="text-[13px] font-bold text-red-200 mb-3">Mensagens que falharam ({health.dead_letters.length})</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {health.dead_letters.map((d) => (
              <div key={d.id} className="text-[12px] text-[var(--text-mid)] bg-black/20 rounded-lg px-3 py-2">
                <span className="text-[var(--text-low)]">{new Date(d.created_at).toLocaleString('pt-BR')}</span>
                {' · '}<b className="text-[var(--text-hi)]">{d.event_type}</b>
                {' · '}{d.attempts} tentativas
                {d.last_error && <div className="text-red-300/80 mt-0.5 break-words">{d.last_error.slice(0, 220)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Por corretor */}
      <div className="rounded-2xl bg-[var(--surface-glass)] border border-[var(--hairline)] p-5">
        <h3 className="text-[13px] font-bold text-[var(--text-hi)] mb-3">Por corretor</h3>
        {!brokers ? (
          <Loader2 className="w-5 h-5 animate-spin text-[var(--text-low)]" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] text-[var(--text-mid)]">
              <thead className="text-[var(--text-low)] uppercase text-[10px] tracking-wider">
                <tr className="text-left">
                  <th className="pb-2 pr-3">Corretor</th>
                  <th className="pb-2 pr-3">WhatsApp</th>
                  <th className="pb-2 pr-3">Última msg recebida</th>
                  <th className="pb-2 pr-3 text-right">Conversas</th>
                  <th className="pb-2 text-right">IA pausada</th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b) => (
                  <tr key={b.broker_id} className="border-t border-[var(--hairline)]">
                    <td className="py-2 pr-3">
                      <span className="text-[var(--text-hi)]">{b.name}</span>
                      <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${LEVEL_STYLE[b.level].chip}`}>{LEVEL_STYLE[b.level].label}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {b.instance_id && b.has_token
                        ? <span className="text-emerald-300/90">conectado</span>
                        : <span className="text-red-300">sem instância</span>}
                      {b.provisioning_status && b.provisioning_status !== 'completed' && (
                        <span className="text-amber-300/80 ml-1">({b.provisioning_status})</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {b.minutes_since_inbound === null ? '—' : `há ${humanAge(b.minutes_since_inbound * 60)}`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.open_tickets}</td>
                    <td className="py-2 text-right tabular-nums">{b.ai_paused_tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
