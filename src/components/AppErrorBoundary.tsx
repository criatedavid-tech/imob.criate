import React from 'react';
import { RefreshCcw, TriangleAlert } from 'lucide-react';
import { attemptStaleAssetRecovery } from '../lib/appRecovery';

type State = {
  error: Error | null;
  recovering: boolean;
};

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: false };
  }

  componentDidCatch(error: Error): void {
    const recovering = attemptStaleAssetRecovery(error);
    if (recovering) this.setState({ recovering: true });
    console.error('[App] falha de renderização', { name: error.name, message: error.message });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-bg min-h-screen flex items-center justify-center px-5 font-sans">
        <section className="w-full max-w-md rounded-[28px] border border-[var(--glass-border)] bg-[var(--control-fill-hover)] p-7 text-center shadow-2xl">
          {this.state.recovering ? (
            <RefreshCcw className="mx-auto h-8 w-8 animate-spin text-sky-300" />
          ) : (
            <TriangleAlert className="mx-auto h-9 w-9 text-amber-300" />
          )}
          <h1 className="mt-5 text-xl font-black text-[var(--text-hi)]">
            {this.state.recovering ? 'Atualizando a aplicação' : 'A aplicação precisa ser atualizada'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-mid)]">
            {this.state.recovering
              ? 'Encontramos uma versão mais recente e estamos recuperando sua tela.'
              : 'Não foi possível recuperar a tela automaticamente. Seus dados continuam protegidos.'}
          </p>
          {!this.state.recovering && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-sky-400"
            >
              <RefreshCcw className="h-4 w-4" /> Atualizar agora
            </button>
          )}
        </section>
      </main>
    );
  }
}
