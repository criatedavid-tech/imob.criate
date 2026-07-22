import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

// Segmented control Dia/Noite (sol/lua). Trilho de vidro tier-1; o thumb
// desliza com --accent-gradient sob o ícone ativo. Só troca o tema visual.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  const pick = (t: Theme) => { setTheme(t); setThemeState(t); };

  return (
    <div
      role="group"
      aria-label="Alternar tema claro e escuro"
      className={`relative inline-flex items-center rounded-full p-1 border ${className}`}
      style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}
    >
      {/* thumb deslizante */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 w-8 rounded-full transition-transform duration-300"
        style={{
          left: 4,
          background: 'var(--accent-gradient)',
          transform: theme === 'light' ? 'translateX(0)' : 'translateX(32px)',
          transitionTimingFunction: 'var(--ease-spring)',
        }}
      />
      <button
        type="button"
        onClick={() => pick('light')}
        aria-pressed={theme === 'light'}
        aria-label="Modo dia"
        title="Modo dia"
        className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{ color: theme === 'light' ? 'var(--on-accent)' : 'var(--text-low)' }}
      >
        <Sun className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => pick('dark')}
        aria-pressed={theme === 'dark'}
        aria-label="Modo noite"
        title="Modo noite"
        className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{ color: theme === 'dark' ? 'var(--on-accent)' : 'var(--text-low)' }}
      >
        <Moon className="w-4 h-4" />
      </button>
    </div>
  );
}
