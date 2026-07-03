import React from 'react';
import {
  Home, MessageCircle, Building2, LayoutGrid, Calendar, KeyRound,
  Layers, Wallet, Users, Megaphone, BarChart3, Settings,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { AREAS } from './engine';
import type { Persona } from './types';

const ICONS: Record<string, React.ReactNode> = {
  hoje: <Home className="w-[18px] h-[18px]" />,
  conversas: <MessageCircle className="w-[18px] h-[18px]" />,
  carteira: <Building2 className="w-[18px] h-[18px]" />,
  negocios: <LayoutGrid className="w-[18px] h-[18px]" />,
  agenda: <Calendar className="w-[18px] h-[18px]" />,
  locacao: <KeyRound className="w-[18px] h-[18px]" />,
  lancamentos: <Layers className="w-[18px] h-[18px]" />,
  financeiro: <Wallet className="w-[18px] h-[18px]" />,
  equipe: <Users className="w-[18px] h-[18px]" />,
  divulgacao: <Megaphone className="w-[18px] h-[18px]" />,
  relatorios: <BarChart3 className="w-[18px] h-[18px]" />,
  config: <Settings className="w-[18px] h-[18px]" />,
};

// Rail manual: acesso a TODAS as funções à mão. Progressive disclosure por persona.
export function ManualRail({
  persona, active, onSelect,
}: {
  persona: Persona;
  active: string;
  onSelect: (key: string) => void;
}) {
  const areas = AREAS.filter((a) => a.personas.includes(persona));
  return (
    <aside className="w-[92px] shrink-0 h-full flex flex-col items-center py-5 gap-1 overflow-y-auto
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
            {ICONS[a.key]}
            <span className="text-[10px] font-medium leading-none">{a.label}</span>
          </button>
        );
      })}
    </aside>
  );
}
