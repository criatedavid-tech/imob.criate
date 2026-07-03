import React from 'react';
import { cn } from '../lib/utils';

// Primitivo liquid glass minimalista — base de todos os cards do canvas.
export function GlassCard({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-[26px] p-6 backdrop-blur-2xl bg-white/[0.06] border border-white/10',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_20px_50px_-24px_rgba(0,0,0,0.6)]',
        onClick && 'cursor-pointer hover:bg-white/[0.09] transition-colors',
        className,
      )}
    >
      {children}
    </div>
  );
}

// Cabeçalho padrão de widget: título discreto + ação opcional.
export function WidgetHeader({ title, action }: { title?: string; action?: React.ReactNode }) {
  if (!title && !action) return null;
  return (
    <div className="flex items-center justify-between mb-4">
      {title && <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">{title}</h3>}
      {action}
    </div>
  );
}
