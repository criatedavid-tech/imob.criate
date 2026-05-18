import React, { useState, useEffect } from 'react';
import { Building2, Save, Loader2, Hash, FileText, MapPin, Phone, Mail, Users, CheckCircle2, XCircle } from 'lucide-react';
import { authService } from '../services/auth';

const inputClass =
  'w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium ' +
  'text-white placeholder:text-white/30 bg-white/10 border border-white/15 ' +
  'focus:ring-2 focus:ring-white/25 focus:bg-white/15 [color-scheme:dark]';

interface Corretora {
  id?: string;
  razao_social: string;
  cnpj: string;
  creci_empresa: string;
  endereco: string;
  telefone: string;
  email: string;
}

const empty: Corretora = { razao_social: '', cnpj: '', creci_empresa: '', endereco: '', telefone: '', email: '' };

export default function CorretoraSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Corretora>(empty);
  const [isOwner, setIsOwner] = useState(false);
  const [linkedBrokers, setLinkedBrokers] = useState<any[]>([]);
  const [message, setMessage] = useState<{ type: string; text: string }>({ type: '', text: '' });

  useEffect(() => { fetchCorretora(); }, []);

  const fetchCorretora = async () => {
    try {
      const res = await fetch('/api/corretora', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.corretora) {
          setForm({
            razao_social: data.corretora.razao_social || '',
            cnpj: data.corretora.cnpj || '',
            creci_empresa: data.corretora.creci_empresa || '',
            endereco: data.corretora.endereco || '',
            telefone: data.corretora.telefone || '',
            email: data.corretora.email || ''
          });
          setIsOwner(!!data.isOwner);
          if (data.isOwner) fetchLinkedBrokers();
        }
      }
    } catch (error) {
      console.error('Erro ao buscar corretora:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLinkedBrokers = async () => {
    try {
      const res = await fetch('/api/corretora/brokers', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLinkedBrokers(data.brokers || []);
      }
    } catch { /* silencioso */ }
  };

  const formatCnpj = (v: string) =>
    v.replace(/\D/g, '').slice(0, 14)
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/corretora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ ...form, cnpj: form.cnpj.replace(/\D/g, '') })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      setIsOwner(!!data.isOwner);
      if (data.isOwner) fetchLinkedBrokers();
      setMessage({ type: 'success', text: 'Corretora salva e vinculada com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao salvar corretora.' });
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
    <div className="max-w-2xl mx-auto py-2 space-y-6">
      <div className="rounded-3xl overflow-hidden
        backdrop-blur-xl bg-white/10 border border-white/15
        shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">

        <div className="px-8 py-6 border-b border-white/10 backdrop-blur-md bg-white/5">
          <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <Building2 className="text-white/60 w-5 h-5" />
            Corretora que você representa
          </h2>
          <p className="text-white/50 text-sm mt-1">
            Cadastre os dados da imobiliária. Use o mesmo CNPJ para vincular vários corretores à mesma corretora.
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
                : <XCircle className="w-4 h-4 shrink-0" />}
              {message.text}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Razão Social</label>
            <div className="relative">
              <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
              <input required value={form.razao_social}
                onChange={e => setForm({ ...form, razao_social: e.target.value })}
                className={`${inputClass} pl-11 pr-4`} placeholder="Imobiliária Exemplo LTDA" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CNPJ</label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input required value={form.cnpj}
                  onChange={e => setForm({ ...form, cnpj: formatCnpj(e.target.value) })}
                  className={`${inputClass} pl-11 pr-4`} placeholder="00.000.000/0000-00" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CRECI da Empresa</label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input value={form.creci_empresa}
                  onChange={e => setForm({ ...form, creci_empresa: e.target.value })}
                  className={`${inputClass} pl-11 pr-4`} placeholder="CRECI-GO J-0000" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Endereço</label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
              <input value={form.endereco}
                onChange={e => setForm({ ...form, endereco: e.target.value })}
                className={`${inputClass} pl-11 pr-4`} placeholder="Rua, Número, Bairro, Cidade - UF" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Telefone</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input value={form.telefone}
                  onChange={e => setForm({ ...form, telefone: e.target.value })}
                  className={`${inputClass} pl-11 pr-4`} placeholder="(00) 00000-0000" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" size={16} />
                <input type="email" value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className={`${inputClass} pl-11 pr-4`} placeholder="contato@imobiliaria.com" />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button type="submit" disabled={saving}
              className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-white
                transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed
                backdrop-blur-md bg-white/15 border border-white/25
                shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
                hover:bg-white/25">
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              Salvar Corretora
            </button>
          </div>
        </form>
      </div>

      {isOwner && (
        <div className="rounded-3xl overflow-hidden
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">
          <div className="px-8 py-6 border-b border-white/10 backdrop-blur-md bg-white/5">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <Users className="text-white/60 w-5 h-5" />
              Corretores vinculados ({linkedBrokers.length})
            </h2>
            <p className="text-white/50 text-sm mt-1">
              Você é o administrador desta corretora. Estes são os corretores vinculados ao mesmo CNPJ.
            </p>
          </div>
          <div className="p-8">
            {linkedBrokers.length === 0 ? (
              <p className="text-white/40 text-sm text-center py-6">Nenhum corretor vinculado ainda.</p>
            ) : (
              <div className="space-y-2">
                {linkedBrokers.map(b => (
                  <div key={b.id} className="flex items-center justify-between p-4 rounded-2xl
                    bg-white/5 border border-white/10">
                    <div>
                      <p className="text-white font-semibold text-sm">{b.name || 'Sem nome'}</p>
                      <p className="text-white/40 text-xs">{b.email}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-3 py-1 rounded-full border ${
                      b.status === 'ativo'
                        ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                        : 'bg-amber-500/20 border-amber-400/30 text-amber-300'
                    }`}>
                      {b.status || 'pendente'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
