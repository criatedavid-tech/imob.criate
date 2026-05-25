import React, { useState, useEffect } from 'react';
import { Zap, Save, Loader2, Clock, MessageSquare, CheckCircle2, XCircle } from 'lucide-react';
import { authService } from '../services/auth';

const inputClass =
  'w-full py-3 px-4 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

interface Cfg {
  enabled: boolean;
  delay_minutes: number;
  message_1: string;
  message_2: string;
  message_3: string;
}

const FOLLOWS = [
  { key: 'message_1' as const, label: 'Follow 1', placeholder: 'Olá! Vi que você demonstrou interesse no imóvel. Posso tirar alguma dúvida?' },
  { key: 'message_2' as const, label: 'Follow 2', placeholder: 'Ainda tem interesse nesse imóvel? Posso te enviar mais detalhes.' },
  { key: 'message_3' as const, label: 'Follow 3', placeholder: 'Esse imóvel ainda está disponível e com bastante procura. 😊' },
];

export default function FollowUpSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<Cfg>({ enabled: false, delay_minutes: 180, message_1: '', message_2: '', message_3: '' });
  const [message, setMessage] = useState<{ type: string; text: string }>({ type: '', text: '' });

  useEffect(() => { fetchCfg(); }, []);

  const fetchCfg = async () => {
    try {
      const res = await fetch('/api/followup/config', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const d = await res.json();
        setCfg({
          enabled: !!d.enabled,
          delay_minutes: Number(d.delay_minutes) || 180,
          message_1: d.message_1 || '',
          message_2: d.message_2 || '',
          message_3: d.message_3 || '',
        });
      }
    } catch (err) {
      console.error('Erro ao buscar follow-up:', err);
    } finally {
      setLoading(false);
    }
  };

  const save = async (cfgOverride?: Cfg) => {
    const cfgToSave = cfgOverride ?? cfg;
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/followup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ ...cfgToSave, strategy: 'progressive' }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar');
      setMessage({ type: 'success', text: 'Follow-Up salvo com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const hms = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h ? `${h}h` : ''}${m ? ` ${m}min` : (h ? '' : '0min')}`.trim();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-white/30 w-6 h-6" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto py-2 mt-6">
      <div className="rounded-3xl overflow-hidden backdrop-blur-xl bg-white/10 border border-white/15
        shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">

        {/* Header + toggle principal */}
        <div className="px-8 py-6 border-b border-white/10 backdrop-blur-md bg-white/5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <Zap className="text-white/60 w-5 h-5" />
              Follow-Up Inteligente
            </h2>
            <p className="text-white/50 text-sm mt-1">
              Reativa automaticamente o lead que parou de responder — envia 1 mensagem por vez (Follow 1 → 2 → 3).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const newCfg = { ...cfg, enabled: !cfg.enabled };
              setCfg(newCfg);
              save(newCfg);
            }}
            aria-label="Ativar follow-up"
            className={`relative shrink-0 w-12 h-7 rounded-full transition-colors mt-1 border ${
              cfg.enabled ? 'bg-emerald-500/70 border-emerald-300/40' : 'bg-white/10 border-white/20'
            }`}
          >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${cfg.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className={`p-8 space-y-6 transition-opacity ${cfg.enabled ? '' : 'opacity-50 pointer-events-none select-none'}`}>
          {message.text && (
            <div className={`flex items-center gap-2 p-4 rounded-2xl text-sm font-medium border ${
              message.type === 'success'
                ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                : 'bg-red-500/20 border-red-400/30 text-red-300'
            }`}>
              {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              {message.text}
            </div>
          )}

          {/* Tempo */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
              Tempo sem resposta antes de enviar o follow (minutos)
            </label>
            <div className="relative max-w-[220px]">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
              <input
                type="number" min={1}
                value={cfg.delay_minutes}
                onChange={e => setCfg({ ...cfg, delay_minutes: Math.max(1, Number(e.target.value) || 1) })}
                className={`${inputClass} pl-11`}
              />
            </div>
            <p className="text-[11px] text-white/30 mt-2 italic px-1">≈ {hms(cfg.delay_minutes)} (padrão: 180 = 3h)</p>
          </div>

          {/* Mensagens */}
          <div className="space-y-4 pt-2 border-t border-white/10">
            {FOLLOWS.map((f, i) => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1 flex items-center gap-1.5">
                  <MessageSquare size={11} /> {f.label}
                </label>
                <textarea
                  rows={2}
                  value={cfg[f.key]}
                  onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  className={`${inputClass} resize-none`}
                />
              </div>
            ))}
            <p className="text-[11px] text-white/30 italic px-1">
              * Envia 1 follow por vez. Se o cliente responder, o ciclo reinicia o contador e, no próximo silêncio, envia o próximo follow. Após o Follow 3, para.
              Se você (corretor) responder manualmente, o agente é interrompido naquela conversa.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-white
                transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed
                backdrop-blur-md bg-white/15 border border-white/25
                shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)] hover:bg-white/25"
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Salvar Follow-Up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
