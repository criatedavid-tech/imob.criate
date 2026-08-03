import React, { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

interface SalesByDevelopment {
  id: string;
  name: string;
  sales_total_cents: number;
  sales_count: number;
}

interface PaymentRow {
  id: string;
  tenant_name: string | null;
  amount_cents: number;
  amount_paid_cents?: number;
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'negotiated' | 'canceled' | 'failed';
  due_date: string;
  paid_at: string | null;
  reference_month: string;
}

interface Summary {
  rental_monthly_cents: number;
  rental_active_count: number;
  rental_overdue_count: number;
  rental_overdue_cents: number;
  rental_paid_this_month_cents: number;
  sales_total_cents: number;
  sales_count: number;
  sales_by_development?: SalesByDevelopment[];
  recent_payments?: PaymentRow[];
}

const PAYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Pago', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  pending: { label: 'Pendente', cls: 'bg-amber-400/15 text-amber-200 border-amber-300/20' },
  partial: { label: 'Parcial', cls: 'bg-sky-400/15 text-sky-200 border-sky-300/20' },
  overdue: { label: 'Atrasado', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
  negotiated: { label: 'Negociado', cls: 'bg-violet-400/15 text-violet-200 border-violet-300/20' },
  canceled: { label: 'Cancelado', cls: 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
};

// Financeiro real: núcleo (Etapa 8 do UX_MASTERPLAN.md) — resumo agregando o
// que já existe em Locação + Lançamentos, incluindo competências e pagamentos
// externos declarados (ver server/routes/financeiro.ts). Não representa
// conciliação bancária nem custódia pelo ImobiFlow.
// Carteira (imf_properties) fica de fora: o preço lá é texto livre, não um
// número confiável de somar. Ainda fora: comissão com pagamento real e
// informe de rendimentos do proprietário (dependem de um cadastro de
// comissão/regra fiscal que não existe ainda).
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
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Financeiro</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = !summary || (summary.rental_active_count === 0 && summary.sales_count === 0);
  const payments = summary?.recent_payments || [];

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Financeiro</h2>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Wallet className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)]">
            Nenhum contrato de locação ativo nem unidade vendida ainda — o resumo aparece assim que Locação ou
            Lançamentos tiverem dado real.
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-[var(--text-low)]">Carteira mensal de locação</p>
              <p className="text-2xl font-black cr-money mt-2 leading-tight break-words">{centsToReais(summary!.rental_monthly_cents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-[var(--text-low)]">recorrente</p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-[var(--text-low)]">Recebimento registrado no mês</p>
              <p className="text-2xl font-black cr-money mt-2 leading-tight break-words">{centsToReais(summary!.rental_paid_this_month_cents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-[var(--text-low)]">informado pela imobiliária</p>
            </GlassCard>
            <GlassCard className={`!p-5 ${summary!.rental_overdue_count > 0 ? 'ring-1 ring-red-400/25' : ''}`}>
              <p className="text-[12px] font-medium text-[var(--text-low)]">Inadimplência</p>
              <p className={`text-2xl font-black mt-2 leading-tight break-words ${summary!.rental_overdue_count > 0 ? 'text-red-300' : 'text-[var(--text-hi)]'}`}>
                {centsToReais(summary!.rental_overdue_cents)}
              </p>
              <p className="text-[11px] font-semibold mt-2 text-[var(--text-low)]">
                {summary!.rental_overdue_count} contrato{summary!.rental_overdue_count === 1 ? '' : 's'} atrasado{summary!.rental_overdue_count === 1 ? '' : 's'}
              </p>
            </GlassCard>
            <GlassCard className="!p-5">
              <p className="text-[12px] font-medium text-[var(--text-low)]">Receita de vendas</p>
              <p className="text-2xl font-black cr-money mt-2 leading-tight break-words">{centsToReais(summary!.sales_total_cents)}</p>
              <p className="text-[11px] font-semibold mt-2 text-[var(--text-low)]">{summary!.sales_count} unidade{summary!.sales_count === 1 ? '' : 's'}</p>
            </GlassCard>
          </div>

          {summary!.sales_by_development && summary!.sales_by_development.length > 0 && (
            <GlassCard className="!p-5 mb-6">
              <p className="text-[12px] font-semibold text-[var(--text-low)] uppercase tracking-wide mb-3">Receita de vendas por empreendimento</p>
              <div className="space-y-2">
                {summary!.sales_by_development.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                    <span className="text-[13px] font-semibold text-[var(--text-hi)]">{d.name}</span>
                    <span className="text-[13px] text-[var(--text-low)]">
                      {centsToReais(d.sales_total_cents)} <span className="text-[var(--text-low)]">· {d.sales_count} unidade{d.sales_count === 1 ? '' : 's'}</span>
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {payments.length > 0 && (
            <GlassCard className="!p-5 mb-6">
              <p className="text-[12px] font-semibold text-[var(--text-low)] uppercase tracking-wide mb-3">Controle declarado — aluguel (últimos meses)</p>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)]">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--text-hi)] truncate">{p.tenant_name || 'Inquilino'}</p>
                      <p className="text-[11px] text-[var(--text-low)]">
                        venc. {new Date(`${p.due_date}T12:00:00`).toLocaleDateString('pt-BR')}
                        {p.paid_at && ` · pago em ${new Date(p.paid_at).toLocaleDateString('pt-BR')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-[13px] font-semibold text-[var(--text-hi)]">
                        {p.amount_paid_cents ? `${centsToReais(p.amount_paid_cents)} / ` : ''}{centsToReais(p.amount_cents)}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${PAYMENT_LABEL[p.status]?.cls || 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]'}`}>
                        {PAYMENT_LABEL[p.status]?.label || p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          <p className="text-[12px] text-[var(--text-low)]">
            Ainda não incluído: cálculo e pagamento de comissão, e informe de rendimentos do proprietário —
            dependem de um cadastro de comissão/regra fiscal que ainda não existe.
          </p>
        </>
      )}
    </div>
  );
}
