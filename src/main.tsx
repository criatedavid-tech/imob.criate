import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initTheme} from './lib/theme';
import AppErrorBoundary from './components/AppErrorBoundary';
import {installAppRecovery} from './lib/appRecovery';

// Aplica o tema salvo (padrão: Noite) antes do render pra não piscar.
initTheme();
installAppRecovery();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
