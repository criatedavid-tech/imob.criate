import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Mail, Lock, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { authService } from '../services/auth';
import { motion } from 'motion/react';
import Copyright from '../components/Copyright';

const inputClass =
  'block w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authService.login(email, password);
      // Destino padrão agora é a experiência nova (/app). A trava de assinatura
      // vive no PrivateRoute que embrulha /app — pendente cai em /payment.
      window.location.replace('/app');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
      {/* Noise texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center
            backdrop-blur-md bg-white/15 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
            <Home className="text-white w-7 h-7" />
          </div>
        </div>
        <h2 className="text-center text-3xl font-extrabold text-white tracking-tight">
          Bem-vindo de volta
        </h2>
        <p className="mt-2 text-center text-sm text-white/50">
          Não tem conta?{' '}
          <Link to="/signup" className="font-semibold text-violet-300 hover:text-violet-200 transition-colors">
            Cadastre-se grátis
          </Link>
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="relative z-10 mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4"
      >
        <div className="py-10 px-8 rounded-3xl
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.3)]">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-4 rounded-2xl text-sm font-medium">
                {error}
              </div>
            )}

            {/* E-mail */}
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/30 pointer-events-none" />
                <input
                  type="email" autoComplete="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  className={`${inputClass} pl-11 pr-4`}
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest pl-1">
                  Senha
                </label>
                <Link to="/forgot-password" className="text-xs text-white/40 hover:text-violet-300 transition-colors">
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/30 pointer-events-none" />
                <input
                  type={showPwd ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} onChange={e => setPassword(e.target.value)}
                  className={`${inputClass} pl-11 pr-11`}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-white/30 hover:text-white/70 transition-colors">
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Botão */}
            <button type="submit" disabled={loading}
              className="w-full h-14 flex justify-center items-center gap-2 rounded-2xl text-base font-bold text-white
                transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed group
                backdrop-blur-md bg-white/15 border border-white/25
                shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
                hover:bg-white/25">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : (
                <>Entrar <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" /></>
              )}
            </button>
          </form>
        </div>
      </motion.div>
      <Copyright className="pb-6" />
    </div>
  );
}
