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
          bg-gradient-to-br from-violet-400/30 to-indigo-500/30 border border-white/20">
          <Sparkles className="w-5 h-5 text-violet-200" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white leading-tight">{greeting}</h2>
          <p className="text-[15px] text-white/60 leading-relaxed mt-1 max-w-2xl">{subtitle}</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ── KPIs: pulso do dia em tiles ──
const toneColor: Record<string, string> = {
  up: 'text-emerald-300',
  down: 'text-rose-300',
  hot: 'text-amber-300',
  neutral: 'text-white/40',
};
function Kpis({ spec }: { spec: WidgetSpec }) {
  const items = spec.data as any[];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((k, i) => (
        <div key={i}>
          <GlassCard className="!p-5">
            <p className="text-[12px] font-medium text-white/45">{k.label}</p>
            <p className="text-3xl font-black text-white mt-2 leading-none">{k.value}</p>
            <p className={`text-[11px] font-semibold mt-2 ${toneColor[k.tone] || 'text-white/40'}`}>{k.delta}</p>
          </GlassCard>
        </div>
      ))}
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
          <div key={i} className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                bg-white/10 border border-white/15 text-violet-200">
                {iconMap[d.icon] || <Sparkles className="w-4 h-4" />}
              </div>
              <p className="text-[14px] text-white/80 leading-snug flex-1">{d.text}</p>
            </div>
            <div className="flex gap-2 mt-3 pl-11">
              <button onClick={() => run(i, d.onPrimary)} disabled={busyIdx !== null}
                className="px-4 py-2 rounded-xl text-[13px] font-bold text-white
                bg-violet-500/30 border border-violet-300/30 hover:bg-violet-500/45 transition-colors
                flex items-center gap-1.5 disabled:opacity-50">
                {busyIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {d.primary}
              </button>
              <button onClick={() => run(i, d.onGhost)} disabled={busyIdx !== null}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white/60
                hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">
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
          <div key={i} className="flex items-center gap-3 rounded-2xl p-3 hover:bg-white/[0.05] transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-white
              bg-gradient-to-br from-slate-500/40 to-slate-700/40 border border-white/15">
              {c.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-white truncate">{c.name}</span>
                {c.tag === 'quente' && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-400/15 px-1.5 py-0.5 rounded">quente</span>}
              </div>
              <p className="text-[12px] text-white/45 truncate">{c.last}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${
              c.status === 'ia' ? 'text-violet-200 bg-violet-500/15' : 'text-white/50 bg-white/10'
            }`}>
              {c.status === 'ia' ? 'IA atendendo' : 'aguarda você'}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
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
            className="flex items-center gap-3 rounded-2xl p-3 hover:bg-white/[0.05] transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-white
              bg-gradient-to-br from-slate-500/40 to-slate-700/40 border border-white/15">
              {(l.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[14px] font-semibold text-white truncate block">{l.name}</span>
              <p className="text-[12px] text-white/45 truncate">{l.property}</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 text-white/50 bg-white/10">
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
        bg-white/[0.06] border border-white/12">
        <UserPlus className="w-5 h-5 text-violet-200" />
      </div>
      <p className="text-[14px] text-white/60 max-w-sm mx-auto">{spec.data.text}</p>
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
              <span className="text-white/60">{s.stage}</span>
              <span className="text-white/80 font-semibold">{s.count}</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-400/70 to-indigo-400/70"
                style={{ width: `${(s.count / max) * 100}%` }} />
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
              bg-white/10 border border-white/15">
              <Bot className="w-4 h-4 text-violet-200" />
              {m.on && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-white leading-tight">{m.role}</p>
              <p className="text-[12px] text-white/45 truncate">{m.doing}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">ativo</span>
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
          <div key={i} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-white/[0.05] transition-colors">
            <div className="relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold text-white
              bg-gradient-to-br from-indigo-500/40 to-violet-600/40 border border-white/15">
              {m.name.charAt(0)}
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${m.on ? 'bg-emerald-400' : 'bg-white/30'}`} />
            </div>
            <span className="text-[14px] font-semibold text-white flex-1">{m.name}</span>
            <span className="text-[12px] text-white/45">{m.leads} leads</span>
            <span className="text-[12px] font-bold text-emerald-300 w-12 text-right">{m.conv}</span>
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
      <WidgetHeader title={spec.title} action={<TrendingUp className="w-4 h-4 text-emerald-300" />} />
      <div className="space-y-3">
        {items.map((s, i) => (
          <div key={i}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-white/60">{i + 1}. {s.name}</span>
              <span className="text-white/80 font-semibold">{s.value}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-teal-400/70"
                style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ── Espelho de vendas (incorporadora) ──
const mirrorColor: Record<string, string> = {
  disponivel: 'bg-emerald-400/25 border-emerald-300/30 text-emerald-100',
  reservado: 'bg-amber-400/25 border-amber-300/30 text-amber-100',
  vendido: 'bg-white/[0.04] border-white/10 text-white/30',
};
function SalesMirror({ spec }: { spec: WidgetSpec }) {
  const units = spec.data.units as any[];
  return (
    <GlassCard>
      <WidgetHeader title={spec.title} action={
        <div className="flex gap-3 text-[10px]">
          <span className="text-emerald-200">● disponível</span>
          <span className="text-amber-200">● reservado</span>
          <span className="text-white/30">● vendido</span>
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
            className="flex items-center gap-3 rounded-2xl p-3 hover:bg-white/[0.05] transition-colors cursor-pointer">
            <div className="text-center shrink-0 w-12">
              <p className="text-[15px] font-black text-white leading-none">{v.time}</p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-white truncate">{v.who}</p>
              <p className="text-[12px] text-white/45 truncate">{v.unit}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-white/30" />
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
