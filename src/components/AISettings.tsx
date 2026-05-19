import React, { useState, useEffect } from 'react';
import { Settings, Save, Loader2, User, Phone, MapPin, Bot, CheckCircle2, XCircle, Key, Trash2, ExternalLink } from 'lucide-react';
import { authService } from '../services/auth';

const inputClass =
  'w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

export default function AISettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    name: '',
    phone: '',
    ai_name: '',
    broker_address: ''
  });
  const [message, setMessage] = useState<{ type: string; text: string }>({ type: '', text: '' });

  // OpenRouter key state
  const [orKey, setOrKey] = useState('');
  const [orHasKey, setOrHasKey] = useState(false);
  const [orSaving, setOrSaving] = useState(false);
  const [orMessage, setOrMessage] = useState<{ type: string; text: string }>({ type: '', text: '' });

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/brokers/me', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          name: data.name || '',
          phone: data.phone || '',
          ai_name: data.ai_name || '',
          broker_address: data.broker_address || ''
        });
        setOrHasKey(!!data.openrouter_api_key_enc);
      }
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOrKey = async () => {
    if (!orKey.trim()) return;
    setOrSaving(true);
    setOrMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/brokers/openrouter-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ api_key: orKey.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar');
      setOrHasKey(true);
      setOrKey('');
      setOrMessage({ type: 'success', text: 'Chave salva com sucesso!' });
    } catch (err: any) {
      setOrMessage({ type: 'error', text: err.message });
    } finally {
      setOrSaving(false);
    }
  };

  const handleRemoveOrKey = async () => {
    if (!confirm('Remover sua chave OpenRouter? O sistema usará a chave da empresa como fallback.')) return;
    setOrSaving(true);
    try {
      await fetch('/api/brokers/openrouter-key', { method: 'DELETE', headers: authService.getAuthHeaders() });
      setOrHasKey(false);
      setOrMessage({ type: 'success', text: 'Chave removida.' });
    } catch {
      setOrMessage({ type: 'error', text: 'Erro ao remover.' });
    } finally {
      setOrSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/brokers/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error();
      setMessage({ type: 'success', text: 'Configurações salvas com sucesso!' });
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar configurações.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-white/30 w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-2">
      <div className="rounded-3xl overflow-hidden
        backdrop-blur-xl bg-white/10 border border-white/15
        shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">

        {/* Header do card */}
        <div className="px-8 py-6 border-b border-white/10 backdrop-blur-md bg-white/5">
          <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <Settings className="text-white/60 w-5 h-5" />
            Configurações da Imobiliária & IA
          </h2>
          <p className="text-white/50 text-sm mt-1">
            Personalize as informações que a IA usará para atender seus clientes.
          </p>
        </div>

        <form onSubmit={handleSave} className="p-8 space-y-6">
          {message.text && (
            <div className={`flex items-center gap-2 p-4 rounded-2xl text-sm font-medium border ${
              message.type === 'success'
                ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                : 'bg-red-500/20 border-red-400/30 text-red-300'
            }`}>
              {message.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <XCircle className="w-4 h-4 shrink-0" />
              }
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
                Nome do Corretor / Imobiliária
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input
                  value={settings.name}
                  onChange={e => setSettings({ ...settings, name: e.target.value })}
                  className={`${inputClass} pl-11 pr-4`}
                  placeholder="Nome Exemplo"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
                Telefone de Contato
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input
                  value={settings.phone}
                  onChange={e => setSettings({ ...settings, phone: e.target.value })}
                  className={`${inputClass} pl-11 pr-4`}
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
              Endereço da Corretora
            </label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
              <input
                value={settings.broker_address}
                onChange={e => setSettings({ ...settings, broker_address: e.target.value })}
                className={`${inputClass} pl-11 pr-4`}
                placeholder="Rua, Número, Bairro, Cidade - UF"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">
              Nome da sua Assistente IA
            </label>
            <div className="relative">
              <Bot className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
              <input
                value={settings.ai_name}
                onChange={e => setSettings({ ...settings, ai_name: e.target.value })}
                className={`${inputClass} pl-11 pr-4`}
                placeholder="Ex: Bia, Assistente Virtual"
              />
            </div>
            <p className="text-[11px] text-white/30 mt-2 italic px-1">
              * Este nome será usado pela IA ao interagir com leads vindos dos seus anúncios.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-white
                transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed
                backdrop-blur-md bg-white/15 border border-white/25
                shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
                hover:bg-white/25"
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Salvar Configurações
            </button>
          </div>
        </form>

        {/* ── Seção: Chave OpenRouter (IA individual) ── */}
        <div className="border-t border-white/10 px-8 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key size={15} className="text-white/50" />
                Chave OpenRouter Pessoal
              </h3>
              <p className="text-[11px] text-white/40 mt-0.5">
                Sua IA usa esta chave — você é cobrado diretamente pelo OpenRouter.{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
                   className="text-white/60 underline underline-offset-2 inline-flex items-center gap-0.5 hover:text-white/80">
                  Obter chave <ExternalLink size={10} />
                </a>
              </p>
            </div>
            {orHasKey && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                ✓ configurada
              </span>
            )}
          </div>

          {orMessage.text && (
            <div className={`flex items-center gap-2 p-3 rounded-2xl text-xs font-medium border ${
              orMessage.type === 'success'
                ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                : 'bg-red-500/20 border-red-400/30 text-red-300'
            }`}>
              {orMessage.type === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {orMessage.text}
            </div>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={14} />
              <input
                type="password"
                value={orKey}
                onChange={e => setOrKey(e.target.value)}
                placeholder={orHasKey ? '••••••••••••••••••• (substituir)' : 'sk-or-v1-...'}
                className={`${inputClass} pl-10 pr-4 text-xs`}
              />
            </div>
            <button
              onClick={handleSaveOrKey}
              disabled={orSaving || !orKey.trim()}
              className="px-4 py-3 rounded-2xl font-bold text-xs text-white flex items-center gap-1.5
                backdrop-blur-md bg-white/15 border border-white/25 hover:bg-white/25
                disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {orSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Salvar
            </button>
            {orHasKey && (
              <button
                onClick={handleRemoveOrKey}
                disabled={orSaving}
                title="Remover chave"
                className="px-3 py-3 rounded-2xl text-white/50 hover:text-red-400
                  backdrop-blur-md bg-white/10 border border-white/15 hover:border-red-400/30
                  disabled:opacity-40 transition-all"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/30 italic px-1">
            * Chave armazenada criptografada (AES-256). Sem chave própria, a IA usa a chave padrão da plataforma.
          </p>
        </div>
      </div>
    </div>
  );
}
