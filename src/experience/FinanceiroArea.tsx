import React, { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

interface Summary {
  rental_monthly_cents: number;
  rental_active_count: number;
  sales_total_cents: number;
  sales_count: number;
}

// Financeiro real: núcleo (Etapa 8 do UX_MASTERPLAN.md) — resumo agregando o
// que já existe em Locação + Lançamentos. Carteira (imf_properties) fica de
// fora: o preço lá é texto livre, não um número confiável de somar.
// Deixado de fora de propósito (dependem de rastrear pagamento de aluguel de
// verdade, que a Etapa 6 não construiu): fluxo de caixa com histórico de
// movimentos, comissão com pagamento real, inadimplência, informe de
// rendimentos do proprietário.
export function FinanceiroArea() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch('/api/financeiro/summary', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar o resumo financeiro.`);
        }
        return r.json();
      })
      .then(setSummary)
      .catch((e) => setError(e.message || 'Erro ao carregar o resumo financeiro.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Financeiro</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = !summary || (summary.rental_active_count === 0 && summary.sales_count === 0);

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Financeiro</h2>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-white/[0.06] border border-white/12">
            <Wallet className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60">
            Nenhum contrato de locação ativo nem unidade vendida ainda — o resumo aparece assim que Locação ou
            Lançamentos tiverem dado real.
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Receita mensal de locação</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{centsToReais(summary!.rental_monthly_cents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">recorrente</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Contratos ativos</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{summary!.rental_active_count}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">locação</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Receita de vendas</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{centsToReais(summary!.sales_total_cents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">lançamentos</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-white/45">Unidades vendidas</p>
              <p className="text-3xl font-black text-white mt-2 leading-none">{summary!.sales_count}</p>
              <p className="text-[11px] font-semibold mt-2 text-white/40">lançamentos</p>
            </GlassCard>
          </div>
          <p className="text-[12px] text-white/30">
            Ainda não incluído: fluxo de caixa com histórico de movimentos, cálculo e pagamento de comissão,
            inadimplência e informe de rendimentos — todos dependem de rastrear pagamento de aluguel de verdade
            (boleto/PIX), que a Locação ainda não faz.
          </p>
        </>
      )}
    </div>
  );
}
