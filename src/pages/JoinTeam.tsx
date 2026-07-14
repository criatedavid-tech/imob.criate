import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Home, Mail, Lock, User, Phone, Loader2, ArrowRight, Eye, EyeOff, Users } from 'lucide-react';
import { authService } from '../services/auth';
import { motion } from 'motion/react';
import Copyright from '../components/Copyright';

const inputClass =
  'block w-full py-3.5 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

const btnPrimary =
  'flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold text-white ' +
  'transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed group ' +
  'backdrop-blur-md bg-white/15 border border-white/25 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)] hover:bg-white/25';

export default function JoinTeam() {
  const { code } = useParams<{ code: string }>();
  const [checking, setChecking] = useState(true);
  const [brokerName, setBrokerName] = useState('');
  const [whatsappMode, setWhatsappMode] = useState<'shared' | 'own'>('shared');
  const [inviteError, setInviteError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/auth/join/${code}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || 'Convite inválido.');
        setBrokerName(body.brokerName || 'a conta');
        setWhatsappMode(body.whatsappMode === 'own' ? 'own' : 'shared');
      })
      .catch((e) => setInviteError(e.message || 'Convite inválido.'))
      .finally(() => setChecking(false));
  }, [code]);

  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return; }
    setLoading(true);
    setError('');
    try {
      await authService.join(code!, name, phone, email, password);
      if (!authService.isLoggedIn()) {
        await authService.login(email, password);
      }
      window.location.replace('/app');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col items-center justify-center py-12 px-4 font-sans relative overflow-hidden">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4
          backdrop-blur-md bg-white/15 border border-white/25
          shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
          <Users className="text-white w-7 h-7" />
        </div>
        <h1 className="text-2xl font-black text-white">Entrar na equipe</h1>
        {!checking && !inviteError && (
          <>
            <p className="text-sm text-white/50 mt-1">Você foi convidado pra <strong className="text-white">{brokerName}</strong></p>
            <p className="text-[12px] text-white/35 mt-1">
              {whatsappMode === 'own'
                ? 'Você vai conectar seu próprio número de WhatsApp depois de entrar.'
                : 'Você vai usar o WhatsApp já conectado nessa conta.'}
            </p>
          </>
        )}
      </motion.div>

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-[32px] px-8 py-10
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.3)]">

          {checking ? (
            <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 text-white/50 animate-spin" /></div>
          ) : inviteError ? (
            <div className="text-center">
              <p className="text-sm text-red-300 mb-4">{inviteError}</p>
              <Link to="/login" className="text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors">Ir para o login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-2xl text-sm font-medium">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Nome completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                  <input required value={name} onChange={(e) => setName(e.target.value)}
                    className={`${inputClass} pl-11 pr-4`} placeholder="Seu nome completo" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Telefone / WhatsApp</label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                  <input required type="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))}
                    className={`${inputClass} pl-11 pr-4`} placeholder="(00) 00000-0000" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className={`${inputClass} pl-11 pr-4`} placeholder="email@dominio.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                    <input required minLength={6} type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                      className={`${inputClass} pl-11 pr-10`} placeholder="••••••••" />
                    <button type="button" onClick={() => setShowPwd((v) => !v)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/30 hover:text-white/70 transition-colors">
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Confirmar</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                    <input required type={showPwd ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`${inputClass} pl-11 pr-4`} placeholder="••••••••" />
                  </div>
                </div>
              </div>
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <>Entrar na equipe <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>}
              </button>
            </form>
          )}
        </div>
      </div>
      <Copyright className="pb-6" />
    </div>
  );
}
