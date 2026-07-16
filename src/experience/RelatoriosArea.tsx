import React, { useEffect, useState } from 'react';
import { Loader2, BarChart3, Sparkles } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

interface Summary {
  months: number;
  periodStart: string;
  periodEnd: string;
  scope: 'account' | 'personal';
  totalLeads: number;
  closedLeads: number;
  convertedLeads: number;
  conversionRate: number;
  byStage: Record<string, number>;
  byMonth: { label: string; count: number }[];
  rentalPaidCents: number;
  rentalPaymentsCount: number;
  rentalMonthlyCents: number;
  salesTotalCents: number;
  salesCount: number;
  visitsDone: number;
  visitsScheduled: number;
  visitsCancelled: number;
}

const STAGE_LABEL: Record<string, string> = {
  new: 'Novo', contato: 'Em contato', visita: 'Visita', proposta: 'Proposta', fechado: 'Fechado',
};
const STAGE_ORDER = ['new', 'contato', 'visita', 'proposta', 'fechado'];

// Resumo em linguagem natural montado a partir dos números reais. Não passa
// por LLM: os valores e a frase permanecem determinísticos e auditáveis.
function buildSummaryText(s: Summary): string {
  const leads = s.totalLeads === 0
    ? `Nos últimos ${s.months} meses não entraram leads.`
    : `Nos últimos ${s.months} meses entraram ${s.totalLeads} lead${s.totalLeads === 1 ? '' : 's'}.`;
  const closed = ` ${s.closedLeads} negócio${s.closedLeads === 1 ? '' : 's'} ${s.closedLeads === 1 ? 'foi fechado' : 'foram fechados'} no período.`;
  const conversion = s.totalLeads > 0
    ? ` A coorte captada converteu ${s.convertedLeads} lead${s.convertedLeads === 1 ? '' : 's'} (${s.conversionRate}%).`
    : '';
  const visits = s.visitsScheduled + s.visitsCancelled > 0
    ? ` Houve ${s.visitsScheduled} visita${s.visitsScheduled === 1 ? '' : 's'} válida${s.visitsScheduled === 1 ? '' : 's'}, ${s.visitsDone} realizada${s.visitsDone === 1 ? '' : 's'} e ${s.visitsCancelled} cancelada${s.visitsCancelled === 1 ? '' : 's'}.`
    : '';
  return `${leads}${closed}${conversion}${visits}`;
}

function formatPeriodDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
  const isEmpty = s.totalLeads === 0
    && s.closedLeads === 0
    && s.salesTotalCents === 0
    && s.rentalPaidCents === 0
    && s.rentalMonthlyCents === 0
    && s.visitsScheduled === 0
    && s.visitsCancelled === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-white">Relatórios</h2>
          <p className="text-[11px] text-white/35 mt-1">
            {formatPeriodDate(s.periodStart)} a {formatPeriodDate(s.periodEnd)} · {s.scope === 'account' ? 'visão consolidada da conta' : 'visão pessoal'}
          </p>
        </div>
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
              Resumo automático e determinístico, gerado somente a partir dos números reais do período.
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
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Leads captados</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.totalLeads}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">criados no período</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Negócios fechados</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.closedLeads}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">por data de fechamento</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Conversão da coorte</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.conversionRate}%</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">{s.convertedLeads} dos captados fecharam</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">VGV vendido</p>
              <p className="text-2xl font-black text-white mt-2 leading-none">{centsToReais(s.salesTotalCents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">{s.salesCount} unidade(s) no período</p>
            </GlassCard>
            {s.scope === 'account' && (
              <>
                <GlassCard className="!p-5">
                  <p className="text-[12px] font-medium text-white/45">Aluguéis recebidos</p>
                  <p className="text-2xl font-black text-white mt-2 leading-none">{centsToReais(s.rentalPaidCents)}</p>
                  <p className="text-[11px] font-semibold mt-2 text-white/40">{s.rentalPaymentsCount} pagamento(s) no período</p>
                </GlassCard>
                <GlassCard className="!p-5">
                  <p className="text-[12px] font-medium text-white/45">Carteira mensal ativa</p>
                  <p className="text-2xl font-black text-white mt-2 leading-none">{centsToReais(s.rentalMonthlyCents)}</p>
                  <p className="text-[11px] font-semibold mt-2 text-white/40">posição atual · não acumulada</p>
                </GlassCard>
              </>
            )}
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Visitas válidas</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.visitsScheduled}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">sem canceladas e sem datas futuras</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Visitas realizadas</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.visitsDone}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">status realizado</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Visitas canceladas</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{s.visitsCancelled}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">separadas das visitas válidas</p>
            </GlassCard>
          </div>

          <p className="text-[11px] text-white/30 -mt-2 mb-6">
            VGV é a soma do preço cadastrado das unidades vendidas; não representa comissão nem valor líquido recebido.
          </p>

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
              <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase mb-1">Distribuição atual da coorte</h3>
              <p className="text-[11px] text-white/30 mb-5">Estágio atual dos leads captados dentro do período.</p>
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
