import React, { useState, useEffect } from 'react';
import { Settings, Save, Loader2, User, Phone, MapPin, Bot } from 'lucide-react';
import { authService } from '../services/auth';

export default function AISettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    name: '',
    phone: '',
    ai_name: '',
    broker_address: ''
  });
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/brokers/me', {
        headers: authService.getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          name: data.name || '',
          phone: data.phone || '',
          ai_name: data.ai_name || '',
          broker_address: data.broker_address || ''
        });
      }
    } catch (error) {
      console.error("Erro ao buscar configurações:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: '', text: '' });

    try {
      const res = await fetch('/api/brokers/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authService.getAuthHeaders()
        },
        body: JSON.stringify(settings)
      });

      if (!res.ok) throw new Error();
      
      setMessage({ type: 'success', text: 'Configurações salvas com sucesso!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao salvar configurações.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-black" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="bg-white rounded-3xl border border-[#E5E7EB] overflow-hidden shadow-sm">
        <div className="p-8 border-b border-[#E5E7EB] bg-[#F9FAFB]">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Settings className="text-[#1A1A1A]" />
            Configurações da Imobiliária & IA
          </h2>
          <p className="text-[#6B7280] mt-1">Personalize as informações que a IA usará para atender seus clientes.</p>
        </div>

        <form onSubmit={handleSave} className="p-8 space-y-6">
          {message.text && (
            <div className={`p-4 rounded-2xl text-sm font-medium border ${message.type === 'success' ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                Nome do Corretor / Imobiliária
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={16} />
                <input
                  value={settings.name}
                  onChange={e => setSettings({...settings, name: e.target.value})}
                  className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm font-medium"
                  placeholder="Nome Exemplo"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                Telefone de Contato
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={16} />
                <input
                  value={settings.phone}
                  onChange={e => setSettings({...settings, phone: e.target.value})}
                  className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm font-medium"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
              Endereço da Corretora
            </label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={16} />
              <input
                value={settings.broker_address}
                onChange={e => setSettings({...settings, broker_address: e.target.value})}
                className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm font-medium"
                placeholder="Rua, Número, Bairro, Cidade - UF"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E7EB]">
            <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
              Nome da sua Assistente IA
            </label>
            <div className="relative">
              <Bot className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={16} />
              <input
                value={settings.ai_name}
                onChange={e => setSettings({...settings, ai_name: e.target.value})}
                className="w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all text-sm font-medium"
                placeholder="Ex: Bia, Assistente Virtual"
              />
            </div>
            <p className="text-[11px] text-[#9CA3AF] mt-2 italic px-1">
              * Este nome será usado pela IA ao interagir com leads vindos dos seus anúncios.
            </p>
          </div>

          <div className="pt-6">
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-black text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#333] transition-all disabled:opacity-50 shadow-lg shadow-black/5"
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Salvar Configurações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
