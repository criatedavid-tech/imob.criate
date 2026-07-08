import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowUp, Loader2, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { authService } from '../services/auth';
import type { Autonomy, Persona } from './types';

interface ProposedAction {
  type: string;
  [k: string]: any;
}

interface Turn {
  role: 'user' | 'ai';
  text: string;
  proposedAction?: ProposedAction;
  done?: boolean; // ação já confirmada/executada
}

// Camada de comando REAL (Etapa 13): fala do corretor → agente Gemini no
// backend (POST /api/agent/command) que responde, navega ou age sobre os
// endpoints que já existem. A autonomia (Etapa 12) governa: piloto executa na
// hora; copiloto/manual propõem e esperam o "Confirmar".
export function CommandBar({
  persona,
  autonomy,
  onNavigate,
  onActionDone,
}: {
  persona: Persona;
  autonomy: Autonomy;
  onNavigate: (area: string) => void;
  onActionDone: () => void;
}) {
  const [value, setValue] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const pushTurn = (t: Turn) => setTurns((cur) => [...cur.slice(-8), t]);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    // Histórico ANTES de empurrar o turno atual — o backend só precisa do que
    // já aconteceu antes desta mensagem, senão a IA esquece o que foi dito
    // 1 pergunta atrás (ex.: nome do cliente antes da data da visita).
    const history = turns.map(({ role, text }) => ({ role, text }));
    setValue('');
    pushTurn({ role: 'user', text: v });
    setBusy(true);
    try {
      const res = await fetch('/api/agent/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ message: v, persona, autonomy, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao falar com a IA.');

      pushTurn({
        role: 'ai',
        text: data.executed ? `${data.reply}\n✓ ${data.executed}` : data.reply,
        proposedAction: data.proposedAction,
      });

      if (data.navigate) onNavigate(data.navigate);
      if (data.refresh) onActionDone();
    } catch (e: any) {
      pushTurn({ role: 'ai', text: e.message || 'Erro ao falar com a IA.' });
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async (idx: number, action: ProposedAction) => {
    setConfirmingIdx(idx);
    try {
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Não consegui concluir.');
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, done: true, proposedAction: undefined, text: `${t.text}\n✓ ${data.executed}` } : t)));
      if (data.navigate) onNavigate(data.navigate);
      if (data.refresh) onActionDone();
    } catch (e: any) {
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, text: `${t.text}\n✗ ${e.message}` } : t)));
    } finally {
      setConfirmingIdx(null);
    }
  };

  const dismissAction = (idx: number) => {
    setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, proposedAction: undefined, text: `${t.text}\n(cancelado)` } : t)));
  };

  const hasThread = turns.length > 0;

  return (
    <div className="pointer-events-none fixed bottom-6 inset-x-0 z-30 flex justify-center px-4">
      <div className="w-full max-w-2xl pointer-events-auto">
        <AnimatePresence>
          {hasThread && (
            <motion.div
              ref={scrollRef}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="mb-3 max-h-[46vh] overflow-y-auto rounded-2xl px-4 py-3 space-y-3
                backdrop-blur-2xl bg-slate-900/60 border border-white/12"
            >
              {turns.map((t, i) => (
                <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
                  <div className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] whitespace-pre-line ${
                    t.role === 'user'
                      ? 'bg-violet-500/25 border border-violet-300/25 text-white'
                      : 'bg-white/[0.06] border border-white/10 text-white/85'
                  }`}>
                    {t.text}
                  </div>
                  {t.proposedAction && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => confirmAction(i, t.proposedAction!)}
                        disabled={confirmingIdx === i}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold text-white
                          bg-emerald-500/25 border border-emerald-300/30 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                      >
                        {confirmingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Confirmar
                      </button>
                      <button
                        onClick={() => dismissAction(i)}
                        disabled={confirmingIdx === i}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white/60
                          bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] transition-colors disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-[13px] text-white/40">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> pensando…
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 rounded-[22px] px-3 py-2.5
          backdrop-blur-2xl bg-white/[0.09] border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_16px_40px_-12px_rgba(0,0,0,0.6)]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-violet-400/40 to-indigo-500/40 border border-white/20">
            <Sparkles className="w-4 h-4 text-violet-100" />
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={busy}
            placeholder="Fale com a IA…  ex: cadastra a Maria 62999998888 no apê centro · quantos leads eu tenho?"
            className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-white/35 disabled:opacity-60"
          />
          <button onClick={submit} disabled={busy}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white
              bg-violet-500/40 border border-violet-300/30 hover:bg-violet-500/60 transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
