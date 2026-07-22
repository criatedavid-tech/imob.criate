import React from 'react';
import {
  Sparkles, Calendar, MessageCircle, Users, KeyRound, Clock,
  Check, ChevronRight, TrendingUp, Bot, UserPlus, Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { GlassCard, WidgetHeader } from './ui';
import type { WidgetSpec, WidgetType } from './types';

const iconMap: Record<string, React.ReactNode> = {
  calendar: <Calendar className="w-4 h-4" />,
  message: <MessageCircle className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  key: <KeyRound className="w-4 h-4" />,
  clock: <Clock className="w-4 h-4" />,
};

// ── Briefing: a voz humana da IA (sensação de time trabalhando por você) ──
function Briefing({ spec }: { spec: WidgetSpec }) {
  const { greeting, subtitle } = spec.data;
  return (
    <GlassCard className="!p-7">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
          bg-[var(--accent-soft)] border border-[var(--glass-border)]">
          <Sparkles className="w-5 h-5 text-[var(--accent)]" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-[var(--text-hi)] leading-tight">{greeting}</h2>
          <p className="text-[15px] text-[var(--text-mid)] leading-relaxed mt-1 max-w-2xl">{subtitle}</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ── KPIs: pulso do dia em tiles ──
const toneColor: Record<string, string> = {
  up: 'text-[var(--success)]',
  down: 'text-[var(--danger)]',
  hot: 'text-[var(--warning)]',
  neutral: 'text-[var(--text-low)]',
};
function Kpis({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((k, i) => {
        // Valor monetário (VGV, faturamento, comissão…) ganha o latão — o
        // detalhe premium da paleta. Contagens seguem em branco de alto contraste.
        const isMoney = typeof k.value === 'string' && k.value.includes('R$');
        return (
        <div key={i}>
          <GlassCard className="!p-5">
            <p className="text-[12px] font-medium text-[var(--text-low)]">{k.label}</p>
            <p className={`text-3xl font-black mt-2 leading-none ${isMoney ? 'cr-money' : 'text-[var(--text-hi)]'}`}>{k.value}</p>
            <p className={`text-[11px] font-semibold mt-2 ${toneColor[k.tone] || 'text-[var(--text-low)]'}`}>{k.delta}</p>
          </GlassCard>
        </div>
        );
      })}
    </div>
  );
}

// ── Decisões: onde você supervisiona — o coração do modelo ──
// d.onPrimary/d.onGhost (opcionais) são closures reais montadas no cérebro
// (realData.ts) — quando presentes, o clique executa de verdade e não é só
// decoração. Sem elas (persona mock), os botões continuam só visuais.
function Decisions({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  const [busyIdx, setBusyIdx] = React.useState<number | null>(null);

  const run = async (idx: number, fn?: () => void | Promise<void>) => {
    if (!fn || busyIdx !== null) return;
    setBusyIdx(idx);
    try { await fn(); } finally { setBusyIdx(null); }
  };

  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-3">
        {items.map((d, i) => (
          <div key={i} className="rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                bg-[var(--control-fill-hover)] border border-[var(--glass-border)] text-[var(--accent)]">
                {iconMap[d.icon] || <Sparkles className="w-4 h-4" />}
              </div>
              <p className="text-[14px] text-[var(--text-hi)] leading-snug flex-1">{d.text}</p>
            </div>
            <div className="flex gap-2 mt-3 pl-11">
              <button onClick={() => run(i, d.onPrimary)} disabled={busyIdx !== null}
                className="px-4 py-2 rounded-xl text-[13px] font-bold text-[var(--text-hi)]
                bg-[var(--accent-soft)] border border-[var(--accent)] hover:brightness-110 transition-all
                flex items-center gap-1.5 disabled:opacity-50">
                {busyIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {d.primary}
              </button>
              <button onClick={() => run(i, d.onGhost)} disabled={busyIdx !== null}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-[var(--text-mid)]
                hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-50">
                {d.ghost}
              </button>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Conversas ativas: IA atendendo, você assume quando quiser ──
function Conversations({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-2">
        {items.map((c, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl p-3 hover:bg-[var(--control-fill)] transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill-hover)] border border-[var(--glass-border)]">
              {c.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-[var(--text-hi)] truncate">{c.name}</span>
                {c.tag === 'quente' && <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--warning)] bg-[var(--warning-soft)] px-1.5 py-0.5 rounded">quente</span>}
              </div>
              <p className="text-[12px] text-[var(--text-low)] truncate">{c.last}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${
              c.status === 'ia' ? 'text-[var(--accent)] bg-[var(--accent-soft)]' : 'text-[var(--text-low)] bg-[var(--control-fill-hover)]'
            }`}>
              {c.status === 'ia' ? 'IA atendendo' : 'aguarda você'}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// Chip de status do lead: cor semântica (fechado=sucesso, novo=azure, quente=alerta,
// perdido=perigo). Presentacional — só mapeia a string de status existente numa cor.
function leadStatusTone(status: string): string {
  const t = (status || '').toLowerCase();
  if (/fech|ganho|conclu|vendid/.test(t)) return 'text-[var(--success)] bg-[var(--success-soft)]';
  if (/nov|new/.test(t))                  return 'text-[var(--accent)] bg-[var(--accent-soft)]';
  if (/quent|hot/.test(t))                return 'text-[var(--warning)] bg-[var(--warning-soft)]';
  if (/perd|lost|frio|cancel/.test(t))    return 'text-[var(--danger)] bg-[var(--danger-soft)]';
  return 'text-[var(--text-mid)] bg-[var(--control-fill-hover)]';
}

// ── Leads recentes: dado real (lead da landing/portal), sem fingir ser conversa de WhatsApp ──
function LeadsList({ spec, onAreaClick }: { spec: WidgetSpec; onAreaClick?: (area: string) => void }) {
  const items = spec.data as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-2">
        {items.map((l, i) => (
          <div key={i} onClick={() => onAreaClick?.('negocios')}
            className="flex items-center gap-3 rounded-2xl p-3 hover:bg-[var(--control-fill)] transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill-hover)] border border-[var(--glass-border)]">
              {(l.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[14px] font-semibold text-[var(--text-hi)] truncate block">{l.name}</span>
              <p className="text-[12px] text-[var(--text-low)] truncate">{l.property}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${leadStatusTone(l.status)}`}>
              {l.status}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Estado vazio honesto: sem lead/imóvel/visita ainda, sem fingir atividade ──
function EmptyState({ spec }: { spec: WidgetSpec }) {
  return (
    <GlassCard className="!py-10 text-center">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-4
        bg-[var(--control-fill)] border border-[var(--hairline)]">
        <UserPlus className="w-5 h-5 text-[var(--accent)]" />
      </div>
      <p className="text-[14px] text-[var(--text-mid)] max-w-sm mx-auto">{spec.data.text}</p>
    </GlassCard>
  );
}

// ── Funil ──
function Funnel({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  const max = Math.max(...items.map((s) => s.count));
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-3">
        {items.map((s, i) => (
          <div key={i}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-[var(--text-mid)]">{s.stage}</span>
              <span className="text-[var(--text-hi)] font-semibold">{s.count}</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--control-fill)] overflow-hidden">
              <div className="h-full rounded-full"
                style={{ background: 'var(--accent-gradient)', width: `${(s.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Sua equipe de IA: reforça "um time trabalhando por você" ──
function AiTeam({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-3">
        {items.map((m, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0
              bg-[var(--control-fill-hover)] border border-[var(--glass-border)]">
              <Bot className="w-4 h-4 text-[var(--accent)]" />
              {m.on && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-elevated)]" style={{ background: 'var(--success)' }} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[var(--text-hi)] leading-tight">{m.role}</p>
              <p className="text-[12px] text-[var(--text-low)] truncate">{m.doing}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--success)]">ativo</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Equipe (imobiliária) ──
function Team({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-2">
        {items.map((m, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-[var(--control-fill)] transition-colors">
            <div className="relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-[var(--text-hi)]
              bg-[var(--accent-soft)] border border-[var(--glass-border)]">
              {m.name.charAt(0)}
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-elevated)] ${m.on ? 'bg-[var(--success)]' : 'bg-[var(--text-low)]'}`} />
            </div>
            <span className="text-[14px] font-semibold text-[var(--text-hi)] flex-1">{m.name}</span>
            <span className="text-[12px] text-[var(--text-low)]">{m.leads} leads</span>
            <span className="text-[12px] font-bold text-[var(--success)] w-12 text-right">{m.conv}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Ranking ──
function Ranking({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  const max = Math.max(...items.map((s) => s.value));
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} action={<TrendingUp className="w-4 h-4 text-[var(--success)]" />} />
      <div className="space-y-3">
        {items.map((s, i) => (
          <div key={i}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-[var(--text-mid)]">{i + 1}. {s.name}</span>
              <span className="text-[var(--text-hi)] font-semibold">{s.value}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--control-fill)] overflow-hidden">
              <div className="h-full rounded-full"
                style={{ background: 'var(--success)', width: `${(s.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Espelho de vendas (incorporadora) ──
const mirrorColor: Record<string, string> = {
  disponivel: 'bg-[var(--success-soft)] border-[var(--success)] text-[var(--success)]',
  reservado: 'bg-[var(--warning-soft)] border-[var(--warning)] text-[var(--warning)]',
  vendido: 'bg-[var(--control-fill)] border-[var(--hairline)] text-[var(--text-low)]',
};
function SalesMirror({ spec }: { spec: WidgetSpec }) {
  const units = spec.data.units as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} action={
        <div className="flex gap-3 text-[10px]">
          <span className="text-[var(--success)]">● disponível</span>
          <span className="text-[var(--warning)]">● reservado</span>
          <span className="text-[var(--text-low)]">● vendido</span>
        </div>
      } />
      <div className="grid grid-cols-8 sm:grid-cols-10 gap-2">
        {units.map((u, i) => (
          <div key={i} title={`Unidade ${u.n} — ${u.status}`}
            className={`aspect-square rounded-lg border flex items-center justify-center text-[10px] font-bold ${mirrorColor[u.status]}`}>
            {u.n}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Agenda (lista de próximas visitas) ──
function Agenda({ spec, onAreaClick }: { spec: WidgetSpec; onAreaClick?: (area: string) => void }) {
  const items = spec.data as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} />
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} onClick={() => onAreaClick?.('agenda')}
            className="flex items-center gap-3 rounded-2xl p-3 hover:bg-[var(--control-fill)] transition-colors cursor-pointer">
            <div className="text-center shrink-0 w-12">
              <p className="text-[15px] font-black text-[var(--text-hi)] leading-none">{v.time}</p>
            </div>
            <div className="w-px h-8 bg-[var(--hairline-strong)]" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[var(--text-hi)] truncate">{v.who}</p>
              <p className="text-[12px] text-[var(--text-low)] truncate">{v.unit}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--text-low)]" />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Registro: WidgetType → componente. Base da interface generativa. ──
// onAreaClick é opcional — só leadsList/agenda usam, pra levar pra tela manual
// completa (Negócios/Agenda) quando a pessoa clica num item do resumo.
export const REGISTRY: Record<WidgetType, React.FC<{ spec: WidgetSpec; onAreaClick?: (area: string) => void }>> = {
  briefing: Briefing,
  kpis: Kpis,
  decisions: Decisions,
  conversations: Conversations,
  leadsList: LeadsList,
  funnel: Funnel,
  aiteam: AiTeam,
  team: Team,
  ranking: Ranking,
  salesmirror: SalesMirror,
  agenda: Agenda,
  emptyState: EmptyState,
};

// Wrapper com animação de entrada (usado pelo Canvas).
export function WidgetMotion({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
