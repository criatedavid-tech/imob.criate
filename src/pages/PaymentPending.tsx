import React, { useState } from 'react';
import { Home, CreditCard, Loader2, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { authService } from '../services/auth';

export default function PaymentPending() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCheckout = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/checkout', {
        method: 'POST',
        headers: authService.getAuthHeaders()
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro ao iniciar pagamento');
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const user = authService.getUser();

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[40px] shadow-2xl border border-[#E5E7EB] max-w-lg w-full p-10 text-center"
      >
        {/* Logo */}
        <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <Home className="text-white w-8 h-8" />
        </div>

        <h1 className="text-2xl font-black text-[#1A1A1A] mb-2">Ative sua conta</h1>
        <p className="text-[#6B7280] mb-8 leading-relaxed">
          Olá{user?.email ? `, ${user.email}` : ''}! Para acessar o ImobiFlow, complete o pagamento da sua assinatura.
        </p>

        {/* Benefícios */}
        <div className="bg-[#F9FAFB] rounded-2xl p-6 mb-8 text-left space-y-3">
          {[
            'Cadastre imóveis ilimitados com landing page exclusiva',
            'Leads capturados automaticamente no seu CRM',
            'Agente IA respondendo seu WhatsApp 24h',
            'Dashboard com métricas em tempo real',
          ].map((item) => (
            <div key={item} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <span className="text-sm text-[#374151]">{item}</span>
            </div>
          ))}
        </div>

        {/* Preço */}
        <div className="mb-8">
          <span className="text-4xl font-black text-[#1A1A1A]">R$ 97</span>
          <span className="text-[#6B7280] text-sm">/mês</span>
          <p className="text-xs text-[#9CA3AF] mt-1">Cancele quando quiser. Sem fidelidade.</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-600 p-4 rounded-2xl text-sm mb-4 border border-red-100">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all disabled:opacity-50 shadow-lg shadow-black/10"
        >
          {loading ? (
            <Loader2 className="animate-spin w-5 h-5" />
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              Assinar agora
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>

        <button
          onClick={() => authService.logout()}
          className="mt-4 text-sm text-[#9CA3AF] hover:text-[#374151] transition-colors"
        >
          Sair da conta
        </button>
      </motion.div>
    </div>
  );
}
