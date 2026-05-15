import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Home, Smartphone } from 'lucide-react';
import { motion } from 'motion/react';

export default function PaymentSuccess() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); navigate('/'); }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-[40px] shadow-2xl border border-[#E5E7EB] max-w-md w-full p-10 text-center"
      >
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>

        <h1 className="text-2xl font-black text-[#1A1A1A] mb-2">Obrigado!</h1>
        <p className="text-lg font-semibold text-[#374151] mb-3">Pagamento confirmado com sucesso</p>
        <p className="text-[#6B7280] leading-relaxed mb-6 text-sm">
          Sua conta está sendo ativada. Em instantes você terá acesso ao dashboard e seu canal WhatsApp será configurado automaticamente.
        </p>

        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-4 mb-6 flex items-start gap-3 text-left">
          <Smartphone className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <p className="text-sm text-[#166534]">
            Após acessar o dashboard, vá em <strong>WhatsApp</strong> para escanear o QR Code e conectar seu agente IA.
          </p>
        </div>

        <div className="bg-[#F9FAFB] rounded-2xl p-4 mb-6 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin w-4 h-4 text-[#9CA3AF]" />
          <span className="text-sm text-[#6B7280]">
            Acessando o dashboard em <strong>{countdown}s</strong>...
          </span>
        </div>

        <button
          onClick={() => navigate('/')}
          className="w-full h-12 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-sm font-bold hover:bg-[#222] transition-all"
        >
          <Home className="w-4 h-4" />
          Ir para o Dashboard agora
        </button>
      </motion.div>
    </div>
  );
}
