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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex items-center justify-center p-6 font-sans relative overflow-hidden">
      {/* Noise texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="relative z-10 max-w-md w-full text-center rounded-[40px] p-10
          backdrop-blur-2xl bg-white/12 border border-white/20
          shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_24px_64px_rgba(0,0,0,0.4)]"
      >
        {/* Ícone de sucesso */}
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6
          backdrop-blur-md bg-emerald-500/20 border border-emerald-400/30
          shadow-[inset_0_1px_0_rgba(52,211,153,0.3),0_4px_16px_rgba(16,185,129,0.2)]">
          <CheckCircle2 className="text-emerald-400 w-10 h-10" />
        </div>

        <h1 className="text-2xl font-black text-white mb-2">Bem-vindo!</h1>
        <p className="text-lg font-semibold text-white/80 mb-3">Pagamento confirmado com sucesso</p>
        <p className="text-white/50 leading-relaxed mb-6 text-sm">
          Sua conta está sendo ativada automaticamente. Estamos preparando seu ambiente.
        </p>

        {/* Aviso credenciais */}
        <div className="rounded-2xl p-4 mb-6 flex items-start gap-3 text-left
          backdrop-blur-md bg-emerald-500/15 border border-emerald-400/25">
          <Smartphone className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-300">
            Suas credenciais de acesso serão enviadas em até <strong>2 minutos</strong> para o número cadastrado via <strong>WhatsApp</strong>. Verifique também seu <strong>e-mail</strong>.
          </p>
        </div>

        {/* Countdown */}
        <div className="rounded-2xl p-4 mb-6 flex items-center justify-center gap-2
          backdrop-blur-md bg-white/10 border border-white/15">
          <Loader2 className="animate-spin w-4 h-4 text-white/40" />
          <span className="text-sm text-white/60">
            Acessando o dashboard em <strong className="text-white">{countdown}s</strong>...
          </span>
        </div>

        {/* Botão */}
        <button
          onClick={() => navigate('/')}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white
            transition-all active:scale-[0.99]
            backdrop-blur-md bg-white/15 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
            hover:bg-white/25"
        >
          <Home className="w-4 h-4" />
          Ir para o Dashboard agora
        </button>
      </motion.div>
    </div>
  );
}
