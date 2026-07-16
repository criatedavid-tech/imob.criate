import React, { useEffect, useState } from 'react';
import { Bot, Check, Loader2 } from 'lucide-react';
import FollowUpSettings from '../components/FollowUpSettings';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface BrokerAISettings {
  ai_name?: string | null;
}

interface AgentSettings {
  agent_name?: string | null;
  system_prompt?: string | null;
}

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

  const fieldCls = 'w-full rounded-xl px-4 py-3 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors';

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="text-2xl font-black text-white">Assistente IA</h2>
        <p className="text-[13px] text-white/45 mt-1">Defina como sua assistente se apresenta, atende e retoma conversas.</p>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl px-4 py-3 text-[13px] text-red-200 bg-red-500/10 border border-red-400/20">
          {error}
        </div>
      )}

      <GlassCard className="!p-6">
        <div className="flex items-center gap-2 mb-5">
          <Bot className="w-4 h-4 text-white/45" />
          <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Personalidade da sua IA</h3>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Nome da sua IA</label>
            <input
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder="Ex.: Sofia"
              className={fieldCls}
            />
            <p className="text-[11px] text-white/30 mt-2">Esse nome é usado pela IA ao interagir com seus leads.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5">Instruções personalizadas para a IA</label>
            <textarea
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              rows={7}
              placeholder={'Ex.: Atenda com simpatia e sempre ofereça agendar uma visita.\nNão informe preços sem antes entender o orçamento do cliente.'}
              className={`${fieldCls} resize-none`}
            />
            <p className="text-[11px] text-white/30 mt-2">Essas instruções orientam todos os atendimentos da sua IA.</p>
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={saveAISettings}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
            {saved ? 'Configurações salvas' : 'Salvar configurações'}
          </button>
        </div>
      </GlassCard>

      <FollowUpSettings />
    </div>
  );
}
