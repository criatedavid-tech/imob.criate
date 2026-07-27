import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Mail, Lock, User, Phone, Loader2, ArrowRight, ArrowLeft, Eye, EyeOff, Building2, Landmark, Check } from 'lucide-react';
import { authService } from '../services/auth';
import { motion, AnimatePresence } from 'motion/react';
import Copyright from '../components/Copyright';

const STEPS = ['Seu perfil', 'Telefone', 'Acesso'];

// O tipo define o "mundo" que a conta enxerga (menus + cockpit). Escolhido aqui,
// no cadastro, e gravado em imf_brokers.account_type — não é mais um toggle no app.
// `popular` só controla o destaque visual do card (Etapa 1); não muda preço.
const ACCOUNT_TYPES = [
  { value: 'corretor',      label: 'Corretor autônomo', desc: 'Trabalho por conta própria',        icon: User,      popular: true  },
  { value: 'imobiliaria',   label: 'Imobiliária',       desc: 'Equipe, locação e carteira',        icon: Building2, popular: false },
  { value: 'incorporadora', label: 'Incorporadora',     desc: 'Lançamentos e espelho de vendas',   icon: Landmark,  popular: false },
] as const;

// Preço/features ainda não diferem por plano de verdade (ver DECISIONS.md) —
// os 3 planos mostram o mesmo preço real vindo de /api/config/plan e a mesma
// lista base de benefícios; só imobiliária/incorporadora ganham a linha extra
// do add-on de WhatsApp por membro, que já existe de verdade no backend.
const PLAN_BASE_FEATURES = [
  'Imóveis ilimitados com landing page exclusiva',
  'Leads capturados automaticamente no CRM',
  'Agente IA respondendo seu WhatsApp 24h',
  'Dashboard com métricas em tempo real',
  '100 atendimentos de IA inclusos por mês',
];

const inputClass =
  'block w-full py-3.5 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-[var(--text-hi)] placeholder:text-[var(--text-low)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-[var(--control-fill-hover)] [color-scheme:dark]';

const btnPrimary =
  'flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold text-[var(--text-hi)] ' +
  'transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed group ' +
  'backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)] ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)] hover:bg-white/25';

const btnBack =
  'h-14 px-6 rounded-2xl text-sm font-semibold text-[var(--text-mid)] ' +
  'bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-all';

export default function Signup() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '', phone: '', email: '', password: '', confirmPassword: '', account_type: 'corretor'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [planPriceDisplay, setPlanPriceDisplay] = useState('49,90');
  const [slotPriceDisplay, setSlotPriceDisplay] = useState('0,00');
  const [billingCycle, setBillingCycle] = useState<'mensal' | 'anual'>('mensal');
  const navigate = useNavigate();

  // Rota pública (sem auth) — preço real vem do backend, nunca hardcoded aqui,
  // mesma fonte que PaymentPending.tsx usa depois do cadastro.
  useEffect(() => {
    fetch('/api/config/plan')
      .then(r => r.json())
      .then(d => {
        if (d?.priceDisplay) setPlanPriceDisplay(d.priceDisplay);
        if (d?.memberWhatsappSlotPriceDisplay) setSlotPriceDisplay(d.memberWhatsappSlotPriceDisplay);
      })
      .catch(() => {});
  }, []);

  const progress = (step / STEPS.length) * 100;
  const next = () => { setError(''); setStep(s => s + 1); };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.account_type) { setError('Escolha o tipo do seu perfil.'); return; }
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
    if (!acceptedTerms) { setError('Você precisa aceitar os Termos de Uso e a Política de Privacidade.'); return; }
    setLoading(true);
    setError('');
    try {
      await authService.signup(formData.email, formData.password, formData.name, formData.phone, formData.account_type);

      // Se o auto-login do signup falhou (session null), faz login explícito
      if (!authService.isLoggedIn()) {
        await authService.login(formData.email, formData.password);
      }

      // Registra o aceite dos Termos (checkbox obrigatório acima) no perfil.
      // Falha aqui não bloqueia o cadastro — o TermsGate cobre no primeiro acesso.
      try {
        await fetch('/api/terms/accept', { method: 'POST', headers: authService.getAuthHeaders() });
      } catch { /* noop */ }

      window.location.replace('/payment');
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
    <div className="min-h-screen app-bg flex flex-col items-center justify-center py-12 px-4 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      {/* Logo */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4
          backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)]
          shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
          <Home className="text-[var(--text-hi)] w-7 h-7" />
        </div>
        <h1 className="text-2xl font-black text-[var(--text-hi)]">Crie sua conta</h1>
        <p className="text-sm text-[var(--text-low)] mt-1">
          Já tem cadastro?{' '}
          <Link to="/login" className="font-semibold text-violet-300 hover:text-violet-200 transition-colors">Entrar</Link>
        </p>
      </motion.div>

      <div className="relative z-10 w-full max-w-3xl">
        {/* Barra de progresso */}
        <div className="mb-6 px-1">
          <div className="flex justify-between mb-2">
            {STEPS.map((label, i) => (
              <span key={i} className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${i + 1 <= step ? 'text-[var(--text-hi)]' : 'text-[var(--text-low)]'}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="h-1.5 bg-[var(--control-fill-hover)] rounded-full overflow-hidden border border-[var(--hairline)]">
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
          backdrop-blur-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)]
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
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <label className="block text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest pl-1">Escolha seu plano</label>
                    <div className="inline-flex items-center rounded-full p-1 bg-[var(--control-fill)] border border-[var(--hairline)] shrink-0">
                      <button type="button" onClick={() => setBillingCycle('mensal')}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                          billingCycle === 'mensal' ? 'bg-gradient-to-r from-violet-500 to-blue-400 text-white' : 'text-[var(--text-low)]'
                        }`}>
                        Mensal
                      </button>
                      <button type="button" onClick={() => setBillingCycle('anual')}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                          billingCycle === 'anual' ? 'bg-gradient-to-r from-violet-500 to-blue-400 text-white' : 'text-[var(--text-low)]'
                        }`}>
                        Anual
                      </button>
                    </div>
                  </div>
                  {billingCycle === 'anual' && (
                    <p className="text-[11px] text-[var(--text-low)] mb-3 pl-1">
                      Cobrança anual chega em breve — hoje é só mensal.
                    </p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {ACCOUNT_TYPES.map(({ value, label, desc, icon: Icon, popular }) => {
                      const selected = formData.account_type === value;
                      const features = value === 'corretor'
                        ? PLAN_BASE_FEATURES
                        : [...PLAN_BASE_FEATURES, `WhatsApp próprio por corretor da equipe (a partir de R$ ${slotPriceDisplay}/mês)`];
                      return (
                        <button key={value} type="button"
                          onClick={() => setFormData({ ...formData, account_type: value })}
                          className={`relative flex flex-col gap-3 p-4 rounded-2xl border text-left transition-all ${
                            selected
                              ? 'bg-[var(--control-fill-hover)] border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                              : 'bg-[var(--control-fill)] border-[var(--hairline-strong)] hover:bg-white/12'
                          } ${popular ? 'border-violet-400/50 ring-1 ring-violet-400/30 shadow-[0_8px_24px_rgba(124,58,237,0.25)]' : ''}`}>
                          {popular && (
                            <span className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest text-white bg-gradient-to-r from-violet-500 to-blue-400 shadow-[0_2px_8px_rgba(124,58,237,0.4)]">
                              Mais popular
                            </span>
                          )}
                          <div className="flex items-center justify-between">
                            <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-violet-500/40' : 'bg-[var(--control-fill-hover)]'}`}>
                              <Icon className="w-4 h-4 text-[var(--text-hi)]" />
                            </span>
                            <span className={`w-4 h-4 rounded-full border shrink-0 ${selected ? 'bg-violet-400 border-violet-300' : 'border-[var(--glass-border-strong)]'}`} />
                          </div>
                          <div>
                            <span className="block text-sm font-bold text-[var(--text-hi)]">{label}</span>
                            <span className="block text-[11px] text-[var(--text-low)]">{desc}</span>
                          </div>
                          <div>
                            <span className="text-xl font-black text-[var(--text-hi)]">R$ {planPriceDisplay}</span>
                            <span className="text-[11px] text-[var(--text-low)]">/mês</span>
                          </div>
                          <ul className="space-y-1.5">
                            {features.map(f => (
                              <li key={f} className="flex items-start gap-1.5 text-[11px] text-[var(--text-mid)] leading-snug">
                                <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="max-w-md mx-auto w-full space-y-5">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-low)] mb-1.5 uppercase tracking-widest pl-1">Nome Completo</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-low)] pointer-events-none" />
                      <input required value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className={`${inputClass} pl-11 pr-4`}
                        placeholder="Seu nome completo" />
                    </div>
                  </div>
                  <button type="submit" className={btnPrimary}>
                    Continuar <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </motion.form>
            )}

            {/* STEP 2 — Telefone */}
            {step === 2 && (
              <motion.form key="step2"
                initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }} onSubmit={handleStep2} className="space-y-5 max-w-md mx-auto">
                <div>
                  <p className="text-sm text-[var(--text-low)] mb-4">
                    Olá, <strong className="text-[var(--text-hi)]">{formData.name.split(' ')[0]}</strong>! Qual é o seu WhatsApp?
                  </p>
                  <label className="block text-[10px] font-bold text-[var(--text-low)] mb-1.5 uppercase tracking-widest pl-1">Telefone / WhatsApp</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-low)] pointer-events-none" />
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
                transition={{ duration: 0.2 }} onSubmit={handleStep3} className="space-y-4 max-w-md mx-auto">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-low)] mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-low)] pointer-events-none" />
                    <input autoFocus type="email" required value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className={`${inputClass} pl-11 pr-4`}
                      placeholder="email@dominio.com" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-low)] mb-1.5 uppercase tracking-widest pl-1">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-low)] pointer-events-none" />
                      <input type={showPwd ? 'text' : 'password'} required minLength={6} value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className={`${inputClass} pl-11 pr-10`}
                        placeholder="••••••••" />
                      <button type="button" onClick={() => setShowPwd(v => !v)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-low)] mb-1.5 uppercase tracking-widest pl-1">Confirmar</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-low)] pointer-events-none" />
                      <input type={showConfirm ? 'text' : 'password'} required value={formData.confirmPassword}
                        onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className={`${inputClass} pl-11 pr-10`}
                        placeholder="••••••••" />
                      <button type="button" onClick={() => setShowConfirm(v => !v)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <label className="flex items-start gap-3 pt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={e => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-violet-500 shrink-0"
                  />
                  <span className="text-xs text-[var(--text-mid)] leading-relaxed">
                    Li e aceito os{' '}
                    <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-300 hover:text-violet-200 underline">Termos de Uso</a>
                    {' '}e a{' '}
                    <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-300 hover:text-violet-200 underline">Política de Privacidade</a>.
                  </span>
                </label>
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
      <Copyright className="pb-6" />
    </div>
  );
}
