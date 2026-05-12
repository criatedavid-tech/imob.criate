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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Atualiza a cada 10 segundos enquanto não estiver conectado
    const interval = setInterval(() => {
      if (!status?.connected) fetchStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus, status?.connected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin w-6 h-6 text-[#9CA3AF]" />
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
      <div className={`flex items-center gap-2 px-4 py-2 rounded-full w-fit mb-6 text-sm font-semibold ${
        status?.connected
          ? 'bg-green-100 text-green-700'
          : 'bg-yellow-100 text-yellow-700'
      }`}>
        {status?.connected ? (
          <><Wifi className="w-4 h-4" /> WhatsApp Conectado</>
        ) : (
          <><WifiOff className="w-4 h-4" /> Aguardando conexão</>
        )}
      </div>

      {status?.connected ? (
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">WhatsApp ativo!</h2>
          <p className="text-[#6B7280]">
            Canal: <strong>{status.channel_name || 'Seu canal'}</strong>
          </p>
          <p className="text-sm text-[#9CA3AF] mt-2">
            Seu agente está respondendo automaticamente todos os clientes.
          </p>
          <button onClick={fetchStatus} className="mt-6 flex items-center gap-2 mx-auto text-sm text-[#9CA3AF] hover:text-[#374151]">
            <RefreshCw className="w-4 h-4" /> Atualizar status
          </button>
        </div>
      ) : !status?.qr_code ? (
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">Canal sendo criado...</h2>
          <p className="text-[#6B7280] leading-relaxed">
            {status?.message || 'Seu canal WhatsApp está sendo configurado automaticamente. Isso pode levar alguns minutos.'}
          </p>
          <button onClick={fetchStatus} className="mt-6 flex items-center gap-2 mx-auto text-sm text-[#6B7280] hover:text-[#1A1A1A] font-medium">
            <RefreshCw className="w-4 h-4" /> Verificar novamente
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-8 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-1">Conecte seu WhatsApp</h2>
          <p className="text-[#6B7280] text-sm mb-6">
            Abra o WhatsApp no celular → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> → escaneie o QR Code abaixo.
          </p>

          {/* QR Code */}
          <div className="flex justify-center mb-6">
            <div className="border-4 border-black rounded-2xl p-3 bg-white shadow-lg">
              {status.qr_code.startsWith('data:image') ? (
                <img src={status.qr_code} alt="QR Code WhatsApp" className="w-52 h-52" />
              ) : (
                <img src={`data:image/png;base64,${status.qr_code}`} alt="QR Code WhatsApp" className="w-52 h-52" />
              )}
            </div>
          </div>

          <div className="space-y-2 text-sm text-[#374151] mb-6">
            {['Abra o WhatsApp no seu celular', 'Toque em Menu (⋮) ou Configurações', 'Selecione "Dispositivos conectados"', 'Toque em "Conectar dispositivo" e escaneie'].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-black text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                {step}
              </div>
            ))}
          </div>

          <button onClick={fetchStatus} className="w-full h-11 flex items-center justify-center gap-2 border border-[#E5E7EB] rounded-2xl text-sm font-medium hover:bg-[#F9FAFB] transition-all">
            <RefreshCw className="w-4 h-4" /> Atualizar QR Code
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-600 p-4 rounded-2xl text-sm mt-4 border border-red-100">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
    </motion.div>
  );
}
