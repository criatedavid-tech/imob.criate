import React from 'react';
import { cn } from '../lib/utils';

// Primitivo liquid glass minimalista — base de todos os cards do canvas.
export function GlassCard({
  className,
  children,
  onClick,
  style,
}: {
  // `key` é consumida pelo React e não chega ao componente em runtime, mas
  // precisa constar no contrato explícito deste function component para a
  // combinação atual de TypeScript + @types/react aceitar listas JSX.
  key?: React.Key;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={cn(
        'rounded-[26px] p-6 backdrop-blur-2xl backdrop-saturate-150 border bg-[var(--card-fill)] border-[var(--hairline)] shadow-[var(--card-shadow)]',
        onClick && 'cursor-pointer hover:bg-[var(--card-fill-hover)] transition-colors',
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
      {title && <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">{title}</h3>}
      {action}
    </div>
  );
}
