import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Mail, Lock, User, Phone, Loader2, ArrowRight } from 'lucide-react';
import { authService } from '../services/auth';
import { motion, AnimatePresence } from 'motion/react';

const STEPS = ['Seu nome', 'Telefone', 'Acesso'];

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
    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (formData.password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
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
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center py-12 px-4 font-sans">
      {/* Logo */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
        <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4">
          <Home className="text-white w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-[#1A1A1A]">Crie sua conta</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Já tem cadastro?{' '}
          <Link to="/login" className="font-semibold text-black hover:underline underline-offset-4">Entrar</Link>
        </p>
      </motion.div>

      <div className="w-full max-w-md">
        {/* Barra de progresso */}
        <div className="mb-6 px-1">
          <div className="flex justify-between mb-2">
            {STEPS.map((label, i) => (
              <span key={i} className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${i + 1 <= step ? 'text-black' : 'text-[#D1D5DB]'}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-black rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[32px] border border-[#E5E7EB] shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-8 py-10">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-2xl text-sm font-medium border border-red-100 mb-5">
              {error}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* STEP 1 — Nome */}
            {step === 1 && (
              <motion.form key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} onSubmit={handleStep1} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                    <input
                      autoFocus required
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="block w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                      placeholder="Seu nome completo"
                    />
                  </div>
                </div>
                <button type="submit" className="w-full h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all shadow-lg shadow-black/10 group">
                  Continuar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </motion.form>
            )}

            {/* STEP 2 — Telefone */}
            {step === 2 && (
              <motion.form key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} onSubmit={handleStep2} className="space-y-5">
                <div>
                  <p className="text-sm text-[#6B7280] mb-4">Olá, <strong className="text-[#1A1A1A]">{formData.name.split(' ')[0]}</strong>! Qual é o seu WhatsApp?</p>
                  <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Telefone / WhatsApp</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                    <input
                      autoFocus required type="tel"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                      className="block w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className="h-14 px-6 border border-[#E5E7EB] rounded-2xl text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] transition-all">
                    Voltar
                  </button>
                  <button type="submit" className="flex-1 h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all shadow-lg shadow-black/10 group">
                    Continuar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </motion.form>
            )}

            {/* STEP 3 — Email + Senha */}
            {step === 3 && (
              <motion.form key="step3" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }} onSubmit={handleStep3} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                    <input
                      autoFocus type="email" required
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className="block w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                      placeholder="email@dominio.com"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                      <input
                        type="password" required minLength={6}
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className="block w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Confirmar</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                      <input
                        type="password" required
                        value={formData.confirmPassword}
                        onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className="block w-full pl-11 pr-4 py-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setStep(2)} className="h-14 px-6 border border-[#E5E7EB] rounded-2xl text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] transition-all">
                    Voltar
                  </button>
                  <button type="submit" disabled={loading} className="flex-1 h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all disabled:opacity-50 shadow-lg shadow-black/10 group">
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <>Criar conta <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>}
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
