import React, { useEffect, useState } from 'react';
import {
  Home, MessageCircle, Building2, LayoutGrid, Calendar, KeyRound,
  Layers, Wallet, Users, Megaphone, BarChart3, Settings, Contact, Bot, Bell,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/utils';
import { AREAS } from './engine';
import type { Persona } from './types';
import { authService } from '../services/auth';

// Sino de Lembretes: conta quantos lembretes pendentes já venceram (não
// segue o corretor fora do app — só sinaliza enquanto o rail está montado,
// que é o tempo todo que o /app fica aberto). Falha silenciosa: o badge é
// um extra, nunca pode travar a navegação.
function useDueReminderCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/agenda/visits?event_type=lembrete', { headers: authService.getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const now = Date.now();
        const due = Array.isArray(data)
          ? data.filter((r: any) => r.status === 'pendente' && new Date(r.scheduled_at).getTime() <= now).length
          : 0;
        if (!cancelled) setCount(due);
      } catch {
        // silencioso — ver comentário acima
      }
    }
    check();
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return count;
}

// Badge da Agenda: conta visitas marcadas pela IA de atendimento (N8N,
// booked_by_chatbot) que o corretor ainda não viu. Ao abrir a Agenda, chama
// mark-chatbot-seen e zera na hora. Mesma filosofia do sino de lembretes:
// extra silencioso, nunca trava a navegação.
function useNewChatbotVisitCount(active: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/agenda/visits', { headers: authService.getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const n = Array.isArray(data)
          ? data.filter((r: any) => r.booked_by_chatbot && !r.broker_seen_at).length
          : 0;
        if (!cancelled) setCount(n);
      } catch {
        // silencioso — ver comentário acima
      }
    }
    check();
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (active !== 'agenda') return;
    fetch('/api/agenda/visits/mark-chatbot-seen', { method: 'POST', headers: authService.getAuthHeaders() })
      .catch(() => { /* silencioso — o badge é um extra */ });
    setCount(0);
  }, [active]);

  return count;
}

function RailIcon({ icon, badge }: { icon: React.ReactNode; badge: number }) {
  return (
    <span className="relative inline-flex">
      {icon}
      {badge > 0 && (
        <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500
          text-white text-[9px] font-bold flex items-center justify-center leading-none">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </span>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  hoje: <Home className="w-[18px] h-[18px]" />,
  conversas: <MessageCircle className="w-[18px] h-[18px]" />,
  'assistente-ia': <Bot className="w-[18px] h-[18px]" />,
  carteira: <Building2 className="w-[18px] h-[18px]" />,
  negocios: <LayoutGrid className="w-[18px] h-[18px]" />,
  agenda: <Calendar className="w-[18px] h-[18px]" />,
  contatos: <Contact className="w-[18px] h-[18px]" />,
  lembretes: <Bell className="w-[18px] h-[18px]" />,
  locacao: <KeyRound className="w-[18px] h-[18px]" />,
  lancamentos: <Layers className="w-[18px] h-[18px]" />,
  financeiro: <Wallet className="w-[18px] h-[18px]" />,
  equipe: <Users className="w-[18px] h-[18px]" />,
  divulgacao: <Megaphone className="w-[18px] h-[18px]" />,
  relatorios: <BarChart3 className="w-[18px] h-[18px]" />,
  config: <Settings className="w-[18px] h-[18px]" />,
};

// Rail manual: acesso a TODAS as funções à mão. Progressive disclosure por persona.
// Abaixo de md vira menu hamburger (drawer) — o rail fixo de 92px não cabe em
// tela de celular sem espremer o conteúdo (era o que estava acontecendo).
export function ManualRail({
  persona, active, onSelect, mobileOpen, onMobileClose,
}: {
  persona: Persona;
  active: string;
  onSelect: (key: string) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const areas = AREAS.filter((a) => a.personas.includes(persona));
  const lembretesDue = useDueReminderCount();
  const agendaNew = useNewChatbotVisitCount(active);
  const badgeFor = (key: string) =>
    key === 'lembretes' ? lembretesDue : key === 'agenda' ? agendaNew : 0;

  return (
    <>
      {/* Desktop — rail fixo lateral */}
      <aside className="hidden md:flex w-[92px] shrink-0 h-full flex-col items-center py-5 gap-1 overflow-y-auto
        backdrop-blur-2xl bg-white/[0.04] border-r border-white/10">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-4 shrink-0
          bg-gradient-to-br from-violet-400/40 to-indigo-500/40 border border-white/20">
          <Home className="w-5 h-5 text-white" />
        </div>

        {areas.map((a) => {
          const isActive = active === a.key;
          return (
            <button
              key={a.key}
              onClick={() => onSelect(a.key)}
              className={cn(
                'w-[72px] py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-colors shrink-0',
                isActive ? 'bg-white/[0.12] text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
              )}
            >
              <RailIcon icon={ICONS[a.key]} badge={badgeFor(a.key)} />
              <span className="text-[10px] font-medium leading-none">{a.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Mobile — drawer acionado pelo hamburger na barra superior */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={onMobileClose}
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="absolute left-0 top-0 h-full w-72 flex flex-col p-4
                backdrop-blur-2xl bg-slate-900/95 border-r border-white/12 overflow-y-auto
                shadow-[4px_0_32px_rgba(0,0,0,0.5)]"
            >
              <div className="flex items-center gap-2 mb-6 px-2 pt-1">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0
                  bg-gradient-to-br from-violet-400/40 to-indigo-500/40 border border-white/20">
                  <Home className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-lg text-white">Criate</span>
              </div>

              <div className="flex flex-col gap-1">
                {areas.map((a) => {
                  const isActive = active === a.key;
                  return (
                    <button
                      key={a.key}
                      onClick={() => { onSelect(a.key); onMobileClose?.(); }}
                      className={cn(
                        'w-full px-4 py-3 rounded-2xl flex items-center gap-3 transition-colors',
                        isActive ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]',
                      )}
                    >
                      <RailIcon icon={ICONS[a.key]} badge={badgeFor(a.key)} />
                      <span className="text-[13px] font-semibold">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
