import React, { useEffect, useState } from 'react';
import { Loader2, Target, Users, Pencil } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface Goal {
  goal: number | null;
  progress: number;
}

function GoalEditor({ current, onClose, onSaved }: { current: number | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(current ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    const n = Number(value);
    if (!n || n <= 0) { setError('Informe um número maior que zero.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/equipe/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ deals_goal: n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao salvar a meta.');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar a meta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] p-6">
        <h3 className="text-lg font-bold text-white mb-4">Meta de negócios do mês</h3>
        {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2 mb-4">{error}</div>}
        <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Quantos negócios fechar</label>
        <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="5"
          className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
            focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors mb-5" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Equipe real: só a parte que dá pra construir sem inventar dado (Etapa 9 do
// UX_MASTERPLAN.md) — meta pessoal do mês vs. negócios fechados de verdade
// (leads.closed_at, ver server/routes/leads.ts). Roster de corretores,
// hierarquia/permissões, ranking e distribuição de leads dependem do produto
// suportar múltiplos usuários por conta — hoje é 1 conta = 1 corretor, isso
// não existe. Decisão em aberto, não resolvida aqui.
export function EquipeArea() {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/equipe/goal', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar a meta.`);
        }
        return r.json();
      })
      .then(setGoal)
      .catch((e) => setError(e.message || 'Erro ao carregar a meta.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Equipe</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const pct = goal?.goal ? Math.min(100, Math.round((goal.progress / goal.goal) * 100)) : 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Equipe</h2>

      <GlassCard className="!p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-violet-200" />
            <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Meta do mês</h3>
          </div>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white/70
              bg-white/[0.05] hover:bg-white/[0.1] transition-colors">
            <Pencil className="w-3.5 h-3.5" /> {goal?.goal ? 'Editar' : 'Definir meta'}
          </button>
        </div>

        {goal?.goal ? (
          <>
            <p className="text-3xl font-black text-white leading-none">
              {goal.progress} <span className="text-white/30 text-xl">/ {goal.goal} negócios fechados</span>
            </p>
            <div className="w-full h-2 rounded-full bg-white/[0.06] mt-4 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-400 to-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-[14px] text-white/50">Nenhuma meta definida pra este mês ainda.</p>
        )}
      </GlassCard>

      <GlassCard className="!p-6">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-white/40" />
          <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Ainda não disponível</h3>
        </div>
        <p className="text-[13px] text-white/40 leading-relaxed">
          Cadastro de corretores, hierarquia/permissões, ranking de performance e distribuição automática de leads
          dependem do ImobiFlow suportar múltiplos usuários numa mesma conta — hoje cada conta é de um corretor só.
          Isso é uma decisão de produto em aberto, não uma tela que falta desenhar.
        </p>
      </GlassCard>

      {editing && <GoalEditor current={goal?.goal ?? null} onClose={() => setEditing(false)} onSaved={load} />}
    </div>
  );
}
