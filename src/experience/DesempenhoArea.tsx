import React, { useEffect, useState } from 'react';
import { Loader2, TrendingUp, Crown } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { centsToReais } from '../lib/money';

interface PerformanceRow {
  user_id: string;
  name: string;
  is_owner: boolean;
  suspended_at: string | null;
  total_leads: number;
  closed_leads: number;
  conversion_rate: number;
  sales_count: number;
  sales_total_cents: number;
  return_per_lead_cents: number;
}

interface DesempenhoAreaProps {
  onOpenMemberReport?: (member: { id: string; name: string }) => void;
}

// Lista o retorno de cada corretor da equipe num período — só o dono da
// conta vê (GET /api/equipe/performance é titular-only, mesmo espírito do
// card "Ranking" em EquipeArea.tsx). Clicar num corretor abre o detalhe
// dele em Relatórios (mesmo drill-down por member_user_id já usado no
// ícone de gráfico da lista de Equipe).
export function DesempenhoArea({ onOpenMemberReport }: DesempenhoAreaProps = {}) {
  const [months, setMonths] = useState(6);
  const [members, setMembers] = useState<PerformanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    setForbidden(false);
    fetch(`/api/equipe/performance?months=${months}`, { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (r.status === 403) { setForbidden(true); return null; }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar o desempenho.`);
        }
        return r.json();
      })
      .then((data) => { if (data) setMembers(data.members); })
      .catch((e) => setError(e.message || 'Erro ao carregar o desempenho.'))
      .finally(() => setLoading(false));
  }, [months]);

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (forbidden) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Desempenho</h2>
        <GlassCard className="!py-10 text-center">
          <p className="text-[14px] text-[var(--text-low)]">Só quem administra a conta vê o desempenho da equipe.</p>
        </GlassCard>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Desempenho</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const rows = members || [];

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-[var(--text-hi)]">Desempenho</h2>
          <p className="text-[11px] text-[var(--text-low)] mt-1">Retorno de cada corretor no período — clique num nome pra ver o detalhe.</p>
        </div>
        <div className="flex gap-1 p-1 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)]">
          {[3, 6, 12].map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${
                months === m ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)]' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]'
              }`}>
              {m} meses
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <TrendingUp className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)]">Ainda não há corretores na equipe.</p>
        </GlassCard>
      ) : (
        <GlassCard className="!p-2">
          <div className="space-y-1">
            {rows.map((m) => (
              <button key={m.user_id} onClick={() => onOpenMemberReport?.({ id: m.user_id, name: m.name })}
                className="w-full flex items-center justify-between gap-4 px-4 py-3.5 rounded-2xl bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] border border-[var(--hairline)] transition-colors text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold text-[var(--text-hi)] truncate">{m.name}</p>
                    {m.is_owner && <span title="Administrador da conta"><Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" /></span>}
                    {m.suspended_at && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-400/15 text-amber-300 border border-amber-300/25 shrink-0">Suspenso</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-low)] mt-0.5">
                    {m.total_leads} lead{m.total_leads === 1 ? '' : 's'} recebido{m.total_leads === 1 ? '' : 's'} · {m.closed_leads} fechado{m.closed_leads === 1 ? '' : 's'} · {m.conversion_rate}% de conversão
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold cr-money text-[var(--text-hi)]">{centsToReais(m.sales_total_cents)}</p>
                  <p className="text-[11px] text-[var(--text-low)] mt-0.5">
                    {m.total_leads > 0 ? `${centsToReais(m.return_per_lead_cents)} por lead` : 'sem leads no período'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
