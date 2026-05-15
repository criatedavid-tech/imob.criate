import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import { authService } from '../services/auth';

interface WhatsAppStatus {
  connected: boolean;
  qr_code: string | null;
  channel_name: string | null;
  message?: string;
}

const glassCard = `rounded-3xl backdrop-blur-xl bg-white/10 border border-white/15
  shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]`;

export default function WhatsAppSetup() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/whatsapp/status', {
        headers: authService.getAuthHeaders()
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setStatus(data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (!status?.connected) fetchStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus, status?.connected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin w-6 h-6 text-white/30" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto"
    >
      {/* Status badge */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-full w-fit mb-6 text-sm font-semibold border ${
        status?.connected
          ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
          : 'bg-amber-500/20 border-amber-400/30 text-amber-300'
      }`}>
        {status?.connected
          ? <><Wifi className="w-4 h-4" /> WhatsApp Conectado</>
          : <><WifiOff className="w-4 h-4" /> Aguardando conexão</>
        }
      </div>

      {/* Conectado */}
      {status?.connected ? (
        <div className={`${glassCard} p-8 text-center`}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4
            backdrop-blur-md bg-emerald-500/20 border border-emerald-400/30">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">WhatsApp ativo!</h2>
          <p className="text-white/60">
            Canal: <strong className="text-white/80">{status.channel_name || 'Seu canal'}</strong>
          </p>
          <p className="text-sm text-white/40 mt-2">
            Seu agente está respondendo automaticamente todos os clientes.
          </p>
          <button onClick={fetchStatus}
            className="mt-6 flex items-center gap-2 mx-auto text-sm text-white/40 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" /> Atualizar status
          </button>
        </div>

      /* Sem QR ainda */
      ) : !status?.qr_code ? (
        <div className={`${glassCard} p-8 text-center`}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4
            backdrop-blur-md bg-amber-500/20 border border-amber-400/30">
            <Smartphone className="w-8 h-8 text-amber-300" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Canal sendo criado...</h2>
          <p className="text-white/60 leading-relaxed">
            {status?.message || 'Seu canal WhatsApp está sendo configurado automaticamente. Isso pode levar alguns minutos.'}
          </p>
          <button onClick={fetchStatus}
            className="mt-6 flex items-center gap-2 mx-auto text-sm font-medium text-white/40 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" /> Verificar novamente
          </button>
        </div>

      /* QR Code disponível */
      ) : (
        <div className={`${glassCard} p-8`}>
          <h2 className="text-xl font-bold text-white mb-1">Conecte seu WhatsApp</h2>
          <p className="text-white/50 text-sm mb-6">
            Abra o WhatsApp no celular → <strong className="text-white/70">Dispositivos conectados</strong> → <strong className="text-white/70">Conectar dispositivo</strong> → escaneie o QR Code abaixo.
          </p>

          {/* QR Code */}
          <div className="flex justify-center mb-6">
            <div className="rounded-2xl p-3 bg-white shadow-xl">
              {status.qr_code.startsWith('data:image') ? (
                <img src={status.qr_code} alt="QR Code WhatsApp" className="w-52 h-52" />
              ) : (
                <img src={`data:image/png;base64,${status.qr_code}`} alt="QR Code WhatsApp" className="w-52 h-52" />
              )}
            </div>
          </div>

          {/* Passos */}
          <div className="space-y-2.5 mb-6">
            {[
              'Abra o WhatsApp no seu celular',
              'Toque em Menu (⋮) ou Configurações',
              'Selecione "Dispositivos conectados"',
              'Toque em "Conectar dispositivo" e escaneie'
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-white/60">
                <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white
                  backdrop-blur-md bg-white/15 border border-white/25">
                  {i + 1}
                </span>
                {step}
              </div>
            ))}
          </div>

          <button onClick={fetchStatus}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white
              backdrop-blur-md bg-white/10 border border-white/15 hover:bg-white/20 transition-all">
            <RefreshCw className="w-4 h-4" /> Atualizar QR Code
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-500/20 border border-red-400/30 text-red-300 p-4 rounded-2xl text-sm mt-4">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
    </motion.div>
  );
}
