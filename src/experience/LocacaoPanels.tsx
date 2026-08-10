import React, { useEffect, useState } from 'react';
import {
  Loader2, X, KeyRound, Users, CalendarClock, TrendingUp, AlertTriangle,
  CheckCircle2, Bot, Clock, ArrowRightLeft, Sparkles, HandCoins, MessageSquare,
  History, Phone, RotateCcw,
} from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from '../lib/features';

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
  if (!res.ok) throw new Error(data?.details?.[0]?.message || data?.error || `Erro ${res.status}`);
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
  teste_disparo_enviado: { dot: 'bg-cyan-400', label: 'Teste de WhatsApp enviado' },
};

const ACTOR_LABEL: Record<string, string> = { sistema: 'Sistema', ia: 'IA', humano: 'Você' };

export function ContractDiaryModal({ contract, onClose, onChanged }: {
  contract: { id: string; tenant_name: string; tenant_phone?: string | null; autopilot_enabled?: boolean };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [autopilot, setAutopilot] = useState(!!contract.autopilot_enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
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

  const sendTest = async () => {
    if (!contract.tenant_phone) {
      setError('Cadastre o WhatsApp do inquilino antes do teste.');
      return;
    }
    if (!confirm(`Enviar uma mensagem identificada como TESTE para ${contract.tenant_name}? Nenhuma cobrança será criada.`)) return;
    setTesting(true);
    setError('');
    setTestResult('');
    try {
      await api(`/api/locacao/contracts/${contract.id}/test-dispatch`, { method: 'POST' });
      setTestResult('Teste confirmado pelo provedor. Confira o WhatsApp do inquilino.');
      api(`/api/locacao/contracts/${contract.id}/events`).then(setEvents).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Não foi possível enviar o teste.');
    } finally {
      setTesting(false);
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
                {!CLIENT_FINANCIAL_OPERATIONS_ENABLED
                  ? 'A automação financeira está bloqueada na plataforma. Use o teste abaixo para validar somente o canal de WhatsApp.'
                  : autopilot
                  ? 'A cobrança do mês é gerada e enviada sozinha, e a IA responde o inquilino. Casos fora da alçada vêm para você.'
                  : 'Nada é enviado automaticamente. Você gera e cobra manualmente.'}
              </p>
            </div>
            <button onClick={toggleAutopilot} disabled={saving || (!CLIENT_FINANCIAL_OPERATIONS_ENABLED && !autopilot)}
              className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-bold transition-colors disabled:opacity-50 ${
                autopilot ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25' : 'text-[var(--text-mid)] bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)]'
              }`}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {autopilot ? 'Ligado' : 'Desligado'}
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--hairline)] flex flex-wrap items-center gap-3">
            <button onClick={sendTest} disabled={testing || !contract.tenant_phone}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-bold text-cyan-200 bg-cyan-500/12 border border-cyan-400/20 hover:bg-cyan-500/20 disabled:opacity-40">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              {testing ? 'Enviando teste…' : 'Testar WhatsApp'}
            </button>
            <p className="text-[11px] text-[var(--text-low)]">
              Envia uma mensagem marcada como teste, sem boleto, PIX ou mudança na régua.
            </p>
          </div>
          {testResult && <p className="text-[12px] text-emerald-300 mt-2">{testResult}</p>}
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
  visitas_agendadas: number; visitas_realizadas: number;
  proxima_visita: { quando: string; cliente: string } | null;
  chave: { id: string; com: string; telefone: string | null; finalidade: string; prevista_para: string | null; atrasada: boolean } | null;
}

interface PropertyKeyMovement {
  id: string;
  property_id: string;
  holder_name: string;
  holder_phone: string | null;
  purpose: 'visita' | 'vistoria' | 'obra' | 'outro';
  taken_at: string;
  due_at: string | null;
  returned_at: string | null;
  notes: string | null;
}

const keyPurposeLabel: Record<PropertyKeyMovement['purpose'], string> = {
  visita: 'Visita',
  vistoria: 'Vistoria',
  obra: 'Obra / reparo',
  outro: 'Outro',
};

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isValidPhoneInput(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return /^[1-9]\d[2-9]\d{7,8}$/.test(digits) && !/^(\d)\1+$/.test(digits);
}

function formatStoredPhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  return formatPhoneInput(digits);
}

const formatKeyDate = (value: string) => new Date(value).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

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
  const purposeOptions = [
    { value: 'visita', label: 'Visita' },
    { value: 'vistoria', label: 'Vistoria' },
    { value: 'obra', label: 'Obra / reparo' },
    { value: 'outro', label: 'Outro' },
  ];

  const save = async () => {
    if (name.trim().length < 2) { setError('Informe o nome de quem está levando a chave.'); return; }
    if (phone && !isValidPhoneInput(phone)) { setError('Informe um telefone válido com DDD ou deixe o campo vazio.'); return; }
    if (!dueAt || new Date(dueAt).getTime() <= Date.now()) {
      setError('A previsão de devolução deve ser uma data futura.'); return;
    }
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto p-3 sm:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-md" />
      <div role="dialog" aria-modal="true" aria-labelledby="key-modal-title"
        className="relative my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(145deg,rgba(20,31,53,0.96),rgba(10,18,34,0.94))] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
              <KeyRound className="h-5 w-5 text-sky-300" />
            </div>
            <div className="min-w-0">
              <h3 id="key-modal-title" className="text-[17px] font-bold text-[var(--text-hi)]">Entregar chave</h3>
              <p className="mt-0.5 truncate text-[12px] text-[var(--text-low)]">{property.title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[var(--text-low)] transition hover:bg-white/[0.09] hover:text-[var(--text-hi)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="key-holder-name" className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-low)]">Com quem fica</label>
              <input id="key-holder-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} autoFocus maxLength={120}
                placeholder="Nome completo"
                className="h-12 w-full rounded-2xl border border-white/[0.10] bg-white/[0.055] px-4 text-[13px] text-[var(--text-hi)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition placeholder:text-[var(--text-low)] focus:border-sky-300/45 focus:bg-white/[0.075] focus:ring-2 focus:ring-sky-400/10" />
            </div>
            <div>
              <label htmlFor="key-holder-phone" className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-low)]">Telefone <span className="normal-case tracking-normal opacity-70">(opcional)</span></label>
              <input id="key-holder-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="(62) 99999-9999" maxLength={15}
                className="h-12 w-full rounded-2xl border border-white/[0.10] bg-white/[0.055] px-4 text-[13px] text-[var(--text-hi)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition placeholder:text-[var(--text-low)] focus:border-sky-300/45 focus:bg-white/[0.075] focus:ring-2 focus:ring-sky-400/10" />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-low)]">Motivo da retirada</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Motivo da retirada">
              {purposeOptions.map((option) => {
                const selected = purpose === option.value;
                return (
                  <button key={option.value} type="button" onClick={() => setPurpose(option.value)} aria-pressed={selected}
                    className={`min-h-11 rounded-2xl border px-3 py-2 text-[11.5px] font-semibold transition-all ${
                      selected
                        ? 'border-sky-300/45 bg-sky-400/15 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_5px_18px_rgba(14,165,233,0.10)]'
                        : 'border-white/[0.08] bg-white/[0.035] text-[var(--text-mid)] hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-[var(--text-hi)]'
                    }`}>
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="key-due-at" className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-low)]">Previsão de devolução</label>
            <input id="key-due-at" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} required
              className="h-12 w-full min-w-0 rounded-2xl border border-white/[0.10] bg-white/[0.055] px-4 text-[13px] text-[var(--text-hi)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition [color-scheme:dark] focus:border-sky-300/45 focus:bg-white/[0.075] focus:ring-2 focus:ring-sky-400/10" />
          </div>

          <div className="flex gap-2.5 rounded-2xl border border-amber-300/10 bg-amber-300/[0.045] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--text-low)]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/70" />
            <p>Se a chave não voltar no prazo, o responsável recebe um aviso no WhatsApp.</p>
          </div>

          {error && (
            <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.07] bg-black/[0.10] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose}
            className="h-11 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 text-[12px] font-semibold text-[var(--text-mid)] transition hover:bg-white/[0.07] hover:text-[var(--text-hi)]">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-500/25 px-5 text-[12px] font-bold text-sky-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_20px_rgba(14,165,233,0.12)] transition hover:bg-sky-500/35 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Registrar entrega
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyHistoryModal({ property, onClose }: { property: AvailableProperty; onClose: () => void }) {
  const [items, setItems] = useState<PropertyKeyMovement[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/locacao/keys?property_id=${encodeURIComponent(property.id)}`)
      .then(setItems)
      .catch((e: any) => { setError(e.message); setItems([]); });
  }, [property.id]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl max-h-[85vh] overflow-hidden rounded-3xl bg-slate-900 border border-[var(--glass-border)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[var(--hairline)]">
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text-hi)]">Histórico de chaves</h3>
            <p className="text-[12px] text-[var(--text-low)] mt-0.5">{property.title}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar histórico" className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(85vh-82px)] p-4 space-y-3">
          {!items && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-low)]" /></div>}
          {error && <p className="text-[12px] text-red-300 px-2">{error}</p>}
          {items?.length === 0 && !error && (
            <div className="text-center py-10">
              <KeyRound className="w-6 h-6 mx-auto text-[var(--text-low)] mb-2" />
              <p className="text-[13px] text-[var(--text-mid)]">Nenhuma movimentação registrada.</p>
            </div>
          )}
          {items?.map((item) => {
            const phone = formatStoredPhone(item.holder_phone);
            const open = !item.returned_at;
            const overdue = open && !!item.due_at && new Date(item.due_at).getTime() < Date.now();
            return (
              <div key={item.id} className="rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[var(--text-hi)] truncate">{item.holder_name}</p>
                    <p className="text-[11px] text-[var(--text-low)] mt-0.5">
                      {keyPurposeLabel[item.purpose] || 'Outro'} · retirada em {formatKeyDate(item.taken_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${
                    overdue ? 'text-red-300 bg-red-500/15' : open ? 'text-amber-300 bg-amber-500/15' : 'text-emerald-300 bg-emerald-500/15'
                  }`}>
                    {overdue ? 'Em atraso' : open ? 'Em posse' : 'Devolvida'}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-[var(--text-mid)]">
                  {phone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {phone}</p>}
                  {item.due_at && <p>Previsão de devolução: {formatKeyDate(item.due_at)}</p>}
                  {item.returned_at && <p>Devolvida em: {formatKeyDate(item.returned_at)}</p>}
                  {item.notes && <p className="text-[var(--text-low)]">Observação: {item.notes}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConfirmKeyReturnModal({ property, onClose, onConfirm, saving }: {
  property: AvailableProperty; onClose: () => void; onConfirm: () => void; saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-[var(--glass-border)] p-6"
        onClick={(e) => e.stopPropagation()}>
        <RotateCcw className="w-6 h-6 text-emerald-300 mb-3" />
        <h3 className="text-[16px] font-bold text-[var(--text-hi)]">Confirmar devolução?</h3>
        <p className="text-[12.5px] text-[var(--text-mid)] mt-2">
          A chave de <b>{property.title}</b>, atualmente com <b>{property.chave?.com}</b>, será registrada como devolvida agora.
        </p>
        <div className="flex gap-2 justify-end mt-5">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-2xl text-[12px] font-semibold text-[var(--text-mid)]">Cancelar</button>
          <button onClick={onConfirm} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[12px] font-bold text-emerald-200 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar devolução
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
  const [historyFor, setHistoryFor] = useState<AvailableProperty | null>(null);
  const [returnFor, setReturnFor] = useState<AvailableProperty | null>(null);
  const [returning, setReturning] = useState<string | null>(null);

  const load = () => api('/api/locacao/available').then(setList).catch((e) => { setError(e.message); setList([]); });
  useEffect(() => { load(); }, []);

  const returnKey = async (keyId: string) => {
    setReturning(keyId);
    try { await api(`/api/locacao/keys/${keyId}/return`, { method: 'PATCH' }); await load(); setReturnFor(null); }
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
                <div className="text-[15px] font-bold text-[var(--text-hi)] tabular-nums">{p.visitas_realizadas}</div>
                <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-low)]">visitas feitas</div>
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

            {/* Chave: estado atual e histórico ficam separados para evitar devoluções acidentais. */}
            {p.chave ? (
              <div className={`rounded-xl px-3 py-2 ${
                p.chave.atrasada ? 'bg-red-500/10 border border-red-400/25' : 'bg-[var(--control-fill)]'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                  <p className={`text-[11.5px] font-semibold ${p.chave.atrasada ? 'text-red-300' : 'text-[var(--text-mid)]'}`}>
                    <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                    Chave com {p.chave.com}
                  </p>
                  <p className="text-[10.5px] text-[var(--text-low)]">
                    {keyPurposeLabel[p.chave.finalidade as PropertyKeyMovement['purpose']] || 'Outro'}
                    {formatStoredPhone(p.chave.telefone) ? ` · ${formatStoredPhone(p.chave.telefone)}` : ''}
                  </p>
                  {p.chave.prevista_para && (
                    <p className="text-[10.5px] text-[var(--text-low)]">
                      {p.chave.atrasada ? 'Era para voltar ' : 'Volta '}
                      {new Date(p.chave.prevista_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  </div>
                  <span className={`shrink-0 text-[9.5px] font-bold px-2 py-1 rounded-full ${
                    p.chave.atrasada ? 'text-red-300 bg-red-500/15' : 'text-amber-300 bg-amber-500/15'
                  }`}>{p.chave.atrasada ? 'Em atraso' : 'Em posse'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-[var(--hairline)]">
                  <button onClick={() => setReturnFor(p)} disabled={returning === p.chave.id}
                    className="text-[11px] font-bold text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                    Registrar devolução
                  </button>
                  <span className="text-[var(--text-low)]">·</span>
                  <button onClick={() => setHistoryFor(p)} className="text-[11px] font-semibold text-[var(--text-low)] hover:text-[var(--text-hi)]">
                    Ver histórico
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button onClick={() => setKeyFor(p)}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11.5px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors">
                  <KeyRound className="w-3.5 h-3.5" /> Entregar chave
                </button>
                <button onClick={() => setHistoryFor(p)} title="Histórico de chaves" aria-label={`Histórico de chaves de ${p.title}`}
                  className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-[var(--text-low)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)]">
                  <History className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {keyFor && <KeyModal property={keyFor} onClose={() => setKeyFor(null)} onSaved={load} />}
      {historyFor && <KeyHistoryModal property={historyFor} onClose={() => setHistoryFor(null)} />}
      {returnFor?.chave && (
        <ConfirmKeyReturnModal property={returnFor} saving={returning === returnFor.chave.id}
          onClose={() => !returning && setReturnFor(null)} onConfirm={() => returnKey(returnFor.chave!.id)} />
      )}
    </div>
  );
}
