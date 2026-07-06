import React, { useEffect, useState } from 'react';
import { Loader2, BarChart3, Sparkles } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

interface Summary {
  months: number;
  totalLeads: number;
  closedLeads: number;
  conversionRate: number;
  byStage: Record<string, number>;
  byMonth: { label: string; count: number }[];
  revenueCents: number;
  rentalMonthlyCents: number;
  salesTotalCents: number;
  visitsDone: number;
  visitsTotal: number;
}

const STAGE_LABEL: Record<string, string> = {
  new: 'Novo', contato: 'Em contato', visita: 'Visita', proposta: 'Proposta', fechado: 'Fechado',
};
const STAGE_ORDER = ['new', 'contato', 'visita', 'proposta', 'fechado'];

// Resumo em linguagem natural montado a partir dos números reais (determinístico,
// não inventa). A versão "a IA escreve o relatório" pluga no agente Gemini
// (server/services/agent.ts) quando a chave de IA tiver cota.
function buildSummaryText(s: Summary): string {
  if (s.totalLeads === 0) {
    return `Nos últimos ${s.months} meses ainda não entraram leads. Assim que os primeiros contatos chegarem, o relatório ganha vida aqui.`;
  }
  const conv = `${s.conversionRate}%`;
  const visitasFrase = s.visitsTotal > 0
    ? ` Você teve ${s.visitsTotal} visita${s.visitsTotal === 1 ? '' : 's'} agendada${s.visitsTotal === 1 ? '' : 's'}, ${s.visitsDone} realizada${s.visitsDone === 1 ? '' : 's'}.`
    : '';
  return `Nos últimos ${s.months} meses entraram ${s.totalLeads} lead${s.totalLeads === 1 ? '' : 's'}, e ${s.closedLeads} fechou${s.closedLeads === 1 ? '' : 'ram'} (conversão de ${conv}).${visitasFrase}`;
}

export function RelatoriosArea() {
  const [months, setMonths] = useState(6);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/relatorios/summary?months=${months}`, { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar o relatório.`);
        }
        return r.json();
      })
      .then(setSummary)
      .catch((e) => setError(e.message || 'Erro ao carregar o relatório.'))
      .finally(() => setLoading(false));
  }, [months]);

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Relatórios</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const s = summary!;
  const maxMonth = Math.max(1, ...s.byMonth.map((m) => m.count));
  const maxStage = Math.max(1, ...STAGE_ORDER.map((k) => s.byStage[k] || 0));
  const isEmpty = s.totalLeads === 0 && s.revenueCents === 0 && s.visitsTotal === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-black text-white">Relatórios</h2>
        <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.05] border border-white/10">
          {[3, 6, 12].map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${
                months === m ? 'bg-white/[0.14] text-white' : 'text-white/45 hover:text-white/75'
              }`}>
              {m} meses
            </button>
          ))}
        </div>
      </div>

      {/* Resumo em linguagem natural (determinístico por enquanto) */}
      <GlassCard className="!p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-violet-400/30 to-indigo-500/30 border border-white/20">
            <Sparkles className="w-5 h-5 text-violet-200" />
          </div>
          <div>
            <p className="text-[15px] text-white/80 leading-relaxed">{buildSummaryText(s)}</p>
            <p className="text-[11px] text-white/30 mt-2">
              Resumo gerado a partir dos seus números reais. A versão escrita pela IA chega quando a assistente estiver ativa.
            </p>
          </div>
        </div>
      </GlassCard>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-white/[0.06] border border-white/12">
            <BarChart3 className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60">Ainda não há dados suficientes no período pra montar os gráficos.</p>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Leads no período</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.totalLeads}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">últimos {s.months} meses</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Negócios fechados</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.closedLeads}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">no período</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Conversão</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.conversionRate}%</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">lead → fechado</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Receita</p>
              <p className="text-2xl font-black text-white mt-2 leading-none">{centsToReais(s.revenueCents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">locação + vendas</p>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Leads por mês */}
            <GlassCard>
              <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase mb-5">Leads por mês</h3>
              <div className="flex items-end justify-between gap-2 h-40">
                {s.byMonth.map((m, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex items-end justify-center" style={{ height: '100%' }}>
                      <div
                        className="w-full max-w-[32px] rounded-t-lg bg-gradient-to-t from-violet-500/40 to-indigo-400/60 border border-white/10"
                        style={{ height: `${Math.round((m.count / maxMonth) * 100)}%`, minHeight: m.count > 0 ? 6 : 0 }}
                        title={`${m.count} lead(s)`}
                      />
                    </div>
                    <span className="text-[10px] text-white/40 capitalize">{m.label}</span>
                    <span className="text-[11px] font-bold text-white/70">{m.count}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Funil por estágio */}
            <GlassCard>
              <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase mb-5">Distribuição no funil</h3>
              <div className="space-y-3">
                {STAGE_ORDER.map((k) => {
                  const count = s.byStage[k] || 0;
                  return (
                    <div key={k}>
                      <div className="flex items-center justify-between text-[12px] mb-1">
                        <span className="text-white/60">{STAGE_LABEL[k]}</span>
                        <span className="text-white/40 font-semibold">{count}</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-indigo-400 transition-all"
                          style={{ width: `${Math.round((count / maxStage) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
