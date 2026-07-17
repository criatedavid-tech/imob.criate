import React, { useEffect, useRef, useState } from 'react';
import { Loader2, User, Phone, MapPin, Check, CreditCard, FileText, Receipt, LogOut, Smartphone, Wifi, WifiOff, RefreshCw, Landmark, Trash2 } from 'lucide-react';
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
        body: JSON.stringify({ name, phone: phone ? normalizePhoneBR(phone) : '', broker_address: address }),
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
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }
  if (error && !me) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Config</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const st = STATUS_LABEL[(me?.status || '').toLowerCase()] || { label: me?.status || '—', cls: 'bg-white/[0.06] text-white/50 border-white/10' };
  const fieldCls = "w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors";

  return (
    <div className="max-w-3xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Config</h2>

      {/* Perfil */}
      <GlassCard className="!p-6 mb-5">
        <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase mb-4">Seu perfil</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><User size={11} /> Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Phone size={11} /> Telefone</label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50 bg-white/5 border border-white/12">+55</span>
                <input value={phone} onChange={(e) => setPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" className={`${fieldCls} flex-1 min-w-0`} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><MapPin size={11} /> Cidade / endereço</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Goiânia, GO" className={fieldCls} />
            </div>
          </div>
          {me?.email && <p className="text-[12px] text-white/30">E-mail de acesso: {me.email}</p>}
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={saveProfile} disabled={savingProfile}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
            {savingProfile ? <Loader2 size={15} className="animate-spin" /> : profileSaved ? <Check size={15} /> : null}
            {profileSaved ? 'Salvo' : 'Salvar perfil'}
          </button>
        </div>
      </GlassCard>

      {/* WhatsApp */}
      <WhatsAppConnectCard />

      {/* Integração de cobrança dos clientes fica fora do núcleo operacional. */}
      {CLIENT_FINANCIAL_OPERATIONS_ENABLED && me && me.account_type !== 'corretor' && <AsaasKeyCard fieldCls={fieldCls} />}

      {/* Plano */}
      <GlassCard className="!p-6 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-white/40" />
          <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Plano</h3>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[15px] font-bold text-white capitalize">{me?.plan || 'Assinatura'}</p>
            {me?.valid_until && (
              <p className="text-[12px] text-white/40 mt-0.5">
                Válido até {new Date(me.valid_until).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
          <span className={`text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full border ${st.cls}`}>{st.label}</span>
        </div>

        {usage && (
          <div className="mt-5 pt-5 border-t border-white/10">
            <p className="text-[12px] text-white/50">
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

      {/* Faturas — histórico de cobrança de excedente */}
      {usage && usage.history.length > 0 && (
        <GlassCard className="!p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="w-4 h-4 text-white/40" />
            <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Faturas de excedente</h3>
          </div>
          <div className="space-y-2">
            {usage.history.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[13px] py-2 border-b border-white/[0.05] last:border-0">
                <div>
                  <p className="text-white/70">
                    {new Date(h.billing_period_start).toLocaleDateString('pt-BR')} – {new Date(h.billing_period_end).toLocaleDateString('pt-BR')}
                  </p>
                  <p className="text-[11px] text-white/35">{h.tickets_overage} atendimento(s) excedente</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white">{centsToReais(h.amount_cents)}</p>
                  <p className={`text-[11px] ${h.status === 'cobrado' || h.status === 'paid' ? 'text-emerald-300' : 'text-white/35'}`}>{h.status}</p>
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
            <FileText className="w-4 h-4 text-white/40" />
            <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Termos de uso</h3>
          </div>
          {terms.needs_acceptance ? (
            <p className="text-[13px] text-amber-300">Há uma versão nova dos Termos aguardando seu aceite (aparece ao navegar no sistema).</p>
          ) : (
            <p className="text-[13px] text-white/50">
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
        <Smartphone className="w-4 h-4 text-white/40" />
        <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">WhatsApp</h3>
        {status?.ownInstance && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-violet-400/15 text-violet-200 border-violet-300/20">
            Sua instância própria
          </span>
        )}
      </div>

      {!status && <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-white/40" /></div>}

      {status && !status.provisioned && status.provisioningStatus === 'failed' && (
        <div className="space-y-3">
          <p className="text-[13px] text-red-300">
            Não foi possível preparar sua instância de WhatsApp{status.provisioningError ? `: ${status.provisioningError}` : '.'}
          </p>
          <button
            onClick={() => { setError(null); loadStatus(); }}
            className="inline-flex items-center gap-2 text-[12px] text-white/40 hover:text-white/70 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
        </div>
      )}

      {status && !status.provisioned && status.provisioningStatus !== 'failed' && (
        <div className="flex items-center gap-2 text-[13px] text-white/50">
          <Loader2 className="animate-spin w-4 h-4" /> Preparando sua instância de WhatsApp...
        </div>
      )}

      {status?.provisioned && status.connected && !connecting && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 text-[13px] font-semibold">
            <Wifi className="w-4 h-4" /> Conectado
          </div>
          <div className="text-[12px] text-white/40 space-y-1">
            {status.profileName && <div>Perfil: <span className="text-white/70">{status.profileName}</span></div>}
            {status.owner && <div>Número: <span className="text-white/70 font-mono">{status.owner}</span></div>}
          </div>
          <button
            onClick={disconnectInstance}
            disabled={disconnecting}
            className="inline-flex items-center gap-2 text-[12px] text-white/40 hover:text-red-300 transition-colors disabled:opacity-50"
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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors"
          >
            Conectar WhatsApp
          </button>
        </div>
      )}

      {connecting && (
        <div className="space-y-3">
          {paircode ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="text-3xl font-mono font-bold tracking-[0.2em] text-white bg-white/10 border border-white/15 rounded-xl px-6 py-4">
                {paircode}
              </div>
              <p className="text-[12px] text-white/40 text-center">No WhatsApp: Aparelhos conectados → Conectar com número de telefone → digite o código acima. Válido por 5 minutos.</p>
            </div>
          ) : qrcode ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="bg-white p-3 rounded-2xl">
                <img src={qrcode} alt="QR code do WhatsApp" className="w-48 h-48" />
              </div>
              <p className="text-[12px] text-white/40 text-center">Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o código.</p>
            </div>
          ) : (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-white/40" /></div>
          )}

          {!showPairInput && (qrcode || paircode) && (
            <button
              onClick={() => qrcode ? setShowPairInput(true) : switchToQrcode()}
              className="text-[11px] text-white/30 hover:text-white/60 transition-colors mx-auto block"
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
                className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/30"
              />
              <button
                onClick={requestPaircode}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white bg-white/10 border border-white/15 hover:bg-white/20 transition-colors"
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

// Conta de cobrança própria da imobiliária/incorporadora. Sem chave, as
// cobranças (aluguel + sinal PIX) usam a conta da Criate; com chave própria,
// o dinheiro cai na conta dela. A chave nunca é exibida — só últimos 4 dígitos.
function AsaasKeyCard({ fieldCls }: { fieldCls: string }) {
  const [status, setStatus] = useState<{ configured: boolean; env: string | null; key_last4: string | null; can_manage: boolean } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [env, setEnv] = useState<'sandbox' | 'production'>('production');
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
      if (data.env === 'sandbox' || data.env === 'production') setEnv(data.env);
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
    if (!confirm('Remover a chave de cobrança? As cobranças voltam a usar a conta da Criate.')) return;
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
        <Landmark className="w-4 h-4 text-white/40" />
        <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Conta de cobrança (Asaas)</h3>
      </div>
      <p className="text-[12px] text-white/40 mb-4">
        Conecte sua própria conta Asaas para receber aluguéis e sinais direto na sua conta. Sem isso, as cobranças usam a conta da Criate.
      </p>

      {!status && <div className="flex justify-center py-4"><Loader2 className="animate-spin w-5 h-5 text-white/40" /></div>}

      {status && status.configured && !editing && (
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-300">
            <Check className="w-4 h-4" /> Chave conectada
          </span>
          {status.key_last4 && <span className="text-[12px] text-white/40 font-mono">•••• {status.key_last4}</span>}
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
        <p className="text-[12px] text-white/35">Gerenciada pelo titular da conta.</p>
      )}
      {status && !status.configured && !status.can_manage && (
        <p className="text-[12px] text-white/35">Nenhuma chave própria — usando a conta da Criate. Só o titular pode configurar.</p>
      )}

      {showForm && (
        <div className="space-y-3 mt-2">
          <div>
            <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Chave de API do Asaas</label>
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
            <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Ambiente</label>
            <div className="flex gap-2">
              {(['production', 'sandbox'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setEnv(opt)}
                  className={`px-4 py-2 rounded-xl text-[13px] font-semibold border transition-colors ${
                    env === opt ? 'bg-white/15 text-white border-white/25' : 'bg-white/5 text-white/45 border-white/12 hover:text-white/70'
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
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
              {saving ? 'Validando...' : 'Salvar e validar'}
            </button>
            {status.configured && (
              <button onClick={() => { setEditing(false); setApiKey(''); setError(''); }}
                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white/50 hover:text-white/80 transition-colors">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {status && status.configured && status.can_manage && !editing && (
        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => { setEditing(true); setError(''); }}
            className="inline-flex items-center gap-2 text-[12px] text-white/40 hover:text-white/70 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Trocar chave
          </button>
          <span className="text-white/15">·</span>
          <button onClick={remove} disabled={removing}
            className="inline-flex items-center gap-2 text-[12px] text-white/40 hover:text-red-300 transition-colors disabled:opacity-50">
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {removing ? 'Removendo...' : 'Remover'}
          </button>
        </div>
      )}

      {error && <p className="text-[12px] text-red-300 mt-3">{error}</p>}
    </GlassCard>
  );
}
