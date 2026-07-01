import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { authService } from '../services/auth';

// Modal de re-aceite dos Termos: aparece quando a versão vigente (TERMS_VERSION
// no backend) difere da versão aceita pelo corretor — inclusive quando nunca
// houve aceite registrado (usuários anteriores a este mecanismo).
export default function TermsGate() {
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/terms/status', { headers: authService.getAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.needs_acceptance) setNeedsAcceptance(true); })
      .catch(() => { /* em erro de rede não bloqueia o uso */ });
  }, []);

  const accept = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/terms/accept', {
        method: 'POST',
        headers: authService.getAuthHeaders()
      });
      if (!r.ok) throw new Error('Não foi possível registrar o aceite. Tente novamente.');
      setNeedsAcceptance(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!needsAcceptance) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md rounded-[28px] p-8
          backdrop-blur-2xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_24px_64px_rgba(0,0,0,0.4)]"
      >
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4
          backdrop-blur-md bg-white/15 border border-white/25">
          <FileText className="w-6 h-6 text-white" />
        </div>

        <h2 className="text-xl font-black text-white mb-2">Termos atualizados</h2>
        <p className="text-sm text-white/70 leading-relaxed mb-6">
          Atualizamos nossos{' '}
          <a href="/termos" target="_blank" rel="noopener noreferrer"
            className="font-semibold text-violet-300 hover:text-violet-200 underline">Termos de Uso</a>
          {' '}e a{' '}
          <a href="/privacidade" target="_blank" rel="noopener noreferrer"
            className="font-semibold text-violet-300 hover:text-violet-200 underline">Política de Privacidade</a>.
          Para continuar usando a plataforma, revise os documentos e confirme o aceite da versão vigente.
        </p>

        {error && (
          <p className="text-sm text-red-300 mb-4">{error}</p>
        )}

        <button
          onClick={accept}
          disabled={loading}
          className="w-full py-4 rounded-2xl font-bold text-white backdrop-blur-md
            bg-white/15 border border-white/25 hover:bg-white/25 transition-all
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Registrando…' : 'Li e aceito os termos'}
        </button>
      </motion.div>
    </div>
  );
}
