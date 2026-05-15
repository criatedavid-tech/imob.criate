import React, { useState } from 'react';
import { Home, CreditCard, Lock, Loader2, CheckCircle2, XCircle, User, Hash } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';

interface CardForm {
  cpfCnpj: string;
  cardHolder: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

const BENEFITS = [
  'Imóveis ilimitados com landing page exclusiva',
  'Leads capturados automaticamente no CRM',
  'Agente IA respondendo seu WhatsApp 24h',
  'Dashboard com métricas em tempo real',
];

const inputClass =
  'w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium text-white placeholder:text-white/30 ' +
  'bg-white/10 border border-white/15 focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

export default function PaymentPending() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acceptedRecurring, setAcceptedRecurring] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [form, setForm] = useState<CardForm>({
    cpfCnpj: '', cardHolder: '', cardNumber: '',
    expiryMonth: '', expiryYear: '', cvv: ''
  });

  const set = (field: keyof CardForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const formatCard = (v: string) =>
    v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  const formatCpfCnpj = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11)
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4').replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3').replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5').replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4').replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3').replace(/(\d{2})(\d{1,3})/, '$1.$2');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/api/checkout', {
        method: 'POST',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpfCnpj: form.cpfCnpj.replace(/\D/g, ''),
          cardHolder: form.cardHolder,
          cardNumber: form.cardNumber.replace(/\s/g, ''),
          expiryMonth: form.expiryMonth,
          expiryYear: form.expiryYear,
          cvv: form.cvv
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro ao processar pagamento');
      navigate('/payment/success');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col items-center justify-start py-10 px-4 font-sans relative overflow-hidden">
      {/* Noise texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-lg"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4
            backdrop-blur-md bg-white/15 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
            <Home className="text-white w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-white">Ative seu plano</h1>
          <p className="text-white/50 text-sm mt-1">Preencha os dados do cartão para começar</p>
        </div>

        {/* Preço + benefícios */}
        <div className="rounded-3xl p-6 mb-5
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="text-3xl font-black text-white">R$ 5</span>
              <span className="text-white/50 text-sm">/mês</span>
            </div>
            <span className="text-xs text-white/50 bg-white/10 border border-white/15 px-3 py-1.5 rounded-full">
              Cancele quando quiser
            </span>
          </div>
          <div className="space-y-2.5">
            {BENEFITS.map(b => (
              <div key={b} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm text-white/70">{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="rounded-3xl p-6 space-y-4
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">

          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-white/30" />
            <span className="text-xs text-white/40 font-medium">Pagamento seguro — seus dados são criptografados</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-2xl text-sm">
              <XCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* CPF/CNPJ */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CPF / CNPJ</label>
            <div className="relative">
              <Hash className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                required
                value={form.cpfCnpj}
                onChange={e => setForm(f => ({ ...f, cpfCnpj: formatCpfCnpj(e.target.value) }))}
                className={`${inputClass} pl-11 pr-4`}
                placeholder="000.000.000-00"
              />
            </div>
          </div>

          {/* Nome no cartão */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Nome no Cartão</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                required
                value={form.cardHolder}
                onChange={set('cardHolder')}
                className={`${inputClass} pl-11 pr-4`}
                placeholder="Como aparece no cartão"
              />
            </div>
          </div>

          {/* Número do cartão */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Número do Cartão</label>
            <div className="relative">
              <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                required
                value={form.cardNumber}
                onChange={e => setForm(f => ({ ...f, cardNumber: formatCard(e.target.value) }))}
                className={`${inputClass} pl-11 pr-4 tracking-widest`}
                placeholder="0000 0000 0000 0000"
                maxLength={19}
              />
            </div>
          </div>

          {/* Validade + CVV */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Mês</label>
              <input
                required
                value={form.expiryMonth}
                onChange={set('expiryMonth')}
                maxLength={2}
                className={`${inputClass} px-4 text-center`}
                placeholder="MM"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Ano</label>
              <input
                required
                value={form.expiryYear}
                onChange={set('expiryYear')}
                maxLength={4}
                className={`${inputClass} px-4 text-center`}
                placeholder="AAAA"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CVV</label>
              <input
                required
                value={form.cvv}
                onChange={set('cvv')}
                maxLength={4}
                type="password"
                className={`${inputClass} px-4 text-center`}
                placeholder="•••"
              />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={acceptedRecurring}
                onChange={e => setAcceptedRecurring(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-violet-400 cursor-pointer [color-scheme:dark]"
              />
              <span className="text-[10px] text-white/40 leading-relaxed group-hover:text-white/60 transition-colors">
                Autorizo a cobrança mensal recorrente de <strong className="text-white/70">R$ 5,00</strong> no cartão informado, podendo cancelar a qualquer momento.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={e => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-violet-400 cursor-pointer [color-scheme:dark]"
              />
              <span className="text-[10px] text-white/40 leading-relaxed group-hover:text-white/60 transition-colors">
                Li e aceito os{' '}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-violet-300 font-semibold hover:text-violet-200 transition-colors">
                  Termos de Uso
                </a>
                {' '}e a{' '}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-violet-300 font-semibold hover:text-violet-200 transition-colors">
                  Política de Privacidade
                </a>.
              </span>
            </label>
          </div>

          {/* Botão pagar */}
          <button
            type="submit"
            disabled={loading || !acceptedRecurring || !acceptedTerms}
            className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold mt-2
              transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed
              backdrop-blur-md bg-white/15 border border-white/25 text-white
              shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
              hover:bg-white/25 enabled:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_24px_rgba(0,0,0,0.35)]"
          >
            {loading
              ? <Loader2 className="animate-spin w-5 h-5" />
              : <><CreditCard className="w-5 h-5" /> Pagar R$ 5,00</>
            }
          </button>
        </form>

        <button
          onClick={() => authService.logout()}
          className="mt-5 w-full text-center text-sm text-white/30 hover:text-white/60 transition-colors"
        >
          Sair da conta
        </button>
      </motion.div>
    </div>
  );
}
