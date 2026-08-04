import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X, User, Phone, Home as HomeIcon, Calendar, Building2, Pencil, Trash2, ReceiptText, Users, History, Mail } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { RentalDashboard, AvailableTab, ContractDiaryModal, type RentalDashboardData } from './LocacaoPanels';
import { CobrancaTab } from './CobrancaPanel';
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
  tenant_id?: string;
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
  notes?: string;
  rental_type?: 'residencial' | 'comercial' | 'temporada';
  administration_fee_percent?: number;
  late_fee_percent?: number;
  monthly_interest_percent?: number;
  guarantee_type?: 'sem_garantia' | 'caucao_dinheiro' | 'fiador' | 'seguro_fianca' | 'cessao_fiduciaria';
  guarantee_amount_cents?: number;
  guarantee_notes?: string;
  iptu_amount_cents?: number;
  iptu_payer?: 'inquilino' | 'proprietario';
  condominium_amount_cents?: number;
  condominium_payer?: 'inquilino' | 'proprietario';
  fire_insurance_amount_cents?: number;
  fire_insurance_payer?: 'inquilino' | 'proprietario';
  other_charges_description?: string;
  other_charges_cents?: number;
  other_charges_payer?: 'inquilino' | 'proprietario';
  adjustment_index?: 'sem_reajuste' | 'ipca' | 'igpm' | 'outro';
  adjustment_interval_months?: number;
  next_adjustment_date?: string;
  current_month_payment_status?: PaymentStatus | null;
  tenant_profile?: Pick<Tenant, 'id' | 'full_name' | 'phone' | 'email' | 'cpf_cnpj' | 'status'> | null;
}

interface TenantContractHistory {
  id: string;
  property_id?: string | null;
  property?: string | null;
  rent_amount_cents: number;
  start_date: string;
  end_date?: string | null;
  status: 'ativo' | 'encerrado';
}

interface Tenant {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  cpf_cnpj?: string | null;
  birth_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  status: 'ativo' | 'inativo';
  contract_history: TenantContractHistory[];
}

type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'negotiated' | 'canceled' | 'failed';

interface PaymentReceipt {
  id: string;
  amount_cents: number;
  payment_method: 'pix' | 'transferencia' | 'boleto' | 'dinheiro' | 'cartao' | 'outro';
  received_at: string;
  notes?: string | null;
}

interface RentalPayment {
  id: string;
  source: 'external' | 'asaas';
  reference_month: string;
  due_date: string;
  status: PaymentStatus;
  rent_amount_cents: number;
  charges_cents: number;
  discount_cents: number;
  amount_cents: number;
  amount_paid_cents: number;
  remaining_cents: number;
  line_items: Array<{ code: string; label: string; amount_cents: number }>;
  receipts: PaymentReceipt[];
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
  partial: { label: 'Parcial', cls: 'bg-sky-400/15 text-sky-200 border-sky-300/20' },
  overdue: { label: 'Atrasado', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
  negotiated: { label: 'Negociado', cls: 'bg-violet-400/15 text-violet-200 border-violet-300/20' },
  canceled: { label: 'Cancelado', cls: 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-300 border-red-400/20' },
};

interface PropertyOption {
  id: string;
  title: string;
}

function NewContractModal({
  properties,
  tenants,
  initial,
  onClose,
  onCreated,
}: {
  properties: PropertyOption[];
  tenants: Tenant[];
  initial?: Contract | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!initial;
  const [tenantId, setTenantId] = useState(initial?.tenant_id || '');
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
  const [rentalType, setRentalType] = useState(initial?.rental_type || 'residencial');
  const [administrationFeePercent, setAdministrationFeePercent] = useState(String(initial?.administration_fee_percent ?? 0));
  const [lateFeePercent, setLateFeePercent] = useState(String(initial?.late_fee_percent ?? 2));
  const [monthlyInterestPercent, setMonthlyInterestPercent] = useState(String(initial?.monthly_interest_percent ?? 1));
  const [guaranteeType, setGuaranteeType] = useState(initial?.guarantee_type || 'sem_garantia');
  const [guaranteeAmountCents, setGuaranteeAmountCents] = useState(initial?.guarantee_amount_cents || 0);
  const [guaranteeNotes, setGuaranteeNotes] = useState(initial?.guarantee_notes || '');
  const [iptuCents, setIptuCents] = useState(initial?.iptu_amount_cents || 0);
  const [iptuPayer, setIptuPayer] = useState(initial?.iptu_payer || 'proprietario');
  const [condominiumCents, setCondominiumCents] = useState(initial?.condominium_amount_cents || 0);
  const [condominiumPayer, setCondominiumPayer] = useState(initial?.condominium_payer || 'inquilino');
  const [fireInsuranceCents, setFireInsuranceCents] = useState(initial?.fire_insurance_amount_cents || 0);
  const [fireInsurancePayer, setFireInsurancePayer] = useState(initial?.fire_insurance_payer || 'proprietario');
  const [otherChargesDescription, setOtherChargesDescription] = useState(initial?.other_charges_description || '');
  const [otherChargesCents, setOtherChargesCents] = useState(initial?.other_charges_cents || 0);
  const [otherChargesPayer, setOtherChargesPayer] = useState(initial?.other_charges_payer || 'inquilino');
  const [adjustmentIndex, setAdjustmentIndex] = useState(initial?.adjustment_index || 'sem_reajuste');
  const [adjustmentIntervalMonths, setAdjustmentIntervalMonths] = useState(String(initial?.adjustment_interval_months ?? 12));
  const [nextAdjustmentDate, setNextAdjustmentDate] = useState(initial?.next_adjustment_date?.slice(0, 10) || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleTenantSelection(id: string) {
    setTenantId(id);
    const tenant = tenants.find((item) => item.id === id);
    if (!tenant) return;
    setTenantName(tenant.full_name);
    setTenantPhone(tenant.phone ? stripDDI(tenant.phone) : '');
    setTenantCpf(tenant.cpf_cnpj ? maskCpfCnpj(tenant.cpf_cnpj) : '');
  }

  async function handleSave() {
    if (!tenantName.trim()) { setError('Nome do inquilino é obrigatório.'); return; }
    if (!ownerName.trim()) { setError('Nome do proprietário é obrigatório.'); return; }
    if (!rentCents) { setError('Informe o valor do aluguel.'); return; }
    const due = Number(dueDay);
    if (!due || due < 1 || due > 28) { setError('Dia de vencimento deve ser entre 1 e 28.'); return; }
    if (endDate && endDate < startDate) { setError('A data final não pode ser anterior ao início.'); return; }
    if (guaranteeType === 'caucao_dinheiro' && guaranteeAmountCents > rentCents * 3) {
      setError('A caução em dinheiro não pode ultrapassar três meses de aluguel.'); return;
    }

    setSaving(true);
    setError('');
    try {
      let contractTenantId = tenantId;
      if (!contractTenantId) {
        const tenantResponse = await fetch('/api/locacao/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({
            full_name: tenantName.trim(),
            phone: tenantPhone ? normalizePhoneBR(tenantPhone) : null,
            email: null,
            cpf_cnpj: tenantCpf ? tenantCpf.replace(/\D/g, '') : null,
            birth_date: null,
            emergency_contact_name: null,
            emergency_contact_phone: null,
            notes: null,
            status: 'ativo',
          }),
        });
        const tenantBody = await tenantResponse.json().catch(() => ({}));
        if (!tenantResponse.ok) {
          throw new Error(tenantResponse.status === 409
            ? 'Este CPF/CNPJ já está cadastrado. Selecione o inquilino existente.'
            : tenantBody?.error || 'Não foi possível cadastrar o inquilino.');
        }
        contractTenantId = tenantBody.id;
        setTenantId(contractTenantId);
      }

      const res = await fetch(isEdit ? `/api/locacao/contracts/${initial!.id}` : '/api/locacao/contracts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          tenant_id: contractTenantId,
          tenant_name: tenantName, tenant_phone: tenantPhone ? normalizePhoneBR(tenantPhone) : null,
          tenant_cpf_cnpj: tenantCpf ? tenantCpf.replace(/\D/g, '') : null,
          owner_name: ownerName, owner_phone: ownerPhone ? normalizePhoneBR(ownerPhone) : null,
          property_id: propertyId || null,
          rent_amount_cents: rentCents, due_day: due, start_date: startDate,
          end_date: endDate || null,
          rental_type: rentalType,
          administration_fee_percent: Number(administrationFeePercent) || 0,
          late_fee_percent: Number(lateFeePercent) || 0,
          monthly_interest_percent: Number(monthlyInterestPercent) || 0,
          guarantee_type: guaranteeType,
          guarantee_amount_cents: guaranteeType === 'caucao_dinheiro' ? guaranteeAmountCents : 0,
          guarantee_notes: guaranteeNotes || null,
          iptu_amount_cents: iptuCents,
          iptu_payer: iptuPayer,
          condominium_amount_cents: condominiumCents,
          condominium_payer: condominiumPayer,
          fire_insurance_amount_cents: fireInsuranceCents,
          fire_insurance_payer: fireInsurancePayer,
          other_charges_description: otherChargesDescription || null,
          other_charges_cents: otherChargesCents,
          other_charges_payer: otherChargesPayer,
          adjustment_index: adjustmentIndex,
          adjustment_interval_months: Number(adjustmentIntervalMonths) || 12,
          next_adjustment_date: adjustmentIndex === 'sem_reajuste' ? null : (nextAdjustmentDate || null),
          notes: notes || null,
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
      <div className="relative z-10 w-full max-w-3xl rounded-3xl overflow-hidden
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

          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Users size={11} /> Cadastro do inquilino
            </label>
            <select value={tenantId} onChange={(e) => handleTenantSelection(e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]
                focus:outline-none focus:border-[var(--glass-border-strong)] transition-colors [color-scheme:dark]">
              <option value="" style={optionStyle}>Cadastrar novo com os dados abaixo</option>
              {tenants
                .filter((tenant) => tenant.status === 'ativo' || tenant.id === initial?.tenant_id)
                .map((tenant) => (
                  <option key={tenant.id} value={tenant.id} style={optionStyle}>
                    {tenant.full_name}{tenant.status === 'inativo' ? ' (inativo)' : ''}
                  </option>
                ))}
            </select>
            <p className="text-[10px] text-[var(--text-low)] mt-1">
              O cadastro reutilizável mantém o histórico do inquilino entre contratos.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User size={11} /> Inquilino
              </label>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Nome completo" disabled={!!tenantId}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors disabled:opacity-60" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Phone size={11} /> Telefone
              </label>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]">+55</span>
                <input value={tenantPhone} onChange={(e) => setTenantPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" disabled={!!tenantId}
                  className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                    focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors disabled:opacity-60" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
              CPF/CNPJ do inquilino
            </label>
            <input value={tenantCpf} onChange={(e) => setTenantCpf(maskCpfCnpj(e.target.value))} placeholder="CPF ou CNPJ" maxLength={18} inputMode="numeric" disabled={!!tenantId}
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors disabled:opacity-60" />
            <p className="text-[10px] text-[var(--text-low)] mt-1">Opcional nesta etapa; usado apenas para identificação cadastral.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="pt-3 border-t border-[var(--hairline)]">
            <p className="text-xs font-bold text-[var(--text-mid)] uppercase tracking-wider mb-3">Condições do contrato</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Tipo de locação</label>
                <select value={rentalType} onChange={(e) => setRentalType(e.target.value as typeof rentalType)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                  <option value="residencial" style={optionStyle}>Residencial</option>
                  <option value="comercial" style={optionStyle}>Comercial</option>
                  <option value="temporada" style={optionStyle}>Temporada</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Taxa de administração (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={administrationFeePercent}
                  onChange={(e) => setAdministrationFeePercent(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Multa por atraso (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={lateFeePercent}
                  onChange={(e) => setLateFeePercent(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Juros mensais (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={monthlyInterestPercent}
                  onChange={(e) => setMonthlyInterestPercent(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--hairline)]">
            <p className="text-xs font-bold text-[var(--text-mid)] uppercase tracking-wider mb-3">Garantia locatícia</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Modalidade</label>
                <select value={guaranteeType} onChange={(e) => setGuaranteeType(e.target.value as typeof guaranteeType)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                  <option value="sem_garantia" style={optionStyle}>Sem garantia</option>
                  <option value="caucao_dinheiro" style={optionStyle}>Caução em dinheiro</option>
                  <option value="fiador" style={optionStyle}>Fiador</option>
                  <option value="seguro_fianca" style={optionStyle}>Seguro-fiança</option>
                  <option value="cessao_fiduciaria" style={optionStyle}>Cessão fiduciária</option>
                </select>
              </div>
              {guaranteeType === 'caucao_dinheiro' && (
                <div>
                  <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Valor da caução</label>
                  <input value={maskFromCents(guaranteeAmountCents)} onChange={(e) => setGuaranteeAmountCents(centsFromMaskInput(e.target.value))}
                    inputMode="numeric" placeholder="0,00"
                    className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
                  <p className="text-[10px] text-[var(--text-low)] mt-1">Limite legal: até três meses de aluguel.</p>
                </div>
              )}
            </div>
            <input value={guaranteeNotes} onChange={(e) => setGuaranteeNotes(e.target.value)}
              placeholder="Detalhes do fiador, seguro ou garantia (opcional)" maxLength={500}
              className="w-full mt-3 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]" />
          </div>

          <div className="pt-3 border-t border-[var(--hairline)]">
            <p className="text-xs font-bold text-[var(--text-mid)] uppercase tracking-wider mb-3">Encargos mensais</p>
            {[
              { label: 'IPTU', cents: iptuCents, setCents: setIptuCents, payer: iptuPayer, setPayer: setIptuPayer },
              { label: 'Condomínio', cents: condominiumCents, setCents: setCondominiumCents, payer: condominiumPayer, setPayer: setCondominiumPayer },
              { label: 'Seguro incêndio', cents: fireInsuranceCents, setCents: setFireInsuranceCents, payer: fireInsurancePayer, setPayer: setFireInsurancePayer },
            ].map((charge) => (
              <div key={charge.label} className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 mb-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">{charge.label} mensal (R$)</label>
                  <input value={maskFromCents(charge.cents)} onChange={(e) => charge.setCents(centsFromMaskInput(e.target.value))}
                    inputMode="numeric" placeholder="0,00"
                    className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Responsável</label>
                  <select value={charge.payer} onChange={(e) => charge.setPayer(e.target.value as 'inquilino' | 'proprietario')}
                    className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                    <option value="inquilino" style={optionStyle}>Inquilino</option>
                    <option value="proprietario" style={optionStyle}>Proprietário</option>
                  </select>
                </div>
              </div>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_180px] gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Outro encargo</label>
                <input value={otherChargesDescription} onChange={(e) => setOtherChargesDescription(e.target.value)} maxLength={120}
                  placeholder="Descrição"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Valor mensal</label>
                <input value={maskFromCents(otherChargesCents)} onChange={(e) => setOtherChargesCents(centsFromMaskInput(e.target.value))}
                  inputMode="numeric" placeholder="0,00"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Responsável</label>
                <select value={otherChargesPayer} onChange={(e) => setOtherChargesPayer(e.target.value as typeof otherChargesPayer)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                  <option value="inquilino" style={optionStyle}>Inquilino</option>
                  <option value="proprietario" style={optionStyle}>Proprietário</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--hairline)]">
            <p className="text-xs font-bold text-[var(--text-mid)] uppercase tracking-wider mb-3">Reajuste</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Índice</label>
                <select value={adjustmentIndex} onChange={(e) => setAdjustmentIndex(e.target.value as typeof adjustmentIndex)}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                  <option value="sem_reajuste" style={optionStyle}>Sem reajuste</option>
                  <option value="ipca" style={optionStyle}>IPCA</option>
                  <option value="igpm" style={optionStyle}>IGP-M</option>
                  <option value="outro" style={optionStyle}>Outro</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Intervalo (meses)</label>
                <input type="number" min="1" max="60" value={adjustmentIntervalMonths} onChange={(e) => setAdjustmentIntervalMonths(e.target.value)}
                  disabled={adjustmentIndex === 'sem_reajuste'}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] disabled:opacity-50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Próximo reajuste</label>
                <input type="date" value={nextAdjustmentDate} onChange={(e) => setNextAdjustmentDate(e.target.value)}
                  disabled={adjustmentIndex === 'sem_reajuste'}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] disabled:opacity-50 [color-scheme:dark]" />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--hairline)]">
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Observações</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000}
              placeholder="Condições e observações internas do contrato"
              className="w-full resize-y rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]" />
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

// Locação: contratos completos e controle declaratório de competências e
// recebimentos externos. Não há carteira, split, custódia ou repasse. Aplicação
// automática de índice, DIMOB, vistoria e portal ficam para etapas futuras.
function TenantModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Tenant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(initial?.full_name || '');
  const [phone, setPhone] = useState(initial?.phone ? stripDDI(initial.phone) : '');
  const [email, setEmail] = useState(initial?.email || '');
  const [document, setDocument] = useState(initial?.cpf_cnpj ? maskCpfCnpj(initial.cpf_cnpj) : '');
  const [birthDate, setBirthDate] = useState(initial?.birth_date?.slice(0, 10) || '');
  const [emergencyName, setEmergencyName] = useState(initial?.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(initial?.emergency_contact_phone ? stripDDI(initial.emergency_contact_phone) : '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [status, setStatus] = useState<Tenant['status']>(initial?.status || 'ativo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (fullName.trim().length < 2) {
      setError('Informe o nome completo do inquilino.');
      return;
    }
    const cleanDocument = document.replace(/\D/g, '');
    if (cleanDocument && ![11, 14].includes(cleanDocument.length)) {
      setError('Informe um CPF ou CNPJ válido.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(initial ? `/api/locacao/tenants/${initial.id}` : '/api/locacao/tenants', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone ? normalizePhoneBR(phone) : null,
          email: email.trim() || null,
          cpf_cnpj: cleanDocument || null,
          birth_date: birthDate || null,
          emergency_contact_name: emergencyName.trim() || null,
          emergency_contact_phone: emergencyPhone ? normalizePhoneBR(emergencyPhone) : null,
          notes: notes.trim() || null,
          status,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Não foi possível salvar o inquilino.');
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Não foi possível salvar o inquilino.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)] focus:outline-none focus:border-[var(--glass-border-strong)]';

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={initial ? 'Editar inquilino' : 'Novo inquilino'}
        className="relative z-10 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden rounded-3xl backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)] shadow-2xl">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--hairline)] shrink-0">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-hi)]">{initial ? 'Editar inquilino' : 'Novo inquilino'}</h3>
            <p className="text-[11px] text-[var(--text-low)]">Cadastro reutilizável e histórico contratual preservado.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 text-[var(--text-low)] hover:text-[var(--text-mid)]"><X size={19} /></button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Nome completo</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={160} className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Telefone</label>
              <input value={phone} onChange={(e) => setPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="inquilino@email.com" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">CPF/CNPJ</label>
              <input value={document} onChange={(e) => setDocument(maskCpfCnpj(e.target.value))} inputMode="numeric" maxLength={18} className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Nascimento</label>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Contato de emergência</label>
              <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} maxLength={160} className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Telefone de emergência</label>
              <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as Tenant['status'])} className={`${inputClass} [color-scheme:dark]`}>
                <option value="ativo" style={optionStyle}>Ativo</option>
                <option value="inativo" style={optionStyle}>Inativo</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Observações internas</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} className={`${inputClass} resize-y`} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-5 sm:px-6 py-4 border-t border-[var(--hairline)] shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)]">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />}{initial ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PropertyHistoryModal({
  property,
  contracts,
  onClose,
}: {
  property: PropertyOption;
  contracts: Contract[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[205] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Histórico do imóvel"
        className="relative z-10 w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden rounded-3xl backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--hairline)]">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--text-hi)]">Histórico do imóvel</h3>
            <p className="text-xs text-[var(--text-low)] truncate">{property.title}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 text-[var(--text-low)] hover:text-[var(--text-mid)]"><X size={19} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {contracts.length === 0 ? (
            <p className="text-sm text-[var(--text-low)] text-center py-8">Nenhum contrato vinculado.</p>
          ) : contracts.map((contract) => (
            <div key={contract.id} className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-hi)] truncate">{contract.tenant_name}</p>
                  <p className="text-[11px] text-[var(--text-low)]">
                    {new Date(`${contract.start_date}T12:00:00`).toLocaleDateString('pt-BR')} — {contract.end_date ? new Date(`${contract.end_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'em andamento'}
                  </p>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${contract.status === 'ativo' ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]'}`}>
                  {contract.status}
                </span>
              </div>
              <p className="text-sm font-black cr-money mt-3">{centsToReais(contract.rent_amount_cents)}<span className="text-[11px] text-[var(--text-low)]">/mês</span></p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaymentLedgerModal({
  contract,
  onClose,
  onChanged,
}: {
  contract: Contract;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<RentalPayment[] | null>(null);
  const [referenceMonth, setReferenceMonth] = useState(new Date().toISOString().slice(0, 7));
  const [creating, setCreating] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<RentalPayment | null>(null);
  const [receiptCents, setReceiptCents] = useState(0);
  const [receiptMethod, setReceiptMethod] = useState<PaymentReceipt['payment_method']>('pix');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState('');
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [error, setError] = useState('');

  const loadPayments = async () => {
    setError('');
    try {
      const response = await fetch(`/api/locacao/contracts/${contract.id}/payments`, {
        headers: authService.getAuthHeaders(),
      });
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.error || 'Falha ao carregar as competências.');
      setPayments(Array.isArray(body) ? body : []);
    } catch (loadError: any) {
      setError(loadError.message || 'Falha ao carregar as competências.');
      setPayments([]);
    }
  };

  useEffect(() => { void loadPayments(); }, [contract.id]);

  async function createCompetency() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`/api/locacao/contracts/${contract.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ reference_month: referenceMonth }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Falha ao criar a competência.');
      await loadPayments();
      onChanged();
    } catch (createError: any) {
      setError(createError.message || 'Falha ao criar a competência.');
    } finally {
      setCreating(false);
    }
  }

  function openReceipt(payment: RentalPayment) {
    setReceiptPayment(payment);
    setReceiptCents(payment.remaining_cents);
    setReceiptMethod('pix');
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptNotes('');
    setError('');
  }

  async function recordReceipt() {
    if (!receiptPayment || receiptCents <= 0) {
      setError('Informe o valor recebido.');
      return;
    }
    setSavingReceipt(true);
    setError('');
    try {
      const receivedAt = new Date(`${receiptDate}T12:00:00`).toISOString();
      const response = await fetch(
        `/api/locacao/contracts/${contract.id}/payments/${receiptPayment.id}/receipts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({
            amount_cents: receiptCents,
            payment_method: receiptMethod,
            received_at: receivedAt,
            notes: receiptNotes,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Falha ao registrar o pagamento.');
      setReceiptPayment(null);
      await loadPayments();
      onChanged();
    } catch (receiptError: any) {
      setError(receiptError.message || 'Falha ao registrar o pagamento.');
    } finally {
      setSavingReceipt(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Controle mensal da locação"
        className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl
          backdrop-blur-2xl bg-[var(--panel)] border border-[var(--glass-border-strong)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-5 border-b border-[var(--hairline)] shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--text-hi)]">Controle mensal</h3>
            <p className="text-xs text-[var(--text-low)] truncate">{contract.tenant_name}{contract.property ? ` · ${contract.property}` : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar controle mensal" className="p-1 text-[var(--text-low)] hover:text-[var(--text-hi)]">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="rounded-2xl px-4 py-3 bg-sky-500/10 border border-sky-400/20">
            <p className="text-xs text-[var(--text-mid)]">
              O pagamento acontece fora do ImobiFlow. Esta tela apenas registra a competência e o recebimento informado pela imobiliária.
            </p>
          </div>

          {error && <div className="rounded-xl px-4 py-2 text-sm text-red-300 bg-red-500/10 border border-red-400/20">{error}</div>}

          <div className="flex flex-col sm:flex-row gap-2">
            <input type="month" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]" />
            <button onClick={createCompetency} disabled={creating || !referenceMonth}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-blue-600/80 border border-blue-400/30 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Criar competência
            </button>
          </div>

          {payments === null ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-low)]" /></div>
          ) : payments.length === 0 ? (
            <div className="text-center py-10 text-sm text-[var(--text-low)]">Nenhuma competência registrada.</div>
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => {
                const status = PAYMENT_LABEL[payment.status] || PAYMENT_LABEL.pending;
                const monthLabel = new Date(`${payment.reference_month}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                return (
                  <div key={payment.id} className="rounded-2xl p-4 bg-[var(--control-fill)] border border-[var(--hairline)]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-[var(--text-hi)] capitalize">{monthLabel}</p>
                        <p className="text-[11px] text-[var(--text-low)]">
                          Vencimento {new Date(`${payment.due_date}T12:00:00`).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${status.cls}`}>{status.label}</span>
                    </div>

                    <div className="mt-3 space-y-1">
                      {(payment.line_items || []).map((item) => (
                        <div key={`${payment.id}:${item.code}`} className="flex justify-between gap-3 text-xs text-[var(--text-low)]">
                          <span>{item.label}</span><span>{centsToReais(item.amount_cents)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 pt-2 border-t border-[var(--hairline)] text-sm font-bold text-[var(--text-hi)]">
                        <span>Total</span><span>{centsToReais(payment.amount_cents)}</span>
                      </div>
                      {payment.amount_paid_cents > 0 && (
                        <div className="flex justify-between gap-3 text-xs text-emerald-200">
                          <span>Recebido</span><span>{centsToReais(payment.amount_paid_cents)}</span>
                        </div>
                      )}
                      {payment.remaining_cents > 0 && payment.amount_paid_cents > 0 && (
                        <div className="flex justify-between gap-3 text-xs text-amber-200">
                          <span>Saldo</span><span>{centsToReais(payment.remaining_cents)}</span>
                        </div>
                      )}
                    </div>

                    {payment.receipts?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-[var(--hairline)] space-y-1.5">
                        {payment.receipts.map((receipt) => (
                          <div key={receipt.id} className="text-[11px] text-[var(--text-low)] flex flex-wrap justify-between gap-2">
                            <span>{new Date(receipt.received_at).toLocaleDateString('pt-BR')} · {receipt.payment_method}</span>
                            <span>{centsToReais(receipt.amount_cents)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {payment.source === 'external' && payment.remaining_cents > 0 && !['canceled', 'failed'].includes(payment.status) && (
                      <button onClick={() => openReceipt(payment)}
                        className="w-full mt-3 py-2 rounded-xl text-xs font-bold text-[var(--text-hi)] bg-emerald-500/15 border border-emerald-400/20 hover:bg-emerald-500/20">
                        Registrar pagamento externo
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {receiptPayment && (
            <div className="rounded-2xl p-4 border border-emerald-400/25 bg-emerald-500/10 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-[var(--text-hi)]">Registrar recebimento</p>
                <button onClick={() => setReceiptPayment(null)} aria-label="Cancelar registro"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase">Valor recebido</label>
                  <input value={maskFromCents(receiptCents)} onChange={(e) => setReceiptCents(centsFromMaskInput(e.target.value))}
                    inputMode="numeric" className="w-full mt-1 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase">Data</label>
                  <input type="date" value={receiptDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReceiptDate(e.target.value)}
                    className="w-full mt-1 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase">Forma</label>
                  <select value={receiptMethod} onChange={(e) => setReceiptMethod(e.target.value as PaymentReceipt['payment_method'])}
                    className="w-full mt-1 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] [color-scheme:dark]">
                    <option value="pix" style={optionStyle}>PIX</option>
                    <option value="transferencia" style={optionStyle}>Transferência</option>
                    <option value="boleto" style={optionStyle}>Boleto externo</option>
                    <option value="dinheiro" style={optionStyle}>Dinheiro</option>
                    <option value="cartao" style={optionStyle}>Cartão</option>
                    <option value="outro" style={optionStyle}>Outro</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase">Observação</label>
                  <input value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} maxLength={500}
                    placeholder="Opcional" className="w-full mt-1 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline-strong)]" />
                </div>
              </div>
              <button onClick={recordReceipt} disabled={savingReceipt || receiptCents <= 0 || receiptCents > receiptPayment.remaining_cents}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)] bg-emerald-600/70 border border-emerald-400/25 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {savingReceipt ? <Loader2 size={15} className="animate-spin" /> : <ReceiptText size={15} />}
                Confirmar registro
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LocacaoArea() {
  const [view, setView] = useState<'contracts' | 'disponiveis' | 'cobranca' | 'tenants'>('contracts');
  const [dashboard, setDashboard] = useState<RentalDashboardData | null>(null);
  const [diaryContract, setDiaryContract] = useState<Contract | null>(null);
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showTenantCreate, setShowTenantCreate] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [historyProperty, setHistoryProperty] = useState<PropertyOption | null>(null);
  const [ledgerContract, setLedgerContract] = useState<Contract | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [chargeInfo, setChargeInfo] = useState<Record<string, ChargeInfo | undefined>>({});
  const [chargeError, setChargeError] = useState<Record<string, string>>({});
  const [billingAccountConfigured, setBillingAccountConfigured] = useState<boolean | null>(
    CLIENT_FINANCIAL_OPERATIONS_ENABLED ? null : false,
  );

  const loadDashboard = () => {
    fetch('/api/locacao/dashboard', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDashboard(d))
      .catch(() => setDashboard(null));
  };

  const load = () => {
    setLoading(true);
    setError('');
    loadDashboard();
    Promise.all([
      fetch('/api/locacao/contracts', { headers: authService.getAuthHeaders() }),
      fetch('/api/locacao/tenants', { headers: authService.getAuthHeaders() }),
    ])
      .then(async ([contractsResponse, tenantsResponse]) => {
        if (!contractsResponse.ok) {
          const body = await contractsResponse.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${contractsResponse.status} ao carregar contratos.`);
        }
        if (!tenantsResponse.ok) {
          const body = await tenantsResponse.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${tenantsResponse.status} ao carregar inquilinos.`);
        }
        return Promise.all([contractsResponse.json(), tenantsResponse.json()]);
      })
      .then(([contractData, tenantData]) => {
        setContracts(Array.isArray(contractData) ? contractData : []);
        setTenants(Array.isArray(tenantData) ? tenantData : []);
      })
      .catch((e) => setError(e.message || 'Erro ao carregar o módulo de aluguéis.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetch('/api/properties', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .catch(() => setProperties([]));
  }, []);
  useEffect(() => {
    if (!CLIENT_FINANCIAL_OPERATIONS_ENABLED) return;
    fetch('/api/brokers/asaas-key', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((data) => setBillingAccountConfigured(data?.configured === true))
      .catch(() => setBillingAccountConfigured(false));
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
    if (!confirm('Apagar este contrato sem histórico financeiro? Se já houver competências, será necessário encerrá-lo.')) return;
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

  async function deleteTenant(tenant: Tenant) {
    if (!confirm(`Apagar o cadastro de ${tenant.full_name}? Cadastros com histórico devem ser marcados como inativos.`)) return;
    try {
      const response = await fetch(`/api/locacao/tenants/${tenant.id}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Não foi possível apagar o inquilino.');
      load();
    } catch (e: any) {
      alert(e.message || 'Não foi possível apagar o inquilino.');
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Aluguéis</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = (contracts || []).length === 0;
  const tenantsEmpty = (tenants || []).length === 0;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-black text-[var(--text-hi)]">Aluguéis</h2>
          <p className="text-[12px] text-[var(--text-low)] mt-1">Contratos, inquilinos e histórico dos imóveis alugados.</p>
        </div>
        {view !== 'cobranca' && view !== 'disponiveis' && (
          <button onClick={() => view === 'contracts' ? setShowCreate(true) : setShowTenantCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors">
            <Plus className="w-4 h-4" /> {view === 'contracts' ? 'Novo contrato' : 'Novo inquilino'}
          </button>
        )}
      </div>

      {/* 4 abas não cabem lado a lado no celular: quebra em duas linhas em vez
          de espremer o texto. */}
      <div className="inline-flex flex-wrap gap-1 w-full sm:w-auto p-1 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] mb-6">
        <button onClick={() => setView('contracts')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-colors ${view === 'contracts' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] shadow-sm' : 'text-[var(--text-low)]'}`}>
          Imóveis alugados
        </button>
        <button onClick={() => setView('disponiveis')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-colors ${view === 'disponiveis' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] shadow-sm' : 'text-[var(--text-low)]'}`}>
          Para alugar
        </button>
        <button onClick={() => setView('cobranca')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-colors ${view === 'cobranca' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] shadow-sm' : 'text-[var(--text-low)]'}`}>
          Cobrança automática
        </button>
        <button onClick={() => setView('tenants')}
          className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-colors ${view === 'tenants' ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] shadow-sm' : 'text-[var(--text-low)]'}`}>
          Inquilinos ({tenants?.length || 0})
        </button>
      </div>

      {view === 'disponiveis' && <AvailableTab />}

      {view === 'cobranca' && <CobrancaTab />}

      {view === 'contracts' && dashboard && <RentalDashboard data={dashboard} />}

      {view === 'contracts' && (isEmpty ? (
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
                  <div className="flex items-center gap-2 mb-1.5 min-w-0">
                    <p className="text-[12px] text-[var(--text-low)] flex items-center gap-1.5 truncate min-w-0">
                      <HomeIcon className="w-3.5 h-3.5 shrink-0" /> {c.property}
                    </p>
                    {c.property_id && (
                      <button onClick={() => setHistoryProperty({ id: c.property_id!, title: c.property! })}
                        title="Ver histórico do imóvel" aria-label="Ver histórico do imóvel"
                        className="shrink-0 p-1 rounded-lg text-[var(--text-low)] hover:text-[var(--text-mid)] hover:bg-[var(--control-fill)]">
                        <History className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[12px] text-[var(--text-low)] mb-1.5">Proprietário: {c.owner_name}</p>
                <p className="text-[20px] font-black cr-money mt-2">{centsToReais(c.rent_amount_cents)}<span className="text-[12px] font-semibold text-[var(--text-low)]">/mês</span></p>
                <p className="text-[11px] text-[var(--text-low)] mt-1">Vencimento todo dia {c.due_day}</p>

                <button onClick={() => setLedgerContract(c)}
                  className="w-full mt-3 py-2.5 rounded-xl text-[11px] font-bold text-[var(--text-hi)] bg-sky-500/12 border border-sky-400/20 hover:bg-sky-500/20 transition-colors inline-flex items-center justify-center gap-2">
                  <ReceiptText className="w-3.5 h-3.5" /> Controle mensal
                  {c.current_month_payment_status && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full border ${PAYMENT_LABEL[c.current_month_payment_status]?.cls || ''}`}>
                      {PAYMENT_LABEL[c.current_month_payment_status]?.label || c.current_month_payment_status}
                    </span>
                  )}
                </button>

                {/* Diário + piloto automático: onde o corretor vê o que a IA
                    fez e liga/desliga a cobrança automática deste contrato. */}
                <button onClick={() => setDiaryContract(c)}
                  className="w-full mt-2 py-2.5 rounded-xl text-[11px] font-bold text-[var(--text-mid)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors inline-flex items-center justify-center gap-2">
                  <History className="w-3.5 h-3.5" /> Diário e piloto
                  {(c as any).autopilot_enabled && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-emerald-300 bg-emerald-500/15">automático</span>
                  )}
                </button>

                {c.status === 'ativo' && (
                  <>
                    {CLIENT_FINANCIAL_OPERATIONS_ENABLED && billingAccountConfigured ? <div className="mt-3 pt-3 border-t border-[var(--hairline)]">
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
                        {CLIENT_FINANCIAL_OPERATIONS_ENABLED && billingAccountConfigured === null
                          ? 'Verificando a integração de cobrança...'
                          : CLIENT_FINANCIAL_OPERATIONS_ENABLED
                            ? 'Nenhuma conta própria conectada. Registre e receba o pagamento fora do ImobiFlow.'
                            : 'Pagamentos e cobranças são realizados fora do ImobiFlow.'}
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
      ))}

      {view === 'tenants' && (tenantsEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Users className="w-5 h-5 text-sky-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)] mb-2">Nenhum inquilino cadastrado.</p>
          <p className="text-[12px] text-[var(--text-low)] mb-6">Cadastre uma pessoa uma vez e reutilize seus dados nos próximos contratos.</p>
          <button onClick={() => setShowTenantCreate(true)} className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--glass-border)]">
            <Plus className="w-4 h-4" /> Cadastrar inquilino
          </button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {tenants!.map((tenant) => {
            const activeContracts = tenant.contract_history.filter((item) => item.status === 'ativo').length;
            return (
              <GlassCard key={tenant.id} className="!p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-[var(--text-hi)] truncate">{tenant.full_name}</p>
                    <p className="text-[11px] text-[var(--text-low)]">{activeContracts} contrato{activeContracts === 1 ? '' : 's'} ativo{activeContracts === 1 ? '' : 's'}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${tenant.status === 'ativo' ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/20' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline)]'}`}>
                    {tenant.status}
                  </span>
                </div>

                <div className="space-y-1.5 mt-4">
                  {tenant.phone && <p className="text-[12px] text-[var(--text-low)] flex items-center gap-2"><Phone className="w-3.5 h-3.5" />+{tenant.phone}</p>}
                  {tenant.email && <p className="text-[12px] text-[var(--text-low)] flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5 shrink-0" />{tenant.email}</p>}
                  {tenant.cpf_cnpj && <p className="text-[11px] text-[var(--text-low)]">CPF/CNPJ: {maskCpfCnpj(tenant.cpf_cnpj)}</p>}
                </div>

                <div className="mt-4 pt-4 border-t border-[var(--hairline)]">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-2">Histórico contratual</p>
                  {tenant.contract_history.length === 0 ? (
                    <p className="text-[11px] text-[var(--text-low)]">Nenhum contrato vinculado.</p>
                  ) : (
                    <div className="space-y-2 max-h-28 overflow-y-auto pr-1">
                      {tenant.contract_history.map((item) => (
                        <div key={item.id} className="rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)] px-3 py-2">
                          <p className="text-[11px] font-semibold text-[var(--text-mid)] truncate">{item.property || 'Imóvel não vinculado'}</p>
                          <p className="text-[10px] text-[var(--text-low)]">{new Date(`${item.start_date}T12:00:00`).toLocaleDateString('pt-BR')} · {item.status}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditingTenant(tenant)} className="flex-1 py-2 rounded-xl text-[11px] font-bold text-[var(--text-hi)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] inline-flex items-center justify-center gap-1.5">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => deleteTenant(tenant)} aria-label="Apagar inquilino" className="px-3 py-2 rounded-xl text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:text-red-300 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      ))}

      {showCreate && (
        <NewContractModal properties={properties} tenants={tenants || []} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
      {editingContract && (
        <NewContractModal properties={properties} tenants={tenants || []} initial={editingContract} onClose={() => setEditingContract(null)} onCreated={load} />
      )}
      {showTenantCreate && <TenantModal onClose={() => setShowTenantCreate(false)} onSaved={load} />}
      {editingTenant && <TenantModal initial={editingTenant} onClose={() => setEditingTenant(null)} onSaved={load} />}
      {historyProperty && (
        <PropertyHistoryModal
          property={historyProperty}
          contracts={(contracts || []).filter((contract) => contract.property_id === historyProperty.id)}
          onClose={() => setHistoryProperty(null)}
        />
      )}
      {diaryContract && (
        <ContractDiaryModal
          contract={diaryContract as any}
          onClose={() => setDiaryContract(null)}
          onChanged={() => { load(); }}
        />
      )}

      {ledgerContract && (
        <PaymentLedgerModal contract={ledgerContract} onClose={() => setLedgerContract(null)} onChanged={load} />
      )}
    </div>
  );
}
