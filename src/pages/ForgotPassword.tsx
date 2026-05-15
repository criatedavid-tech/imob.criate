import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Home, Mail, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

const inputClass =
  'block w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col justify-center py-12 px-4 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center
            backdrop-blur-md bg-white/15 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
            <Home className="text-white w-7 h-7" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-extrabold text-white tracking-tight">Recuperar senha</h2>
        <p className="mt-2 text-center text-sm text-white/50">
          Lembrou a senha?{' '}
          <Link to="/login" className="font-semibold text-violet-300 hover:text-violet-200 transition-colors">Entrar</Link>
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="relative z-10 mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-10 px-8 rounded-3xl
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.3)]">

          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4
                backdrop-blur-md bg-emerald-500/20 border border-emerald-400/30">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Verifique seu e-mail</h3>
              <p className="text-sm text-white/60 mb-4 leading-relaxed">
                Se <strong className="text-white/80">{email}</strong> estiver cadastrado, você receberá um link para redefinir sua senha em instantes.
              </p>
              <p className="text-xs text-white/30 mb-6">Não recebeu? Verifique a caixa de spam ou tente novamente.</p>
              <Link to="/login" className="flex items-center justify-center gap-2 text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-sm text-white/50">
                Informe o e-mail cadastrado e enviaremos um link para você criar uma nova senha.
              </p>

              {error && (
                <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-2xl text-sm">{error}</div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                  <input
                    autoFocus type="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    className={`${inputClass} pl-11 pr-4`}
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold text-white
                  transition-all active:scale-[0.99] disabled:opacity-50
                  backdrop-blur-md bg-white/15 border border-white/25
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
                  hover:bg-white/25">
                {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Enviar link de recuperação'}
              </button>

              <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-white/40 hover:text-violet-300 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
