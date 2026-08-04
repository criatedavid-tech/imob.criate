import React, { useEffect, useState } from 'react';
import {
  Loader2, X, KeyRound, Users, CalendarClock, TrendingUp, AlertTriangle,
  CheckCircle2, Bot, Clock, ArrowRightLeft, Sparkles, HandCoins,
} from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

// Painéis da aba Locação: visão gerencial (Alugados) e funil dos vagos
// (Disponíveis). A regra de ouro do desenho aqui é: cada número na tela
// responde a uma pergunta que o corretor faz de manhã, e todo número que
// exige ação tem o botão da ação ao lado.

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = (cents: number) => {
  const v = cents / 100;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `R$ ${v.toFixed(0)}`;
};

// ─── Dashboard (aba Alugados) ───────────────────────────────────────────────

export interface RentalDashboardData {
  contratos_ativos: number;
  autopilot_ativos: number;
  receita_mensal_cents: number;
  taxa_admin_mensal_cents: number;
  em_aberto_qtd: number;
  em_aberto_cents: number;
  atrasados_qtd: number;
  atrasados_cents: number;
  com_promessa_qtd: number;
  escalados_qtd: number;
  inadimplencia_percent: number;
  serie_6_meses: { mes: string; previsto: number; recebido: number }[];
  reajustes_proximos: { id: string; tenant_name: string; next_adjustment_date: string }[];
}

function Kpi({ label, value, hint, tone = 'neutro', icon: Icon }: {
  label: string; value: string; hint?: string;
  tone?: 'neutro' | 'bom' | 'alerta' | 'ruim';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass = {
    neutro: 'text-[var(--text-hi)]',
    bom: 'text-emerald-300',
    alerta: 'text-amber-300',
    ruim: 'text-red-300',
  }[tone];
  return (
    <GlassCard className="!p-4">
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-[var(--text-low)]" />}
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-low)]">{label}</span>
      </div>
      <div className={`text-2xl font-black tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-[11px] text-[var(--text-low)] mt-0.5">{hint}</div>}
    </GlassCard>
  );
}

// Gráfico em SVG puro — sem biblioteca de charts. Duas barras por mês:
// previsto (contorno) e recebido (preenchido). A leitura é imediata: quanto
// menor a parte preenchida, maior a inadimplência daquele mês.
function RevenueChart({ serie }: { serie: RentalDashboardData['serie_6_meses'] }) {
  const max = Math.max(1, ...serie.map((s) => Math.max(s.previsto, s.recebido)));
  const H = 120;
  const barW = 18;
  const gap = 34;
  const W = serie.length * (barW * 2 + gap);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(W, 260)} height={H + 34} role="img" aria-label="Previsto x recebido nos últimos 6 meses">
        {serie.map((s, i) => {
          const x = i * (barW * 2 + gap);
          const hPrev = Math.round((s.previsto / max) * H);
          const hRec = Math.round((s.recebido / max) * H);
          return (
            <g key={s.mes + i}>
              <rect x={x} y={H - hPrev} width={barW} height={hPrev} rx="3"
                fill="none" stroke="var(--hairline-strong)" strokeWidth="1.5" />
              <rect x={x + barW + 5} y={H - hRec} width={barW} height={hRec} rx="3"
                fill="var(--accent, #8b5cf6)" opacity="0.85" />
              <text x={x + barW} y={H + 14} textAnchor="middle"
                fill="var(--text-low)" fontSize="10" fontWeight="600">{s.mes}</text>
              <text x={x + barW} y={H + 28} textAnchor="middle"
                fill="var(--text-low)" fontSize="9">{brlShort(s.recebido)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RentalDashboard({ data }: { data: RentalDashboardData }) {
  const inadTone = data.inadimplencia_percent >= 20 ? 'ruim' : data.inadimplencia_percent >= 8 ? 'alerta' : 'bom';
  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Receita do mês" value={brl(data.receita_mensal_cents)}
          hint={`${data.contratos_ativos} contrato(s) ativo(s)`} icon={TrendingUp} />
        <Kpi label="Sua comissão" value={brl(data.taxa_admin_mensal_cents)}
          hint="taxa de administração" icon={HandCoins} />
        <Kpi label="Em atraso" value={brl(data.atrasados_cents)}
          hint={`${data.atrasados_qtd} cobrança(s)`}
          tone={data.atrasados_qtd > 0 ? 'ruim' : 'bom'} icon={AlertTriangle} />
        <Kpi label="Inadimplência" value={`${data.inadimplencia_percent}%`}
          hint="do previsto neste mês" tone={inadTone as any} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        <GlassCard className="!p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-bold text-[var(--text-hi)]">Previsto x recebido</h3>
            <div className="flex items-center gap-3 text-[10px] text-[var(--text-low)]">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm border border-[var(--hairline-strong)]" /> previsto
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-violet-500/85" /> recebido
              </span>
            </div>
          </div>
          <RevenueChart serie={data.serie_6_meses} />
        </GlassCard>

        <GlassCard className="!p-5">
          <h3 className="text-[13px] font-bold text-[var(--text-hi)] mb-3">Situação da cobrança</h3>
          <div className="space-y-2.5">
            {[
              { icon: Bot, label: 'No piloto automático', value: `${data.autopilot_ativos} de ${data.contratos_ativos}`, tone: 'text-violet-300' },
              { icon: Clock, label: 'Aguardando promessa', value: String(data.com_promessa_qtd), tone: 'text-amber-300' },
              { icon: ArrowRightLeft, label: 'Precisam de você', value: String(data.escalados_qtd), tone: data.escalados_qtd ? 'text-red-300' : 'text-[var(--text-mid)]' },
              { icon: CheckCircle2, label: 'Em aberto (total)', value: brl(data.em_aberto_cents), tone: 'text-[var(--text-mid)]' },
            ].map(({ icon: Icon, label, value, tone }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12px] text-[var(--text-mid)]">
                  <Icon className={`w-3.5 h-3.5 ${tone}`} /> {label}
                </span>
                <span className={`text-[13px] font-bold tabular-nums ${tone}`}>{value}</span>
              </div>
            ))}
          </div>

          {data.reajustes_proximos.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--hairline)]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300 mb-1.5">
                Reajuste a vencer
              </p>
              {data.reajustes_proximos.slice(0, 3).map((r) => (
                <p key={r.id} className="text-[12px] text-[var(--text-mid)]">
                  {r.tenant_name} · {r.next_adjustment_date.split('-').reverse().join('/')}
                </p>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Diário do contrato ─────────────────────────────────────────────────────

const EVENT_STYLE: Record<string, { dot: string; label: string }> = {
  cobranca_gerada: { dot: 'bg-violet-400', label: 'Cobrança gerada' },
  cobranca_enviada: { dot: 'bg-sky-400', label: 'Cobrança enviada' },
  cobranca_falhou: { dot: 'bg-red-400', label: 'Falha na cobrança' },
  segunda_via_enviada: { dot: 'bg-sky-400', label: '2ª via enviada' },
  promessa_registrada: { dot: 'bg-amber-400', label: 'Promessa registrada' },
  escalado_humano: { dot: 'bg-red-400', label: 'Passou para você' },
  autopilot_ligado: { dot: 'bg-emerald-400', label: 'Piloto ligado' },
  autopilot_desligado: { dot: 'bg-slate-400', label: 'Piloto desligado' },
};

const ACTOR_LABEL: Record<string, string> = { sistema: 'Sistema', ia: 'IA', humano: 'Você' };

export function ContractDiaryModal({ contract, onClose, onChanged }: {
  contract: { id: string; tenant_name: string; autopilot_enabled?: boolean };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [autopilot, setAutopilot] = useState(!!contract.autopilot_enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/locacao/contracts/${contract.id}/events`)
      .then(setEvents)
      .catch((e) => { setError(e.message); setEvents([]); });
  }, [contract.id]);

  const toggleAutopilot = async () => {
    setSaving(true);
    setError('');
    try {
      const next = !autopilot;
      await api(`/api/locacao/contracts/${contract.id}/autopilot`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setAutopilot(next);
      onChanged();
      api(`/api/locacao/contracts/${contract.id}/events`).then(setEvents).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl max-h-[85vh] rounded-3xl bg-slate-900 border border-[var(--glass-border)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-[var(--hairline)] flex items-start justify-between">
          <div>
            <h3 className="text-[17px] font-bold text-[var(--text-hi)]">Diário do contrato</h3>
            <p className="text-[12px] text-[var(--text-low)] mt-0.5">{contract.tenant_name}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-hi)]"><X className="w-5 h-5" /></button>
        </div>

        {/* Piloto automático — o controle mais importante da tela, por isso no topo */}
        <div className="px-6 py-4 border-b border-[var(--hairline)] bg-[var(--control-fill)]">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-[var(--text-hi)] flex items-center gap-2">
                <Bot className="w-4 h-4 text-violet-300" /> Piloto automático
              </p>
              <p className="text-[11.5px] text-[var(--text-low)] mt-1 leading-relaxed">
                {autopilot
                  ? 'A cobrança do mês é gerada e enviada sozinha, e a IA responde o inquilino. Casos fora da alçada vêm para você.'
                  : 'Nada é enviado automaticamente. Você gera e cobra manualmente.'}
              </p>
            </div>
            <button onClick={toggleAutopilot} disabled={saving}
              className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-bold transition-colors disabled:opacity-50 ${
                autopilot ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-[var(--text-mid)] bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)]'
              }`}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {autopilot ? 'Ligado' : 'Desligado'}
            </button>
          </div>
          {error && <p className="text-[12px] text-red-300 mt-2">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!events ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-low)]" /></div>
          ) : events.length === 0 ? (
            <p className="text-[13px] text-[var(--text-low)] text-center py-10">
              Nada aconteceu ainda neste contrato.
            </p>
          ) : (
            <div className="space-y-0">
              {events.map((ev, i) => {
                const style = EVENT_STYLE[ev.event_type] || { dot: 'bg-slate-400', label: ev.event_type };
                return (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`w-2.5 h-2.5 rounded-full ${style.dot} mt-1.5 shrink-0`} />
                      {i < events.length - 1 && <span className="w-px flex-1 bg-[var(--hairline)] my-1" />}
                    </div>
                    <div className="pb-5 min-w-0">
                      <p className="text-[12.5px] text-[var(--text-hi)] font-semibold">{style.label}</p>
                      <p className="text-[12.5px] text-[var(--text-mid)] leading-relaxed">{ev.description}</p>
                      <p className="text-[10.5px] text-[var(--text-low)] mt-1">
                        {ACTOR_LABEL[ev.actor] || ev.actor} ·{' '}
                        {new Date(ev.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Aba Disponíveis ────────────────────────────────────────────────────────

interface AvailableProperty {
  id: string; title: string; location: string; price: string; slug: string;
  dias_vago: number; interessados: number; dias_sem_lead: number | null;
  visitas_agendadas: number;
  proxima_visita: { quando: string; cliente: string } | null;
  chave: { id: string; com: string; telefone: string | null; finalidade: string; prevista_para: string | null; atrasada: boolean } | null;
}

function KeyModal({ property, onClose, onSaved }: {
  property: AvailableProperty; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('visita');
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + 4 * 3600_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Informe com quem está a chave.'); return; }
    setSaving(true); setError('');
    try {
      await api('/api/locacao/keys', {
        method: 'POST',
        body: JSON.stringify({
          property_id: property.id, holder_name: name, holder_phone: phone || null,
          purpose, due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      onSaved(); onClose();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-[var(--glass-border)] p-6"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[var(--text-hi)] mb-1">Entregar chave</h3>
        <p className="text-[12px] text-[var(--text-low)] mb-5">{property.title}</p>

        <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider">Com quem fica</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder="Nome de quem está levando"
          className="w-full mt-1 mb-3 px-4 py-2.5 rounded-2xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none focus:border-[var(--glass-border-strong)]" />

        <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider">Telefone (opcional)</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(62) 99999-9999"
          className="w-full mt-1 mb-3 px-4 py-2.5 rounded-2xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none focus:border-[var(--glass-border-strong)]" />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider">Motivo</label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-2xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none [color-scheme:dark]">
              <option value="visita">Visita</option>
              <option value="vistoria">Vistoria</option>
              <option value="obra">Obra / reparo</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider">Devolver até</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-2xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none [color-scheme:dark]" />
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-low)] mb-4">
          Se a chave não for devolvida no prazo, você recebe um aviso no WhatsApp.
        </p>

        {error && <p className="text-[12px] text-red-300 mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2.5 rounded-2xl text-[12px] font-semibold text-[var(--text-mid)] hover:text-[var(--text-hi)]">Cancelar</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[12px] font-bold text-[var(--text-hi)] bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Registrar
          </button>
        </div>
      </div>
    </div>
  );
}

export function AvailableTab() {
  const [list, setList] = useState<AvailableProperty[] | null>(null);
  const [error, setError] = useState('');
  const [keyFor, setKeyFor] = useState<AvailableProperty | null>(null);
  const [returning, setReturning] = useState<string | null>(null);

  const load = () => api('/api/locacao/available').then(setList).catch((e) => { setError(e.message); setList([]); });
  useEffect(() => { load(); }, []);

  const returnKey = async (keyId: string) => {
    setReturning(keyId);
    try { await api(`/api/locacao/keys/${keyId}/return`, { method: 'PATCH' }); load(); }
    catch (e: any) { setError(e.message); }
    finally { setReturning(null); }
  };

  if (error && !list?.length) {
    return <GlassCard className="!py-12 text-center border-red-400/20">
      <p className="text-[14px] text-red-300">{error}</p>
    </GlassCard>;
  }
  if (!list) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-low)]" /></div>;
  if (!list.length) {
    return <GlassCard className="!py-14 text-center">
      <p className="text-[15px] text-[var(--text-mid)]">Nenhum imóvel disponível no momento.</p>
      <p className="text-[12.5px] text-[var(--text-low)] mt-1">Imóveis com status "disponível" aparecem aqui.</p>
    </GlassCard>;
  }

  const semInteresse = list.filter((p) => p.interessados === 0 || (p.dias_sem_lead !== null && p.dias_sem_lead >= 14));
  const chavesFora = list.filter((p) => p.chave);

  return (
    <div className="space-y-4">
      {/* Resumo do funil de locação */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Disponíveis" value={String(list.length)} hint="aguardando locação" icon={CalendarClock} />
        <Kpi label="Interessados" value={String(list.reduce((s, p) => s + p.interessados, 0))} hint="somando todos" icon={Users} />
        <Kpi label="Visitas marcadas" value={String(list.reduce((s, p) => s + p.visitas_agendadas, 0))} hint="daqui pra frente" icon={CalendarClock} />
        <Kpi label="Chaves fora" value={String(chavesFora.length)}
          hint={chavesFora.some((p) => p.chave?.atrasada) ? 'alguma em atraso' : 'todas no prazo'}
          tone={chavesFora.some((p) => p.chave?.atrasada) ? 'ruim' : 'neutro'} icon={KeyRound} />
      </div>

      {semInteresse.length > 0 && (
        <div className="rounded-2xl bg-amber-500/[0.08] border border-amber-400/20 px-4 py-3">
          <p className="text-[12.5px] text-amber-200">
            <b>{semInteresse.length} imóvel(is)</b> sem interessado novo há duas semanas ou mais — vale revisar preço ou fotos.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {list.map((p) => (
          <GlassCard key={p.id} className="!p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h4 className="text-[14px] font-bold text-[var(--text-hi)] truncate">{p.title}</h4>
                <p className="text-[11.5px] text-[var(--text-low)] truncate">{p.location} · {p.price}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${
                p.dias_vago > 60 ? 'text-red-300 bg-red-500/15' : p.dias_vago > 30 ? 'text-amber-300 bg-amber-500/15' : 'text-[var(--text-mid)] bg-[var(--control-fill)]'
              }`}>{p.dias_vago}d vago</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div className="rounded-xl bg-[var(--control-fill)] py-2">
                <div className="text-[15px] font-bold text-[var(--text-hi)] tabular-nums">{p.interessados}</div>
                <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-low)]">interessados</div>
              </div>
              <div className="rounded-xl bg-[var(--control-fill)] py-2">
                <div className="text-[15px] font-bold text-[var(--text-hi)] tabular-nums">{p.visitas_agendadas}</div>
                <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-low)]">visitas</div>
              </div>
              <div className="rounded-xl bg-[var(--control-fill)] py-2">
                <div className="text-[15px] font-bold text-[var(--text-hi)] tabular-nums">
                  {p.dias_sem_lead === null ? '—' : `${p.dias_sem_lead}d`}
                </div>
                <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-low)]">sem lead</div>
              </div>
            </div>

            {p.proxima_visita && (
              <p className="text-[11.5px] text-[var(--text-mid)] mb-2 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-violet-300" />
                Próxima visita: <b>{p.proxima_visita.cliente}</b>{' '}
                {new Date(p.proxima_visita.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}

            {/* Chave: estado sempre visível, ação sempre a um clique */}
            {p.chave ? (
              <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                p.chave.atrasada ? 'bg-red-500/10 border border-red-400/25' : 'bg-[var(--control-fill)]'
              }`}>
                <div className="min-w-0">
                  <p className={`text-[11.5px] font-semibold ${p.chave.atrasada ? 'text-red-300' : 'text-[var(--text-mid)]'}`}>
                    <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                    Chave com {p.chave.com}
                  </p>
                  {p.chave.prevista_para && (
                    <p className="text-[10.5px] text-[var(--text-low)]">
                      {p.chave.atrasada ? 'Era para voltar ' : 'Volta '}
                      {new Date(p.chave.prevista_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <button onClick={() => returnKey(p.chave!.id)} disabled={returning === p.chave.id}
                  className="shrink-0 text-[11px] font-bold text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                  {returning === p.chave.id ? '...' : 'Devolvida'}
                </button>
              </div>
            ) : (
              <button onClick={() => setKeyFor(p)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11.5px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors">
                <KeyRound className="w-3.5 h-3.5" /> Entregar chave
              </button>
            )}
          </GlassCard>
        ))}
      </div>

      {keyFor && <KeyModal property={keyFor} onClose={() => setKeyFor(null)} onSaved={load} />}
    </div>
  );
}
