import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Mail, Lock, User, Phone, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { authService } from '../services/auth';
import { motion, AnimatePresence } from 'motion/react';

const STEPS = ['Seu nome', 'Telefone', 'Acesso'];

const inputClass =
  'block w-full py-3.5 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

const btnPrimary =
  'flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold text-white ' +
  'transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed group ' +
  'backdrop-blur-md bg-white/15 border border-white/25 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)] hover:bg-white/25';

const btnBack =
  'h-14 px-6 rounded-2xl text-sm font-semibold text-white/60 ' +
  'bg-white/8 border border-white/15 hover:bg-white/15 hover:text-white transition-all';

export default function Signup() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '', phone: '', email: '', password: '', confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const progress = (step / STEPS.length) * 100;
  const next = () => { setError(''); setStep(s => s + 1); };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { setError('Informe seu nome completo.'); return; }
    next();
  };

  const handleStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = formData.phone.replace(/\D/g, '');
    if (digits.length < 10) { setError('Informe um telefone válido.'); return; }
    next();
  };

  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) { setError('As senhas não coincidem.'); return; }
    if (formData.password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await authService.signup(formData.email, formData.password, formData.name, formData.phone);
      if (data?.session?.access_token && data?.user) {
        localStorage.setItem('token', data.session.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/payment');
        return;
      }
      navigate('/login');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    return v;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col items-center justify-center py-12 px-4 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      {/* Logo */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4
          backdrop-blur-md bg-white/15 border border-white/25
          shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
          <Home className="text-white w-7 h-7" />
        </div>
        <h1 className="text-2xl font-black text-white">Crie sua conta</h1>
        <p className="text-sm text-white/50 mt-1">
          Já tem cadastro?{' '}
          <Link to="/login" className="font-semibold text-violet-300 hover:text-violet-200 transition-colors">Entrar</Link>
        </p>
      </motion.div>

      <div className="relative z-10 w-full max-w-md">
        {/* Barra de progresso */}
        <div className="mb-6 px-1">
          <div className="flex justify-between mb-2">
            {STEPS.map((label, i) => (
              <span key={i} className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${i + 1 <= step ? 'text-white' : 'text-white/20'}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden border border-white/10">
            <motion.div
              className="h-full bg-gradient-to-r from-violet-500 to-blue-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="rounded-[32px] px-8 py-10
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.3)]">

          {error && (
            <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-2xl text-sm font-medium mb-5">
              {error}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* STEP 1 — Nome */}
            {step === 1 && (
              <motion.form key="step1"
                initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }} onSubmit={handleStep1} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                    <input autoFocus required value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className={`${inputClass} pl-11 pr-4`}
                      placeholder="Seu nome completo" />
                  </div>
                </div>
                <button type="submit" className={btnPrimary}>
                  Continuar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </motion.form>
            )}

            {/* STEP 2 — Telefone */}
            {step === 2 && (
              <motion.form key="step2"
                initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }} onSubmit={handleStep2} className="space-y-5">
                <div>
                  <p className="text-sm text-white/50 mb-4">
                    Olá, <strong className="text-white">{formData.name.split(' ')[0]}</strong>! Qual é o seu WhatsApp?
                  </p>
                  <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Telefone / WhatsApp</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                    <input autoFocus required type="tel" value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                      className={`${inputClass} pl-11 pr-4`}
                      placeholder="(00) 00000-0000" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className={btnBack}>
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button type="submit" className={btnPrimary}>
                    Continuar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </motion.form>
            )}

            {/* STEP 3 — Email + Senha */}
            {step === 3 && (
              <motion.form key="step3"
                initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }} onSubmit={handleStep3} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                    <input autoFocus type="email" required value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className={`${inputClass} pl-11 pr-4`}
                      placeholder="email@dominio.com" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                      <input type="password" required minLength={6} value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className={`${inputClass} pl-11 pr-4`}
                        placeholder="••••••••" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Confirmar</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                      <input type="password" required value={formData.confirmPassword}
                        onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className={`${inputClass} pl-11 pr-4`}
                        placeholder="••••••••" />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setStep(2)} className={btnBack}>
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button type="submit" disabled={loading} className={btnPrimary}>
                    {loading
                      ? <Loader2 className="animate-spin w-5 h-5" />
                      : <>Criar conta <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                    }
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
