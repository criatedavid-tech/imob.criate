import React, { useEffect, useState } from 'react';
import { Loader2, User, Phone, MapPin, Bot, Check, CreditCard, FileText, Receipt } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';
import { centsToReais } from '../lib/money';

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
  ai_name: string;
  broker_address: string;
  status: string;
  plan: string;
  valid_until: string | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ativo: { label: 'Ativo', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  active: { label: 'Ativo', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  pendente: { label: 'Pagamento pendente', cls: 'bg-amber-400/15 text-amber-200 border-amber-300/20' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
};

// Etapa 14 (Conta/Config) — reaproveita os endpoints que já existem:
// GET /api/brokers/me, POST /api/brokers/settings (perfil),
// GET/POST /api/brokers/my-agent (agente). Perfil + plano + agente numa tela só.
export function ConfigArea() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // perfil
  const [name, setName] = useState('');
  const [aiName, setAiName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // agente
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentName, setAgentName] = useState('');
  const [savingAgent, setSavingAgent] = useState(false);
  const [agentSaved, setAgentSaved] = useState(false);

  // faturas + termos (reaproveita /api/billing/usage e /api/terms/status, já existiam)
  const [usage, setUsage] = useState<Usage | null>(null);
  const [terms, setTerms] = useState<TermsStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/brokers/me', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/brokers/my-agent', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/billing/usage', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/terms/status', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meData, agent, usageData, termsData]) => {
        if (!meData?.id) throw new Error('Não consegui carregar seu perfil.');
        setMe(meData);
        setUsage(usageData);
        setTerms(termsData);
        setName(meData.name || '');
        setAiName(meData.ai_name || '');
        setPhone(meData.phone ? stripDDI(meData.phone) : '');
        // broker_address às vezes guarda lixo de outra origem (visto ao vivo:
        // um JSON de perfil de corretora em vez de endereço) — não exibir cru,
        // senão a pessoa pode salvar de volta sem perceber.
        const rawAddress = (meData.broker_address || '').trim();
        setAddress(rawAddress.startsWith('{') ? '' : rawAddress);
        if (agent) { setAgentName(agent.agent_name || 'Agente Principal'); setAgentPrompt(agent.system_prompt || ''); }
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
        body: JSON.stringify({ name, ai_name: aiName, phone: phone ? normalizePhoneBR(phone) : '', broker_address: address }),
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

  async function saveAgent() {
    setSavingAgent(true);
    setAgentSaved(false);
    try {
      const res = await fetch('/api/brokers/my-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ agent_name: agentName || 'Agente Principal', system_prompt: agentPrompt }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error || 'Falha ao salvar.'); }
      setAgentSaved(true);
      setTimeout(() => setAgentSaved(false), 1800);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingAgent(false);
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
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Bot size={11} /> Nome da sua IA</label>
            <input value={aiName} onChange={(e) => setAiName(e.target.value)} placeholder="Ex.: Sofia" className={fieldCls} />
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

      {/* Agente */}
      <GlassCard className="!p-6">
        <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase mb-4">Instruções da sua IA</h3>
        <p className="text-[12px] text-white/40 mb-3">Como a IA deve atender seus clientes — tom, informações, regras.</p>
        <textarea value={agentPrompt} onChange={(e) => setAgentPrompt(e.target.value)} rows={6}
          placeholder="Ex.: Você é a Sofia, atende com simpatia, sempre oferece agendar uma visita..."
          className={`${fieldCls} resize-none`} />
        <div className="flex justify-end mt-4">
          <button onClick={saveAgent} disabled={savingAgent}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
            {savingAgent ? <Loader2 size={15} className="animate-spin" /> : agentSaved ? <Check size={15} /> : null}
            {agentSaved ? 'Salvo' : 'Salvar instruções'}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
