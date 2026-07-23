import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

// Segmented control Dia/Noite (sol/lua). Trilho tier-1; o thumb é uma LENTE DE
// VIDRO que desliza sobre o ícone ativo (como na referência liquid glass). O
// ícone ativo fica claro por baixo do vidro. Só troca o tema visual.
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
      <button
        type="button"
        onClick={() => pick('light')}
        aria-pressed={theme === 'light'}
        aria-label="Modo dia"
        title="Modo dia"
        className="relative z-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{ color: theme === 'light' ? 'var(--text-hi)' : 'var(--text-low)' }}
      >
        <Sun className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => pick('dark')}
        aria-pressed={theme === 'dark'}
        aria-label="Modo noite"
        title="Modo noite"
        className="relative z-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{ color: theme === 'dark' ? 'var(--text-hi)' : 'var(--text-low)' }}
      >
        <Moon className="w-4 h-4" />
      </button>

      {/* thumb de vidro deslizante — sobre o ícone ativo */}
      <span
        aria-hidden
        className="cr-toggle-glass"
        style={{ left: 4, transform: theme === 'light' ? 'translateX(0)' : 'translateX(32px)' }}
      />
    </div>
  );
}
