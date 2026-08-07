import React, { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { authService } from '../services/auth';

interface Status {
  provisioned: boolean;
  connected: boolean;
  loggedIn: boolean;
  profileName?: string | null;
  owner?: string | null;
  provisioningStatus?: string | null;
  provisioningError?: string | null;
}

const glassCard = 'rounded-2xl backdrop-blur-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.2)]';

// Diferente do WhatsApp de um corretor (uma instância por conta), o Pai é
// UMA instância só, compartilhada por TODA a plataforma — todo corretor
// que já vinculou o próprio número em Config → WhatsApp Pai passa a ser
// reconhecido assim que ela está conectada, sem precisar fazer nada de
// novo. Conectar/desconectar aqui afeta TODOS os tenants de uma vez.
export default function AdminWhatsappPai() {
  const [status, setStatus] = useState<Status | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState('');
  const [showPairInput, setShowPairInput] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePhoneRef = useRef<string>('');

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (qrRefreshRef.current) { clearInterval(qrRefreshRef.current); qrRefreshRef.current = null; }
  };

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/admin/whatsapp-pai/status', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao checar status');
      setStatus(data);
      if (data.connected) {
        setQrcode(null);
        setPaircode(null);
        setConnecting(false);
        stopPolling();
      }
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  };

  const disconnectInstance = async () => {
    if (!confirm('Desconectar o WhatsApp Pai? Todos os corretores da plataforma param de conseguir mandar comando por WhatsApp até reconectar.')) return;
    setError(null);
    setDisconnecting(true);
    try {
      const r = await fetch('/api/admin/whatsapp-pai/disconnect', { method: 'POST', headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao desconectar');
      await loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const requestQrcode = async () => {
    try {
      const phone = activePhoneRef.current;
      const r = await fetch('/api/admin/whatsapp-pai/connect', {
        method: 'POST',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(phone ? { phone } : {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar QR code');
      if (data.paircode) { setPaircode(data.paircode); setQrcode(null); }
      else if (data.qrcode) { setQrcode(data.qrcode); setPaircode(null); }
      if (data.connected) { setConnecting(false); stopPolling(); loadStatus(); }
    } catch (e: any) {
      setError(e.message);
      setConnecting(false);
      stopPolling();
    }
  };

  const startConnecting = async (phone?: string) => {
    setError(null);
    setConnecting(true);
    setQrcode(null);
    setPaircode(null);
    activePhoneRef.current = phone || '';
    await requestQrcode();
    stopPolling();
    pollRef.current = setInterval(loadStatus, 3000);
    qrRefreshRef.current = setInterval(requestQrcode, 20000);
  };

  const disconnectSilently = async () => {
    try {
      await fetch('/api/admin/whatsapp-pai/disconnect', { method: 'POST', headers: authService.getAuthHeaders() });
    } catch { /* segue o fluxo mesmo se falhar — o connect seguinte revela o erro real, se houver */ }
  };

  const requestPaircode = async () => {
    const digits = pairPhone.replace(/\D/g, '');
    if (!digits) { setError('Informe o número com DDD.'); return; }
    setShowPairInput(false);
    await disconnectSilently();
    await startConnecting(digits);
  };

  const switchToQrcode = async () => {
    await disconnectSilently();
    await startConnecting();
  };

  useEffect(() => {
    loadStatus();
    return stopPolling;
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <div className={`${glassCard} !p-6`}>
        <div className="flex items-center gap-2 mb-1.5">
          <Bot className="w-4 h-4 text-[var(--text-low)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">WhatsApp Pai — instância central</h3>
        </div>
        <p className="text-[12px] text-[var(--text-low)] mb-4">
          Número único compartilhado por toda a plataforma. Todo corretor que já vinculou o próprio número em Config passa a ser reconhecido assim que esta instância está conectada — conectar/desconectar aqui vale para todos os tenants de uma vez, ninguém precisa fazer nada por conta própria.
        </p>

        {!status && <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>}

        {status && !status.provisioned && status.provisioningStatus === 'failed' && (
          <div className="space-y-3">
            <p className="text-[13px] text-red-300">
              Não foi possível preparar a instância{status.provisioningError ? `: ${status.provisioningError}` : '.'}
            </p>
            <button
              onClick={() => { setError(null); loadStatus(); }}
              className="inline-flex items-center gap-2 text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {status && !status.provisioned && status.provisioningStatus !== 'failed' && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-low)]">
            <Loader2 className="animate-spin w-4 h-4" /> Preparando a instância...
          </div>
        )}

        {status?.provisioned && status.connected && !connecting && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-300 text-[13px] font-semibold">
              <Wifi className="w-4 h-4" /> Conectado — valendo para toda a plataforma
            </div>
            <div className="text-[12px] text-[var(--text-low)] space-y-1">
              {status.profileName && <div>Perfil: <span className="text-[var(--text-mid)]">{status.profileName}</span></div>}
              {status.owner && <div>Número: <span className="text-[var(--text-mid)] font-mono">{status.owner}</span></div>}
            </div>
            <button
              onClick={disconnectInstance}
              disabled={disconnecting}
              className="inline-flex items-center gap-2 text-[12px] text-[var(--text-low)] hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {disconnecting ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {disconnecting ? 'Desconectando...' : 'Desconectar / trocar número'}
            </button>
          </div>
        )}

        {status?.provisioned && !status.connected && !connecting && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-amber-300 text-[13px] font-semibold">
              <WifiOff className="w-4 h-4" /> Desconectado — nenhum corretor consegue comandar por WhatsApp agora
            </div>
            <button
              onClick={() => startConnecting()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors"
            >
              Conectar WhatsApp Pai
            </button>
          </div>
        )}

        {connecting && (
          <div className="space-y-3">
            {paircode ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="text-3xl font-mono font-bold tracking-[0.2em] text-[var(--text-hi)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] rounded-xl px-6 py-4">
                  {paircode}
                </div>
                <p className="text-[12px] text-[var(--text-low)] text-center">No WhatsApp: Aparelhos conectados → Conectar com número de telefone → digite o código acima. Válido por 5 minutos.</p>
              </div>
            ) : qrcode ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="bg-white p-3 rounded-2xl">
                  <img src={qrcode} alt="QR code do WhatsApp Pai" className="w-48 h-48" />
                </div>
                <p className="text-[12px] text-[var(--text-low)] text-center">Abra o WhatsApp no celular do número oficial, vá em Aparelhos conectados e escaneie o código.</p>
              </div>
            ) : (
              <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>
            )}

            {!showPairInput && (qrcode || paircode) && (
              <button
                onClick={() => qrcode ? setShowPairInput(true) : switchToQrcode()}
                className="text-[11px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors mx-auto block"
              >
                {qrcode ? 'Não consegue escanear? Usar código em vez do QR' : 'Usar QR code em vez do código'}
              </button>
            )}

            {showPairInput && (
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={pairPhone}
                  onChange={(e) => setPairPhone(e.target.value)}
                  placeholder="DDD + número (número oficial da plataforma)"
                  className="flex-1 bg-[var(--control-fill)] border border-[var(--glass-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--text-hi)] placeholder:text-[var(--text-low)]"
                />
                <button
                  onClick={requestPaircode}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold text-[var(--text-hi)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
                >
                  Gerar código
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-red-300 mt-3">{error}</p>}
      </div>
    </div>
  );
}
