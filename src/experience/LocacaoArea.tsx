import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X, User, Phone, Home as HomeIcon, Calendar, Building2, Pencil, Trash2 } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';
import { centsFromMaskInput, maskFromCents, centsToReais } from '../lib/money';
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from '../lib/features';
import { maskCpfCnpj } from '../lib/document';

// Dark-mode do <select> nativo é inconsistente entre navegadores — Chrome no
// Windows ignora color-scheme pro popup da lista, então estiliza a <option>
// direto (isso ele respeita).
const optionStyle = { backgroundColor: '#1e293b', color: '#fff' };

interface Contract {
  id: string;
  tenant_name: string;
  tenant_phone?: string;
  tenant_cpf_cnpj?: string;
  owner_name: string;
  owner_phone?: string;
  property?: string;
  property_id?: string;
  rent_amount_cents: number;
  due_day: number;
  start_date: string;
  end_date?: string;
  status: 'ativo' | 'encerrado';
  current_month_payment_status?: 'pending' | 'paid' | 'overdue' | 'failed' | null;
}

interface ChargeInfo {
  boleto_url: string | null;
  pix_copy_paste: string | null;
  due_date: string;
  amount_cents: number;
}

const PAYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Pago', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' },
  pending: { label: 'Pendente', cls: 'bg-amber-400/15 text-amber-200 border-amber-300/20' },
  overdue: { label: 'Atrasado', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
};

interface PropertyOption {
  id: string;
  title: string;
}

function NewContractModal({
  properties,
  initial,
  onClose,
  onCreated,
}: {
  properties: PropertyOption[];
  initial?: Contract | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!initial;
  const [tenantName, setTenantName] = useState(initial?.tenant_name || '');
  const [tenantPhone, setTenantPhone] = useState(initial?.tenant_phone ? stripDDI(initial.tenant_phone) : '');
  const [tenantCpf, setTenantCpf] = useState(initial?.tenant_cpf_cnpj ? maskCpfCnpj(initial.tenant_cpf_cnpj) : '');
  const [ownerName, setOwnerName] = useState(initial?.owner_name || '');
  const [ownerPhone, setOwnerPhone] = useState(initial?.owner_phone ? stripDDI(initial.owner_phone) : '');
  const [propertyId, setPropertyId] = useState(initial?.property_id || '');
  const [rentCents, setRentCents] = useState(initial?.rent_amount_cents || 0);
  const [dueDay, setDueDay] = useState(initial ? String(initial.due_day) : '10');
  const [startDate, setStartDate] = useState(initial?.start_date?.slice(0, 10) || new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(initial?.end_date?.slice(0, 10) || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!tenantName.trim()) { setError('Nome do inquilino é obrigatório.'); return; }
    if (!ownerName.trim()) { setError('Nome do proprietário é obrigatório.'); return; }
    if (!rentCents) { setError('Informe o valor do aluguel.'); return; }
    const due = Number(dueDay);
    if (!due || due < 1 || due > 28) { setError('Dia de vencimento deve ser entre 1 e 28.'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(isEdit ? `/api/locacao/contracts/${initial!.id}` : '/api/locacao/contracts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          tenant_name: tenantName, tenant_phone: tenantPhone ? normalizePhoneBR(tenantPhone) : null,
          tenant_cpf_cnpj: tenantCpf ? tenantCpf.replace(/\D/g, '') : null,
          owner_name: ownerName, owner_phone: ownerPhone ? normalizePhoneBR(ownerPhone) : null,
          property_id: propertyId || null,
          rent_amount_cents: rentCents, due_day: due, start_date: startDate,
          end_date: endDate || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Falha ao ${isEdit ? 'editar' : 'criar'} contrato.`);
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || `Falha ao ${isEdit ? 'editar' : 'criar'} contrato.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden
        backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]
        max-h-[85vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--hairline)] shrink-0">
          <h3 className="text-lg font-bold text-[var(--text-hi)]">{isEdit ? 'Editar contrato de locação' : 'Novo contrato de locação'}</h3>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
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
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={11} /> Inquilino
              </label>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Nome completo"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
                <input value={tenantPhone} onChange={(e) => setTenantPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279"
                  className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
              CPF/CNPJ do inquilino
            </label>
            <input value={tenantCpf} onChange={(e) => setTenantCpf(maskCpfCnpj(e.target.value))} placeholder="CPF ou CNPJ" maxLength={18} inputMode="numeric"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
            <p className="text-[10px] text-[var(--text-low)] mt-1">Opcional agora — necessário só quando for gerar a primeira cobrança.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={11} /> Proprietário
              </label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nome completo"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
                <input value={ownerPhone} onChange={(e) => setOwnerPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279"
                  className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <HomeIcon size={11} /> Imóvel (opcional)
            </label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]
                focus:outline-none focus:border-[var(--glass-border-strong)] transition-colors [color-scheme:dark]">
              <option value="" style={optionStyle}>— nenhum —</option>
              {properties.map((p) => <option key={p.id} value={p.id} style={optionStyle}>{p.title}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
                Aluguel (R$)
              </label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">R$</span>
                <input value={maskFromCents(rentCents)} onChange={(e) => setRentCents(centsFromMaskInput(e.target.value))}
                  placeholder="0,00" inputMode="numeric"
                  className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
                Dia de vencimento
              </label>
              <input value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" placeholder="10"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar size={11} /> Início do contrato
              </label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] transition-colors [color-scheme:dark]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar size={11} /> Fim do contrato
              </label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] transition-colors [color-scheme:dark]" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[var(--hairline)] shrink-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30
              hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isEdit ? 'Salvar' : 'Criar'}
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
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [chargeInfo, setChargeInfo] = useState<Record<string, ChargeInfo | undefined>>({});
  const [chargeError, setChargeError] = useState<Record<string, string>>({});

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

  async function handleCharge(c: Contract) {
    setChargingId(c.id);
    setChargeError((cur) => ({ ...cur, [c.id]: '' }));
    try {
      if (!c.current_month_payment_status) {
        const res = await fetch(`/api/locacao/contracts/${c.id}/charge`, {
          method: 'POST', headers: authService.getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Falha ao gerar cobrança.');
        setChargeInfo((cur) => ({ ...cur, [c.id]: data }));
        load();
      } else {
        const res = await fetch(`/api/locacao/contracts/${c.id}/payments`, { headers: authService.getAuthHeaders() });
        const list = await res.json();
        const monthPrefix = new Date().toISOString().slice(0, 7);
        const current = (Array.isArray(list) ? list : []).find((p: any) => p.reference_month?.startsWith(monthPrefix));
        if (current) setChargeInfo((cur) => ({ ...cur, [c.id]: current }));
        else throw new Error('Não achei a cobrança deste mês.');
      }
    } catch (e: any) {
      setChargeError((cur) => ({ ...cur, [c.id]: e.message || 'Erro ao processar cobrança.' }));
    } finally {
      setChargingId(null);
    }
  }

  async function endContract(id: string) {
    if (!confirm('Encerrar este contrato de locação?')) return;
    setEndingId(id);
    try {
      const res = await fetch(`/api/locacao/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status: 'encerrado', end_date: new Date().toISOString().split('T')[0] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao encerrar contrato.');
      }
      load();
    } catch (e: any) {
      alert(e.message || 'Falha ao encerrar contrato.');
    } finally {
      setEndingId(null);
    }
  }

  async function deleteContract(id: string) {
    if (!confirm('Apagar este contrato de locação? Isso remove também as cobranças geradas para ele. Não dá pra desfazer.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/locacao/contracts/${id}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao apagar contrato.');
      }
      load();
    } catch (e: any) {
      alert(e.message || 'Falha ao apagar contrato.');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Locação</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = (contracts || []).length === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-[var(--text-hi)]">Locação</h2>
        <button onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
            bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors">
          <Plus className="w-4 h-4" /> Novo contrato
        </button>
      </div>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Building2 className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)] mb-6">Nenhum contrato de locação ainda.</p>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors">
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
                    <p className="text-[15px] font-bold text-[var(--text-hi)] truncate">{c.tenant_name}</p>
                    <p className="text-[11px] text-[var(--text-low)] truncate">inquilino</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setEditingContract(c)}
                      className="p-1 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteContract(c.id)} disabled={deletingId === c.id}
                      className="p-1 rounded-lg text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                      {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${
                      c.status === 'ativo'
                        ? 'bg-emerald-400/15 text-emerald-200 border border-emerald-300/20'
                        : 'bg-[var(--control-fill)] text-[var(--text-low)] border border-[var(--hairline)]'
                    }`}>
                      {c.status === 'ativo' ? 'Ativo' : 'Encerrado'}
                    </span>
                  </div>
                </div>

                {c.property && (
                  <p className="text-[12px] text-[var(--text-low)] flex items-center gap-1.5 mb-1.5 truncate">
                    <HomeIcon className="w-3.5 h-3.5 shrink-0" /> {c.property}
                  </p>
                )}
                <p className="text-[12px] text-[var(--text-low)] mb-1.5">Proprietário: {c.owner_name}</p>
                <p className="text-[20px] font-black text-[var(--text-hi)] mt-2">{centsToReais(c.rent_amount_cents)}<span className="text-[12px] font-semibold text-[var(--text-low)]">/mês</span></p>
                <p className="text-[11px] text-[var(--text-low)] mt-1">Vencimento todo dia {c.due_day}</p>

                {c.status === 'ativo' && (
                  <>
                    {CLIENT_FINANCIAL_OPERATIONS_ENABLED ? <div className="mt-3 pt-3 border-t border-[var(--hairline)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-[var(--text-low)]">Cobrança do mês</span>
                        {c.current_month_payment_status ? (
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${PAYMENT_LABEL[c.current_month_payment_status]?.cls || 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]'}`}>
                            {PAYMENT_LABEL[c.current_month_payment_status]?.label || c.current_month_payment_status}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-low)]">sem cobrança</span>
                        )}
                      </div>

                      {chargeInfo[c.id] ? (
                        <div className="space-y-1.5">
                          {chargeInfo[c.id]!.boleto_url && (
                            <a href={chargeInfo[c.id]!.boleto_url!} target="_blank" rel="noreferrer"
                              className="block text-center py-2 rounded-xl text-[11px] font-semibold text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                              Ver boleto
                            </a>
                          )}
                          {chargeInfo[c.id]!.pix_copy_paste && (
                            <button onClick={() => navigator.clipboard.writeText(chargeInfo[c.id]!.pix_copy_paste!)}
                              className="w-full py-2 rounded-xl text-[11px] font-semibold text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill)] transition-colors">
                              Copiar código PIX
                            </button>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => handleCharge(c)} disabled={chargingId === c.id}
                          className="w-full py-2 rounded-xl text-[11px] font-semibold text-[var(--text-hi)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                          {chargingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          {c.current_month_payment_status ? 'Ver cobrança' : 'Gerar cobrança do mês'}
                        </button>
                      )}
                      {chargeError[c.id] && <p className="text-[11px] text-red-300 mt-1.5">{chargeError[c.id]}</p>}
                    </div> : (
                      <p className="mt-3 pt-3 border-t border-[var(--hairline)] text-[11px] text-[var(--text-low)]">
                        Pagamentos e cobranças são realizados fora do ImobiFlow.
                      </p>
                    )}

                    <button onClick={() => endContract(c.id)} disabled={endingId === c.id}
                      className="w-full mt-3 py-2 rounded-xl text-[11px] font-semibold text-[var(--text-low)] hover:text-red-300 transition-colors disabled:opacity-40">
                      {endingId === c.id ? 'Encerrando...' : 'Encerrar contrato'}
                    </button>
                  </>
                )}
              </GlassCard>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <NewContractModal properties={properties} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
      {editingContract && (
        <NewContractModal properties={properties} initial={editingContract} onClose={() => setEditingContract(null)} onCreated={load} />
      )}
    </div>
  );
}
