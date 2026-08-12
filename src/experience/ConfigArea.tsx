import React, { useEffect, useRef, useState } from 'react';
import { Loader2, User, Phone, MapPin, Check, CreditCard, FileText, Receipt, LogOut, Smartphone, Wifi, WifiOff, RefreshCw, Landmark, Trash2, Users, Minus, Plus, Bot, X } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';
import { centsToReais } from '../lib/money';
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from '../lib/features';

interface UsageHistory {
  billing_period_start: string;
  billing_period_end: string;
  tickets_total: number;
  tickets_overage: number;
  amount_cents: number;
  status: string;
  charged_at: string | null;
}

interface Usage {
  current_period: {
    tickets_used: number;
    tickets_included: number;
    tickets_remaining: number;
    overage_tickets: number;
    overage_amount: number;
  };
  history: UsageHistory[];
}

interface TermsStatus {
  current: string;
  accepted_version: string | null;
  accepted_at: string | null;
  needs_acceptance: boolean;
}

interface Me {
  id: string;
  name: string;
  email: string;
  phone: string;
  notification_phone: string | null;
  broker_address: string;
  status: string;
  plan: string;
  valid_until: string | null;
  account_type: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ativo: { label: 'Ativo', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  active: { label: 'Ativo', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  pendente: { label: 'Pagamento pendente', cls: 'bg-amber-400/15 text-amber-200 border-amber-300/20' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
};

// Etapa 14 (Conta/Config) — concentra somente conta, conexão, plano e termos.
// Nome, instruções e follow-up da IA vivem na área manual `assistente-ia`.
export function ConfigArea() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // perfil
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notifPhone, setNotifPhone] = useState('');
  const [address, setAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // faturas + termos (reaproveita /api/billing/usage e /api/terms/status, já existiam)
  const [usage, setUsage] = useState<Usage | null>(null);
  const [terms, setTerms] = useState<TermsStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/brokers/me', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/billing/usage', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/terms/status', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meData, usageData, termsData]) => {
        if (!meData?.id) throw new Error('Não consegui carregar seu perfil.');
        setMe(meData);
        setUsage(usageData);
        setTerms(termsData);
        setName(meData.name || '');
        setPhone(meData.phone ? stripDDI(meData.phone) : '');
        setNotifPhone(meData.notification_phone ? stripDDI(meData.notification_phone) : '');
        // broker_address às vezes guarda lixo de outra origem (visto ao vivo:
        // um JSON de perfil de corretora em vez de endereço) — não exibir cru,
        // senão a pessoa pode salvar de volta sem perceber.
        const rawAddress = (meData.broker_address || '').trim();
        setAddress(rawAddress.startsWith('{') ? '' : rawAddress);
      })
      .catch((e) => setError(e.message || 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      const res = await fetch('/api/brokers/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          name,
          phone: phone ? normalizePhoneBR(phone) : '',
          notification_phone: notifPhone ? normalizePhoneBR(notifPhone) : '',
          broker_address: address,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error || 'Falha ao salvar.'); }
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1800);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }
  if (error && !me) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Config</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const st = STATUS_LABEL[(me?.status || '').toLowerCase()] || { label: me?.status || '—', cls: 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]' };
  const fieldCls = "w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)] focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors";

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Config</h2>

      {/* Perfil */}
      <GlassCard className="!p-6 mb-5">
        <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase mb-4">Seu perfil</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><User size={11} /> Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Phone size={11} /> Telefone</label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
                <input value={phone} onChange={(e) => setPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" className={`${fieldCls} flex-1 min-w-0`} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><MapPin size={11} /> Cidade / endereço</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Goiânia, GO" className={fieldCls} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Smartphone size={11} /> Número pessoal para alertas</label>
            <div className="flex items-stretch gap-2">
              <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
              <input value={notifPhone} onChange={(e) => setNotifPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" className={`${fieldCls} flex-1 min-w-0`} />
            </div>
            <p className="text-[11px] text-[var(--text-low)] mt-1.5">
              Recebe aviso no WhatsApp quando a IA marca uma visita. Use um número <strong className="text-[var(--text-low)]">diferente</strong> do WhatsApp comercial conectado acima — senão o aviso não chega. Deixe vazio para receber só dentro do app.
            </p>
          </div>
          {me?.email && <p className="text-[12px] text-[var(--text-low)]">E-mail de acesso: {me.email}</p>}
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={saveProfile} disabled={savingProfile}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
            {savingProfile ? <Loader2 size={15} className="animate-spin" /> : profileSaved ? <Check size={15} /> : null}
            {profileSaved ? 'Salvo' : 'Salvar perfil'}
          </button>
        </div>
      </GlassCard>

      {/* WhatsApp */}
      <WhatsAppConnectCard />

      {/* WhatsApp Pai — vínculo do número pessoal pra comandar a plataforma por lá (Fase 2, ainda sem número central conectado) */}
      <WhatsappPaiLinkCard fieldCls={fieldCls} />

      {/* Integração de cobrança dos clientes fica fora do núcleo operacional. */}
      {CLIENT_FINANCIAL_OPERATIONS_ENABLED && me && me.account_type !== 'corretor' && <AsaasKeyCard fieldCls={fieldCls} />}

      {/* Plano */}
      <GlassCard className="!p-6 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-[var(--text-low)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Plano</h3>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[15px] font-bold text-[var(--text-hi)] capitalize">{me?.plan || 'Assinatura'}</p>
            {me?.valid_until && (
              <p className="text-[12px] text-[var(--text-low)] mt-0.5">
                Válido até {new Date(me.valid_until).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
          <span className={`text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full border ${st.cls}`}>{st.label}</span>
        </div>

        {usage && (
          <div className="mt-5 pt-5 border-t border-[var(--hairline)]">
            <p className="text-[12px] text-[var(--text-low)]">
              {usage.current_period.tickets_used} de {usage.current_period.tickets_included} atendimentos usados no ciclo
              {usage.current_period.overage_tickets > 0 && (
                <> · <span className="text-amber-300 font-semibold">
                  {usage.current_period.overage_tickets} excedente(s) ({centsToReais(Math.round(usage.current_period.overage_amount * 100))})
                </span></>
              )}
            </p>
          </div>
        )}
      </GlassCard>

      {/* WhatsApp próprio da equipe — só imobiliária/incorporadora (corretor não tem Equipe) */}
      {me && me.account_type !== 'corretor' && <TeamWhatsappSlotsCard />}

      {/* Faturas — histórico de cobrança de excedente */}
      {usage && usage.history.length > 0 && (
        <GlassCard className="!p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="w-4 h-4 text-[var(--text-low)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Faturas de excedente</h3>
          </div>
          <div className="space-y-2">
            {usage.history.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[13px] py-2 border-b border-white/[0.05] last:border-0">
                <div>
                  <p className="text-[var(--text-mid)]">
                    {new Date(h.billing_period_start).toLocaleDateString('pt-BR')} – {new Date(h.billing_period_end).toLocaleDateString('pt-BR')}
                  </p>
                  <p className="text-[11px] text-[var(--text-low)]">{h.tickets_overage} atendimento(s) excedente</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-[var(--text-hi)]">{centsToReais(h.amount_cents)}</p>
                  <p className={`text-[11px] ${h.status === 'cobrado' || h.status === 'paid' ? 'text-emerald-300' : 'text-[var(--text-low)]'}`}>{h.status}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Termos */}
      {terms && (
        <GlassCard className="!p-6 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-[var(--text-low)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Termos de uso</h3>
          </div>
          {terms.needs_acceptance ? (
            <p className="text-[13px] text-amber-300">Há uma versão nova dos Termos aguardando seu aceite (aparece ao navegar no sistema).</p>
          ) : (
            <p className="text-[13px] text-[var(--text-low)]">
              Versão {terms.accepted_version} aceita{terms.accepted_at && <> em {new Date(terms.accepted_at).toLocaleDateString('pt-BR')}</>}.
            </p>
          )}
          <div className="flex gap-3 mt-3">
            <a href="/termos" target="_blank" rel="noreferrer" className="text-[12px] text-violet-300 hover:text-violet-200 transition-colors">Ver Termos</a>
            <a href="/privacidade" target="_blank" rel="noreferrer" className="text-[12px] text-violet-300 hover:text-violet-200 transition-colors">Ver Privacidade</a>
          </div>
        </GlassCard>
      )}

      {/* Sessão — sem isso não havia como sair do app pra logar com outra conta */}
      <GlassCard className="!p-6 mt-5">
        <button onClick={() => authService.logout()}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-red-300 bg-red-500/10 border border-red-400/20 hover:bg-red-500/20 transition-colors">
          <LogOut size={15} /> Sair da conta
        </button>
      </GlassCard>
    </div>
  );
}

function WhatsAppConnectCard() {
  const [status, setStatus] = useState<{ provisioned: boolean; connected: boolean; loggedIn: boolean; profileName?: string | null; owner?: string | null; ownInstance?: boolean; provisioningStatus?: string | null; provisioningError?: string | null } | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState('');
  const [showPairInput, setShowPairInput] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const provisioningPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePhoneRef = useRef<string>('');

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (qrRefreshRef.current) { clearInterval(qrRefreshRef.current); qrRefreshRef.current = null; }
    if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
  };

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/brokers/whatsapp/status', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao checar status');
      setStatus(data);
      if (data.connected) {
        setQrcode(null);
        setConnecting(false);
        stopPolling();
      }
      // Enquanto a instância está sendo preparada pela primeira vez (ou
      // recuperando de uma falha), o backend já tentou provisionar na hora
      // (autocura); só falta a tela ficar checando até virar `provisioned`.
      if (!data.provisioned && data.provisioningStatus === 'processing' && !provisioningPollRef.current) {
        provisioningPollRef.current = setInterval(async () => {
          const fresh = await loadStatus();
          if (fresh?.provisioned || fresh?.provisioningStatus === 'failed') {
            if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
          }
        }, 3000);
      }
      if (data.provisioned || data.provisioningStatus === 'failed') {
        if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
      }
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  };

  const disconnectInstance = async () => {
    setError(null);
    setDisconnecting(true);
    try {
      const r = await fetch('/api/brokers/whatsapp/disconnect', { method: 'POST', headers: authService.getAuthHeaders() });
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
      const r = await fetch('/api/brokers/whatsapp/connect', {
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

  // Trocar de modo (QR ↔ código) no meio de uma tentativa em andamento não
  // gera um pedido novo — a UAZAPI só entrega o QR/código da tentativa que já
  // estava em curso. É preciso desconectar antes de pedir o outro modo.
  const disconnectSilently = async () => {
    try {
      await fetch('/api/brokers/whatsapp/disconnect', { method: 'POST', headers: authService.getAuthHeaders() });
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
    <GlassCard className="!p-6 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone className="w-4 h-4 text-[var(--text-low)]" />
        <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">WhatsApp</h3>
        {status?.ownInstance && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-violet-400/15 text-violet-200 border-violet-300/20">
            Sua instância própria
          </span>
        )}
      </div>

      {!status && <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>}

      {status && !status.provisioned && status.provisioningStatus === 'failed' && (
        <div className="space-y-3">
          <p className="text-[13px] text-red-300">
            Não foi possível preparar sua instância de WhatsApp{status.provisioningError ? `: ${status.provisioningError}` : '.'}
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
          <Loader2 className="animate-spin w-4 h-4" /> Preparando sua instância de WhatsApp...
        </div>
      )}

      {status?.provisioned && status.connected && !connecting && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 text-[13px] font-semibold">
            <Wifi className="w-4 h-4" /> Conectado
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
            <WifiOff className="w-4 h-4" /> Desconectado
          </div>
          <button
            onClick={() => startConnecting()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors"
          >
            Conectar WhatsApp
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
                <img src={qrcode} alt="QR code do WhatsApp" className="w-48 h-48" />
              </div>
              <p className="text-[12px] text-[var(--text-low)] text-center">Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o código.</p>
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
                placeholder="DDD + número"
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
    </GlassCard>
  );
}

// Integração financeira opcional da própria imobiliária/incorporadora.
// Sem chave válida, cobranças de aluguel e sinal permanecem bloqueadas; nunca
// existe fallback para a conta da Criate. A chave nunca é exibida.
interface WhatsappSlotsStatus {
  applicable: boolean;
  is_owner: boolean;
  is_trial: boolean;
  editable: boolean;
  member_limit: number;
  in_use: number;
  max_slots: number;
  monthly_value: number;
}

// Self-service desde 17/07 — antes só o admin ajustava member_limit
// manualmente por conta. Efeito de acesso é imediato (o titular já pode
// convidar com o novo limite); a cobrança em si só entra no valor da
// assinatura no PRÓXIMO ciclo (mesmo padrão do excedente de atendimentos).
function TeamWhatsappSlotsCard() {
  const [status, setStatus] = useState<WhatsappSlotsStatus | null>(null);
  const [basePriceNum, setBasePriceNum] = useState(0);
  const [slotPriceNum, setSlotPriceNum] = useState(0);
  const [slotPriceDisplay, setSlotPriceDisplay] = useState('0,00');
  const [draft, setDraft] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await fetch('/api/equipe/whatsapp-slots', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao carregar.');
      setStatus(data);
      setDraft(data.member_limit);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    fetch('/api/config/plan', { headers: authService.getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.price === 'number') setBasePriceNum(d.price);
        if (typeof d?.memberWhatsappSlotPrice === 'number') setSlotPriceNum(d.memberWhatsappSlotPrice);
        if (d?.memberWhatsappSlotPriceDisplay) setSlotPriceDisplay(d.memberWhatsappSlotPriceDisplay);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false); setError('');
    try {
      const r = await fetch('/api/equipe/whatsapp-slots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ member_limit: draft }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao salvar.');
      setEditing(false); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!status) {
    return (
      <GlassCard className="!p-6 mb-5">
        <div className="flex justify-center py-4"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>
      </GlassCard>
    );
  }

  const previewTotal = (basePriceNum + draft * slotPriceNum).toFixed(2).replace('.', ',');

  return (
    <GlassCard className="!p-6 mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <Users className="w-4 h-4 text-[var(--text-low)]" />
        <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">WhatsApp próprio da equipe</h3>
      </div>
      <p className="text-[12px] text-[var(--text-low)] mb-4">
        {status.is_trial
          ? 'Na experimentação, a quantidade de corretores com número próprio é definida pelo voucher. Os demais compartilham o número da conta'
          : <>Por padrão os corretores compartilham o número da conta. Cada um com número próprio custa R$ {slotPriceDisplay}/mês</>}
        {status.in_use > 0 && <> — {status.in_use} membro{status.in_use > 1 ? 's usam' : ' usa'} isso hoje</>}.
      </p>

      {error && <p className="text-[12px] text-red-300 mb-3">{error}</p>}

      {status.is_trial ? (
        <div>
          <p className="text-[15px] font-bold text-[var(--text-hi)]">
            {status.member_limit} vaga{status.member_limit === 1 ? '' : 's'} de WhatsApp próprio liberada{status.member_limit === 1 ? '' : 's'} pelo voucher
          </p>
          <p className="text-[12px] text-[var(--text-low)] mt-0.5">
            {status.in_use} em uso · essa cota não gera cobrança durante a experimentação e só pode ser alterada pela administração.
          </p>
        </div>
      ) : !status.is_owner ? (
        <p className="text-[12px] text-[var(--text-low)]">
          {status.member_limit} slot{status.member_limit === 1 ? '' : 's'} contratado{status.member_limit === 1 ? '' : 's'} — só o titular da conta pode alterar.
        </p>
      ) : !editing ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[15px] font-bold text-[var(--text-hi)]">
              {status.member_limit} slot{status.member_limit === 1 ? '' : 's'} contratado{status.member_limit === 1 ? '' : 's'}
            </p>
            <p className="text-[12px] text-[var(--text-low)] mt-0.5">R$ {status.monthly_value.toFixed(2).replace('.', ',')}/mês no total do plano</p>
          </div>
          <button onClick={() => setEditing(true)} disabled={!status.editable}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
            Alterar
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-low)]">Quantidade de slots</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setDraft((v) => Math.max(status.in_use, v - 1))}
                disabled={draft <= status.in_use}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] text-[var(--text-hi)] disabled:opacity-30 hover:bg-[var(--control-fill-hover)] transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-6 text-center text-[var(--text-hi)] font-bold">{draft}</span>
              <button type="button" onClick={() => setDraft((v) => Math.min(status.max_slots, v + 1))}
                disabled={draft >= status.max_slots}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)] text-[var(--text-hi)] disabled:opacity-30 hover:bg-[var(--control-fill-hover)] transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {draft < status.member_limit && draft === status.in_use && status.in_use > 0 && (
            <p className="text-[11px] text-amber-300/80">
              Esse é o mínimo — você tem {status.in_use} membro{status.in_use > 1 ? 's' : ''} usando WhatsApp próprio hoje.
            </p>
          )}
          <p className="text-[11px] text-[var(--text-low)]">
            Novo valor mensal: <strong className="text-[var(--text-mid)]">R$ {previewTotal}</strong> — a mudança de acesso vale já, mas a cobrança só entra no seu próximo ciclo.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => { setEditing(false); setDraft(status.member_limit); setError(''); }}
              className="px-4 py-2 rounded-xl text-[13px] font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">
              Cancelar
            </button>
            <button onClick={save} disabled={saving || draft === status.member_limit}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
              {saved ? 'Salvo' : 'Salvar'}
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

// Vínculo de telefone do WhatsApp Pai (Fase 2 do plano) — o usuário prova
// aqui, já logado, que um número é dele. O número central ("Pai") em si
// ainda não existe (Fase 3); por enquanto isso só cadastra o vínculo pra
// quando o inbound (Fase 4) existir, resolver quem está mandando comando.
function WhatsappPaiLinkCard({ fieldCls }: { fieldCls: string }) {
  const [phones, setPhones] = useState<string[] | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await fetch('/api/me/whatsapp-link', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (r.ok) setPhones(data.phones || []);
    } catch { /* silencioso — card secundário, não trava a tela de config */ }
  };

  useEffect(() => { load(); }, []);

  const sendCode = async () => {
    setError('');
    const phone = normalizePhoneBR(phoneInput);
    if (!phone) { setError('Digite um número válido.'); return; }
    setSending(true);
    try {
      const r = await fetch('/api/me/whatsapp-link/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ phone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao enviar o código.');
      setCodeSentTo(phoneInput);
      setCodeInput('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const confirmCode = async () => {
    setError('');
    if (!/^\d{6}$/.test(codeInput.trim())) { setError('Digite o código de 6 dígitos.'); return; }
    setConfirming(true);
    try {
      const r = await fetch('/api/me/whatsapp-link/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ code: codeInput.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Código incorreto.');
      setCodeSentTo(null);
      setPhoneInput('');
      setCodeInput('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  const unlink = async (phone: string) => {
    if (!confirm('Desvincular este número? Ele para de ser reconhecido pela plataforma.')) return;
    try {
      const r = await fetch(`/api/me/whatsapp-link/${phone}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b?.error || 'Falha ao desvincular.'); }
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <GlassCard className="!p-6 mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot className="w-4 h-4 text-[var(--text-low)]" />
        <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">WhatsApp Pai (comando por voz/texto)</h3>
      </div>
      <p className="text-[12px] text-[var(--text-low)] mb-4">
        Vincule seu número pessoal pra futuramente comandar a plataforma direto pelo WhatsApp — cadastrar imóvel, consultar leads, agendar visita, tudo por lá. Confirme aqui que o número é seu; o número central ainda está sendo preparado.
      </p>

      {phones === null && <div className="flex justify-center py-3"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>}

      {phones && phones.length > 0 && (
        <div className="space-y-2 mb-4">
          {phones.map((phone) => (
            <div key={phone} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-300">
                <Check className="w-4 h-4" /> +55 {stripDDI(phone)}
              </span>
              <button onClick={() => unlink(phone)} className="text-[var(--text-low)] hover:text-red-300 transition-colors" title="Desvincular">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[12px] text-red-300 mb-3">{error}</p>}

      {!codeSentTo ? (
        <div className="flex items-stretch gap-2">
          <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
          <input value={phoneInput} onChange={(e) => setPhoneInput(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" className={`${fieldCls} flex-1 min-w-0`} />
          <button onClick={sendCode} disabled={sending || !phoneInput}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 whitespace-nowrap">
            {sending ? <Loader2 size={15} className="animate-spin" /> : null}
            Enviar código
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-[var(--text-low)]">Enviamos um código de 6 dígitos pelo WhatsApp pro número +55 {codeSentTo}. Digite abaixo:</p>
          <div className="flex items-stretch gap-2">
            <input value={codeInput} onChange={(e) => setCodeInput(digitsOnly(e.target.value, 6))} inputMode="numeric" maxLength={6} placeholder="000000" className={`${fieldCls} flex-1 min-w-0 tracking-[0.3em] text-center font-mono`} />
            <button onClick={confirmCode} disabled={confirming || codeInput.length !== 6}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 whitespace-nowrap">
              {confirming ? <Loader2 size={15} className="animate-spin" /> : null}
              Confirmar
            </button>
          </div>
          <button onClick={() => { setCodeSentTo(null); setError(''); }} className="text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
            Usar outro número
          </button>
        </div>
      )}
    </GlassCard>
  );
}

function AsaasKeyCard({ fieldCls }: { fieldCls: string }) {
  const [status, setStatus] = useState<{
    configured: boolean;
    needs_reconnect?: boolean;
    env: string | null;
    key_last4: string | null;
    can_manage: boolean;
    sandbox_only?: boolean;
    blocked_by_sandbox_mode?: boolean;
  } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await fetch('/api/brokers/asaas-key', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao carregar.');
      setStatus(data);
      if (data.sandbox_only) setEnv('sandbox');
      else if (data.env === 'sandbox' || data.env === 'production') setEnv(data.env);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!apiKey.trim()) { setError('Cole a chave de API do Asaas.'); return; }
    setSaving(true); setSaved(false); setError('');
    try {
      const r = await fetch('/api/brokers/asaas-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ api_key: apiKey.trim(), env }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao salvar.');
      setApiKey(''); setEditing(false); setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remover a chave de cobrança? Novas cobranças de clientes ficarão bloqueadas até conectar outra conta própria.')) return;
    setRemoving(true); setError('');
    try {
      const r = await fetch('/api/brokers/asaas-key', { method: 'DELETE', headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao remover.');
      setEditing(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRemoving(false);
    }
  };

  const showForm = status && status.can_manage && (editing || !status.configured);

  return (
    <GlassCard className="!p-6 mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <Landmark className="w-4 h-4 text-[var(--text-low)]" />
        <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Conta de cobrança (Asaas)</h3>
      </div>
      <p className="text-[12px] text-[var(--text-low)] mb-4">
        Integração opcional com a conta Asaas da própria empresa. Os valores são recebidos diretamente nessa conta; o Real Estate apenas gera e acompanha o status. Sem integração própria, novas cobranças ficam bloqueadas.
      </p>

      {status?.sandbox_only && (
        <p className="text-[12px] text-amber-200 mb-4 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2.5">
          Modo de validação: somente o Asaas sandbox é aceito. Boletos, PIX e clientes criados aqui são de teste e não movimentam dinheiro real.
        </p>
      )}

      {!status && <div className="flex justify-center py-4"><Loader2 className="animate-spin w-5 h-5 text-[var(--text-low)]" /></div>}

      {status && status.configured && !editing && (
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-300">
            <Check className="w-4 h-4" /> Chave conectada
          </span>
          {status.key_last4 && <span className="text-[12px] text-[var(--text-low)] font-mono">•••• {status.key_last4}</span>}
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
            status.env === 'production'
              ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20'
              : 'bg-amber-400/15 text-amber-200 border-amber-300/20'
          }`}>
            {status.env === 'production' ? 'Produção' : 'Sandbox'}
          </span>
        </div>
      )}

      {status && status.configured && !status.can_manage && (
        <p className="text-[12px] text-[var(--text-low)]">Gerenciada pelo titular da conta.</p>
      )}
      {status && status.needs_reconnect && (
        <p className="text-[12px] text-amber-200 mb-3">A integração anterior não pode ser utilizada. O titular precisa conectar novamente a conta própria.</p>
      )}
      {status && status.blocked_by_sandbox_mode && (
        <p className="text-[12px] text-amber-200 mb-3">A chave de produção está bloqueada durante a validação. Conecte uma chave do Asaas sandbox.</p>
      )}
      {status && !status.configured && !status.can_manage && (
        <p className="text-[12px] text-[var(--text-low)]">Nenhuma integração própria configurada. Novas cobranças estão bloqueadas; somente o titular pode conectar uma conta.</p>
      )}

      {showForm && (
        <div className="space-y-3 mt-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5">Chave de API do Asaas</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="$aact_..."
              autoComplete="off"
              className={fieldCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5">Ambiente</label>
            <div className="flex gap-2">
              {(status?.sandbox_only ? ['sandbox'] as const : ['production', 'sandbox'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setEnv(opt)}
                  className={`px-4 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${
                    env === opt ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] border-[var(--glass-border-strong)]' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline-strong)] hover:text-[var(--text-mid)]'
                  }`}
                >
                  {opt === 'production' ? 'Produção' : 'Sandbox (teste)'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
              {saving ? 'Validando...' : 'Salvar e validar'}
            </button>
            {status.configured && (
              <button onClick={() => { setEditing(false); setApiKey(''); setError(''); }}
                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-[var(--text-low)] hover:text-[var(--text-hi)] transition-colors">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {status && status.configured && status.can_manage && !editing && (
        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => { setEditing(true); setError(''); }}
            className="inline-flex items-center gap-2 text-[12px] text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Trocar chave
          </button>
          <span className="text-[var(--text-low)]">·</span>
          <button onClick={remove} disabled={removing}
            className="inline-flex items-center gap-2 text-[12px] text-[var(--text-low)] hover:text-red-300 transition-colors disabled:opacity-50">
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {removing ? 'Removendo...' : 'Remover'}
          </button>
        </div>
      )}

      {error && <p className="text-[12px] text-red-300 mt-3">{error}</p>}
    </GlassCard>
  );
}
