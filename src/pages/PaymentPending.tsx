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
  postalCode: string;
  addressNumber: string;
}

const BENEFITS = [
  'Imóveis ilimitados com landing page exclusiva',
  'Leads capturados automaticamente no CRM',
  'Agente IA respondendo seu WhatsApp 24h',
  'Dashboard com métricas em tempo real',
];

export default function PaymentPending() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<CardForm>({
    cpfCnpj: '', cardHolder: '', cardNumber: '',
    expiryMonth: '', expiryYear: '', cvv: '',
    postalCode: '', addressNumber: ''
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

  const formatCep = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
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
          cvv: form.cvv,
          postalCode: form.postalCode.replace(/\D/g, ''),
          addressNumber: form.addressNumber
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
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-start py-10 px-4 font-sans">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Home className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-black text-[#1A1A1A]">Ative seu plano</h1>
          <p className="text-[#6B7280] text-sm mt-1">Preencha os dados do cartão para começar</p>
        </div>

        {/* Preço + benefícios */}
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-3xl font-black text-[#1A1A1A]">R$ 97</span>
              <span className="text-[#6B7280] text-sm">/mês</span>
            </div>
            <span className="text-xs text-[#9CA3AF] bg-[#F9FAFB] px-3 py-1.5 rounded-full border border-[#E5E7EB]">Cancele quando quiser</span>
          </div>
          <div className="space-y-2">
            {BENEFITS.map(b => (
              <div key={b} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-xs text-[#374151]">{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-[#E5E7EB] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-[#9CA3AF]" />
            <span className="text-xs text-[#9CA3AF] font-medium">Pagamento seguro — seus dados são criptografados</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-600 p-3 rounded-2xl text-sm border border-red-100">
              <XCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* CPF/CNPJ */}
          <div>
            <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">CPF / CNPJ</label>
            <div className="relative">
              <Hash className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
              <input required value={form.cpfCnpj}
                onChange={e => setForm(f => ({ ...f, cpfCnpj: formatCpfCnpj(e.target.value) }))}
                className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                placeholder="000.000.000-00" />
            </div>
          </div>

          {/* Nome no cartão */}
          <div>
            <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Nome no Cartão</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
              <input required value={form.cardHolder} onChange={set('cardHolder')}
                className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                placeholder="Como aparece no cartão" />
            </div>
          </div>

          {/* Número do cartão */}
          <div>
            <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Número do Cartão</label>
            <div className="relative">
              <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
              <input required value={form.cardNumber}
                onChange={e => setForm(f => ({ ...f, cardNumber: formatCard(e.target.value) }))}
                className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium tracking-widest"
                placeholder="0000 0000 0000 0000" maxLength={19} />
            </div>
          </div>

          {/* Validade + CVV */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Mês</label>
              <input required value={form.expiryMonth} onChange={set('expiryMonth')}
                maxLength={2}
                className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium text-center"
                placeholder="MM" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Ano</label>
              <input required value={form.expiryYear} onChange={set('expiryYear')}
                maxLength={4}
                className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium text-center"
                placeholder="AAAA" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">CVV</label>
              <input required value={form.cvv} onChange={set('cvv')}
                maxLength={4} type="password"
                className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium text-center"
                placeholder="•••" />
            </div>
          </div>

          {/* CEP + Número */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">CEP</label>
              <input required value={form.postalCode}
                onChange={e => setForm(f => ({ ...f, postalCode: formatCep(e.target.value) }))}
                className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                placeholder="00000-000" maxLength={9} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Número</label>
              <input required value={form.addressNumber} onChange={set('addressNumber')}
                className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                placeholder="Ex: 100" />
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all disabled:opacity-50 shadow-lg shadow-black/10 mt-2">
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <><CreditCard className="w-5 h-5" /> Pagar R$ 97,00</>}
          </button>
        </form>

        <button onClick={() => authService.logout()} className="mt-4 w-full text-center text-sm text-[#9CA3AF] hover:text-[#374151] transition-colors">
          Sair da conta
        </button>
      </motion.div>
    </div>
  );
}
