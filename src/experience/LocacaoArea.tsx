import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X, User, Phone, Home as HomeIcon, Calendar, Building2 } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface Contract {
  id: string;
  tenant_name: string;
  tenant_phone?: string;
  owner_name: string;
  owner_phone?: string;
  property?: string;
  property_id?: string;
  rent_amount_cents: number;
  due_day: number;
  start_date: string;
  end_date?: string;
  status: 'ativo' | 'encerrado';
}

interface PropertyOption {
  id: string;
  title: string;
}

function centsToReais(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Aceita "1500", "1500,00" ou "1500.00" digitado e converte pra centavos.
function reaisToCents(raw: string): number {
  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function NewContractModal({
  properties,
  onClose,
  onCreated,
}: {
  properties: PropertyOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [rent, setRent] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!tenantName.trim()) { setError('Nome do inquilino é obrigatório.'); return; }
    if (!ownerName.trim()) { setError('Nome do proprietário é obrigatório.'); return; }
    const cents = reaisToCents(rent);
    if (!cents) { setError('Informe o valor do aluguel.'); return; }
    const due = Number(dueDay);
    if (!due || due < 1 || due > 28) { setError('Dia de vencimento deve ser entre 1 e 28.'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/locacao/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          tenant_name: tenantName, tenant_phone: tenantPhone || null,
          owner_name: ownerName, owner_phone: ownerPhone || null,
          property_id: propertyId || null,
          rent_amount_cents: cents, due_day: due, start_date: startDate,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao criar contrato.');
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar contrato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden
        backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]
        max-h-[85vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 shrink-0">
          <h3 className="text-lg font-bold text-white">Novo contrato de locação</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={11} /> Inquilino
              </label>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Nome completo"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <input value={tenantPhone} onChange={(e) => setTenantPhone(e.target.value)} placeholder="(00) 00000-0000"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={11} /> Proprietário
              </label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nome completo"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="(00) 00000-0000"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <HomeIcon size={11} /> Imóvel (opcional)
            </label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12
                focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]">
              <option value="">— nenhum —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
                Aluguel (R$)
              </label>
              <input value={rent} onChange={(e) => setRent(e.target.value)} placeholder="1500,00" inputMode="decimal"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">
                Dia de vencimento
              </label>
              <input value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" placeholder="10"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar size={11} /> Início do contrato
            </label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12
                focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]" />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30
              hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

// Locação real: núcleo (Etapa 6 do UX_MASTERPLAN.md) — CRUD de contrato de
// aluguel. Reajuste automático, repasse, boletos, DIMOB, vistoria e portal do
// locatário/proprietário ficam para uma rodada futura (dependem de integração
// com índice de reajuste, split de pagamento e emissão fiscal reais).
export function LocacaoArea() {
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/locacao/contracts', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar contratos.`);
        }
        return r.json();
      })
      .then((data) => setContracts(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message || 'Erro ao carregar contratos.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetch('/api/properties', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .catch(() => setProperties([]));
  }, []);

  async function endContract(id: string) {
    if (!confirm('Encerrar este contrato de locação?')) return;
    setEndingId(id);
    try {
      await fetch(`/api/locacao/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status: 'encerrado', end_date: new Date().toISOString().split('T')[0] }),
      });
      load();
    } finally {
      setEndingId(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Locação</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = (contracts || []).length === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-white">Locação</h2>
        <button onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white
            bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors">
          <Plus className="w-4 h-4" /> Novo contrato
        </button>
      </div>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-white/[0.06] border border-white/12">
            <Building2 className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60 mb-6">Nenhum contrato de locação ainda.</p>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors">
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {contracts!.map((c) => (
            <div key={c.id}>
              <GlassCard className="!p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-white truncate">{c.tenant_name}</p>
                    <p className="text-[11px] text-white/40 truncate">inquilino</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${
                    c.status === 'ativo'
                      ? 'bg-emerald-400/15 text-emerald-200 border border-emerald-300/20'
                      : 'bg-white/[0.04] text-white/30 border border-white/10'
                  }`}>
                    {c.status === 'ativo' ? 'Ativo' : 'Encerrado'}
                  </span>
                </div>

                {c.property && (
                  <p className="text-[12px] text-white/45 flex items-center gap-1.5 mb-1.5 truncate">
                    <HomeIcon className="w-3.5 h-3.5 shrink-0" /> {c.property}
                  </p>
                )}
                <p className="text-[12px] text-white/45 mb-1.5">Proprietário: {c.owner_name}</p>
                <p className="text-[20px] font-black text-white mt-2">{centsToReais(c.rent_amount_cents)}<span className="text-[12px] font-semibold text-white/40">/mês</span></p>
                <p className="text-[11px] text-white/35 mt-1">Vencimento todo dia {c.due_day}</p>

                {c.status === 'ativo' && (
                  <button onClick={() => endContract(c.id)} disabled={endingId === c.id}
                    className="w-full mt-4 py-2 rounded-xl text-[11px] font-semibold text-white/40 hover:text-red-300 transition-colors disabled:opacity-40">
                    {endingId === c.id ? 'Encerrando...' : 'Encerrar contrato'}
                  </button>
                )}
              </GlassCard>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <NewContractModal properties={properties} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}
