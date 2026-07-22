import React, { useEffect, useState } from 'react';
import { Bot, Check, Loader2, Zap, Clock, MessageSquare } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface BrokerAISettings {
  ai_name?: string | null;
}

interface AgentSettings {
  agent_name?: string | null;
  system_prompt?: string | null;
}

// Design system do /app (mesmos tokens da Personalidade da IA / ConfigArea).
const fieldCls =
  'w-full rounded-xl px-4 py-3 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)] focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors';

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return body?.error || fallback;
}

export function AssistenteIAArea() {
  const [aiName, setAiName] = useState('');
  const [agentName, setAgentName] = useState('Agente Principal');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [meResponse, agentResponse] = await Promise.all([
          fetch('/api/brokers/me', { headers: authService.getAuthHeaders() }),
          fetch('/api/brokers/my-agent', { headers: authService.getAuthHeaders() }),
        ]);

        if (!meResponse.ok) throw new Error(await readError(meResponse, 'Não consegui carregar o nome da sua IA.'));
        if (!agentResponse.ok) throw new Error(await readError(agentResponse, 'Não consegui carregar as instruções da sua IA.'));

        const me = await meResponse.json() as BrokerAISettings;
        const agent = await agentResponse.json() as AgentSettings;
        if (cancelled) return;

        setAiName(me.ai_name || '');
        setAgentName(agent.agent_name || 'Agente Principal');
        setAgentPrompt(agent.system_prompt || '');
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Erro ao carregar as configurações da IA.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  async function saveAISettings() {
    setSaving(true);
    setSaved(false);
    setError('');

    try {
      const [nameResponse, agentResponse] = await Promise.all([
        fetch('/api/brokers/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({ ai_name: aiName }),
        }),
        fetch('/api/brokers/my-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({ agent_name: agentName || 'Agente Principal', system_prompt: agentPrompt }),
        }),
      ]);

      if (!nameResponse.ok) throw new Error(await readError(nameResponse, 'Falha ao salvar o nome da IA.'));
      if (!agentResponse.ok) throw new Error(await readError(agentResponse, 'Falha ao salvar as instruções da IA.'));

      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar as configurações da IA.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-black text-[var(--text-hi)]">Assistente IA</h2>
        <p className="text-[13px] text-[var(--text-low)] mt-1">Defina como sua assistente se apresenta, atende e retoma conversas.</p>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl px-4 py-3 text-[13px] text-red-200 bg-red-500/10 border border-red-400/20">
          {error}
        </div>
      )}

      <GlassCard className="!p-6">
        <div className="flex items-center gap-2 mb-5">
          <Bot className="w-4 h-4 text-[var(--text-low)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Personalidade da sua IA</h3>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5">Nome da sua IA</label>
            <input
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder="Ex.: Sofia"
              className={fieldCls}
            />
            <p className="text-[11px] text-[var(--text-low)] mt-2">Esse nome é usado pela IA ao interagir com seus leads.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5">Instruções personalizadas para a IA</label>
            <textarea
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              rows={7}
              placeholder={'Ex.: Atenda com simpatia e sempre ofereça agendar uma visita.\nNão informe preços sem antes entender o orçamento do cliente.'}
              className={`${fieldCls} resize-none`}
            />
            <p className="text-[11px] text-[var(--text-low)] mt-2">Essas instruções orientam todos os atendimentos da sua IA.</p>
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={saveAISettings}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
            {saved ? 'Configurações salvas' : 'Salvar configurações'}
          </button>
        </div>
      </GlassCard>

      <FollowUpCard fieldCls={fieldCls} />
    </div>
  );
}

// ─── Follow-Up Inteligente ────────────────────────────────────────────────
// Reescrito no design system do /app (GlassCard, fieldCls, botão azul) pra
// ficar uniforme com a Personalidade da IA acima. O componente legado
// src/components/FollowUpSettings.tsx segue existindo pro Dashboard 1.0 (/),
// que usa o design antigo de forma consistente — não mexer lá.

interface Cfg {
  enabled: boolean;
  delay_minutes_1: number;
  delay_minutes_2: number;
  delay_minutes_3: number;
  message_1: string;
  message_2: string;
  message_3: string;
}

const FOLLOWS = [
  {
    msgKey: 'message_1' as const,
    delayKey: 'delay_minutes_1' as const,
    label: 'Follow 1',
    delayLabel: 'Enviar após silêncio do cliente (minutos)',
    delayHint: 'Contado a partir da última mensagem do cliente. Produção recomendada: 1440 (24h)',
    placeholder: 'Olá! Vi que você demonstrou interesse no imóvel. Posso tirar alguma dúvida?',
  },
  {
    msgKey: 'message_2' as const,
    delayKey: 'delay_minutes_2' as const,
    label: 'Follow 2',
    delayLabel: 'Enviar após o Follow 1 (minutos)',
    delayHint: 'Contado a partir de quando o Follow 1 foi enviado. Produção recomendada: 4320 (72h)',
    placeholder: 'Ainda tem interesse nesse imóvel? Posso te enviar mais detalhes.',
  },
  {
    msgKey: 'message_3' as const,
    delayKey: 'delay_minutes_3' as const,
    label: 'Follow 3',
    delayLabel: 'Enviar após o Follow 2 (minutos)',
    delayHint: 'Contado a partir de quando o Follow 2 foi enviado. Produção recomendada: 10080 (7 dias)',
    placeholder: 'Esse imóvel ainda está disponível e com bastante procura. 😊',
  },
];

const hms = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h}h` : ''}${m ? ` ${m}min` : h ? '' : '0min'}`.trim();
};

function FollowUpCard({ fieldCls }: { fieldCls: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [cfg, setCfg] = useState<Cfg>({
    enabled: false,
    delay_minutes_1: 30,
    delay_minutes_2: 120,
    delay_minutes_3: 1440,
    message_1: '',
    message_2: '',
    message_3: '',
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/followup/config', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setCfg({
          enabled: !!d.enabled,
          delay_minutes_1: Number(d.delay_minutes_1) || 30,
          delay_minutes_2: Number(d.delay_minutes_2) || 120,
          delay_minutes_3: Number(d.delay_minutes_3) || 1440,
          message_1: d.message_1 || '',
          message_2: d.message_2 || '',
          message_3: d.message_3 || '',
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(cfgOverride?: Cfg) {
    const cfgToSave = cfgOverride ?? cfg;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await fetch('/api/followup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ ...cfgToSave, strategy: 'progressive' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro ao salvar.');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar o follow-up.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <GlassCard className="!p-6 mt-5">
        <div className="flex justify-center py-4"><Loader2 className="animate-spin text-[var(--text-low)] w-5 h-5" /></div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="!p-6 mt-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[var(--text-low)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Follow-Up Inteligente</h3>
          </div>
          <p className="text-[12px] text-[var(--text-low)] mt-1.5">
            Reativa automaticamente o lead que parou de responder — envia 1 mensagem por vez (Follow 1 → 2 → 3).
          </p>
        </div>
        <button
          type="button"
          onClick={() => { const next = { ...cfg, enabled: !cfg.enabled }; setCfg(next); save(next); }}
          aria-label="Ativar follow-up"
          className={`relative shrink-0 w-12 h-7 rounded-full transition-colors mt-0.5 border ${
            cfg.enabled ? 'bg-emerald-500/70 border-emerald-300/40' : 'bg-[var(--control-fill-hover)] border-[var(--glass-border)]'
          }`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${cfg.enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl px-4 py-3 text-[13px] text-red-200 bg-red-500/10 border border-red-400/20">
          {error}
        </div>
      )}

      <div className={`space-y-4 transition-opacity ${cfg.enabled ? '' : 'opacity-50 pointer-events-none select-none'}`}>
        {FOLLOWS.map((f) => (
          <div key={f.msgKey} className="rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare size={13} className="text-[var(--text-low)]" />
              <span className="text-[10px] font-bold text-[var(--text-low)] uppercase tracking-widest">{f.label}</span>
            </div>

            <div>
              <label className="block text-[10px] text-[var(--text-low)] mb-1.5 uppercase tracking-wider">{f.delayLabel}</label>
              <div className="flex items-center gap-3">
                <div className="relative w-40">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-low)] pointer-events-none" size={14} />
                  <input
                    type="number"
                    min={1}
                    value={cfg[f.delayKey]}
                    onChange={(e) => setCfg({ ...cfg, [f.delayKey]: Math.max(1, Number(e.target.value) || 1) })}
                    className={`${fieldCls} !pl-9 !py-2.5`}
                  />
                </div>
                <span className="text-[11px] text-[var(--text-low)]">≈ {hms(cfg[f.delayKey])}</span>
              </div>
              <p className="text-[10px] text-[var(--text-low)] mt-1">{f.delayHint}</p>
            </div>

            <div>
              <label className="block text-[10px] text-[var(--text-low)] mb-1.5 uppercase tracking-wider">Mensagem</label>
              <textarea
                rows={2}
                value={cfg[f.msgKey]}
                onChange={(e) => setCfg({ ...cfg, [f.msgKey]: e.target.value })}
                placeholder={f.placeholder}
                className={`${fieldCls} resize-none`}
              />
            </div>
          </div>
        ))}

        <p className="text-[11px] text-[var(--text-low)]">
          Se o cliente responder, o ciclo reinicia o contador e, no próximo silêncio, envia o próximo follow. Após o Follow 3, para.
          Se você responder manualmente, o agente é interrompido naquela conversa.
        </p>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => save()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
            {saved ? 'Follow-Up salvo' : 'Salvar Follow-Up'}
          </button>
        </div>
      </div>
    </GlassCard>
  );
}
