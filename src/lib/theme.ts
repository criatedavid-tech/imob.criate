// Tema visual "Cristal": Noite (dark, padrão/identidade) e Dia (light "Vitrine").
// Só troca a aparência — escreve data-theme no <html>; os tokens de cor
// (src/index.css) reagem a isso. Persiste a escolha em localStorage.

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cristal-theme';

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

// Troca com cross-fade suave (classe temporária no <html>, removida após a transição).
export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  root.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* modo privado: só não persiste */ }
  window.setTimeout(() => root.classList.remove('theme-transition'), 380);
}

// Chamado uma vez no boot (main.tsx), antes do render, pra não haver flash.
// Padrão = Noite (a identidade do app). Sem preferência salva, começa dark.
export function initTheme(): void {
  document.documentElement.setAttribute('data-theme', getStoredTheme() ?? 'dark');
}
