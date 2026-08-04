import React, { useEffect, useState } from 'react';
import { Ban, Building2, Check, Copy, Gift, Landmark, Loader2, RefreshCw, User } from 'lucide-react';
import { authService } from '../services/auth';

type AccountType = 'corretor' | 'imobiliaria' | 'incorporadora';
type VoucherStatus = 'active' | 'used' | 'expired' | 'cancelled';

type Voucher = {
  id: string;
  code_hint: string;
  account_type: AccountType;
  invite_expires_at: string;
  trial_days: number;
  member_limit: number;
  status: VoucherStatus;
  created_at: string;
  used_at: string | null;
  cancelled_at: string | null;
  used_by_account?: { name: string; email: string } | null;
};

type CreatedVoucher = Voucher & { code: string; url: string };

const ACCOUNT_TYPES = [
  { value: 'corretor' as const, label: 'Corretor autônomo', icon: User },
  { value: 'imobiliaria' as const, label: 'Imobiliária', icon: Building2 },
  { value: 'incorporadora' as const, label: 'Incorporadora', icon: Landmark },
];

const STATUS: Record<VoucherStatus, { label: string; cls: string }> = {
  active: { label: 'Ativo', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25' },
  used: { label: 'Utilizado', cls: 'text-blue-300 bg-blue-500/15 border-blue-400/25' },
  expired: { label: 'Expirado', cls: 'text-amber-300 bg-amber-500/15 border-amber-400/25' },
  cancelled: { label: 'Cancelado', cls: 'text-red-300 bg-red-500/15 border-red-400/25' },
};

const fieldClass = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none text-[var(--text-hi)] bg-[var(--control-fill-hover)] border border-[var(--glass-border)] focus:ring-2 focus:ring-white/20';

function localTomorrowAtNoon() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(12, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminTrialVouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [created, setCreated] = useState<CreatedVoucher | null>(null);
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);
  const [form, setForm] = useState({
    account_type: 'imobiliaria' as AccountType,
    invite_expires_at: localTomorrowAtNoon(),
    trial_days: '14',
    member_limit: '10',
  });

  const headers = authService.getAuthHeaders();

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/trial-vouchers', { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os vouchers.');
      setVouchers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Não foi possível carregar os vouchers.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createVoucher(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setCreated(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/trial-vouchers', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_type: form.account_type,
          invite_expires_at: new Date(form.invite_expires_at).toISOString(),
          trial_days: Number(form.trial_days),
          member_limit: form.account_type === 'corretor' ? 0 : Number(form.member_limit),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível gerar o voucher.');
      setCreated(data);
      setVouchers((current) => [{ ...data, used_at: null, cancelled_at: null }, ...current]);
      setMessage({ type: 'success', text: 'Voucher gerado. Copie o link agora: o código completo não aparecerá novamente.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Não foi possível gerar o voucher.' });
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, kind: 'code' | 'url') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setMessage({ type: 'error', text: 'O navegador não permitiu copiar. Selecione o texto manualmente.' });
    }
  }

  async function cancelVoucher(voucher: Voucher) {
    if (!confirm(`Cancelar o voucher ${voucher.code_hint}? O link deixará de funcionar imediatamente.`)) return;
    setCancellingId(voucher.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/trial-vouchers/${voucher.id}/cancel`, {
        method: 'PATCH',
        headers,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível cancelar o voucher.');
      setVouchers((current) => current.map((item) => item.id === voucher.id
        ? { ...item, status: 'cancelled', cancelled_at: data.cancelled_at }
        : item));
      if (created?.id === voucher.id) setCreated(null);
      setMessage({ type: 'success', text: 'Voucher cancelado.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Não foi possível cancelar o voucher.' });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-[var(--text-hi)] flex items-center gap-2"><Gift className="w-5 h-5 text-violet-300" /> Vouchers de experimentação</h2>
          <p className="text-sm text-[var(--text-low)] mt-1">Acesso sem cobrança, concedido e auditado exclusivamente pela administração.</p>
        </div>
        <button type="button" onClick={load} aria-label="Atualizar vouchers" className="p-2 rounded-xl text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)]">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-200' : 'bg-red-500/10 border-red-400/25 text-red-200'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={createVoucher} className="rounded-2xl p-5 bg-[var(--control-fill-hover)] border border-[var(--glass-border)] space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {ACCOUNT_TYPES.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => setForm((current) => ({ ...current, account_type: value }))}
              className={`rounded-xl border p-3 flex items-center gap-3 text-left transition-colors ${form.account_type === value ? 'border-violet-400/50 bg-violet-500/15' : 'border-[var(--hairline-strong)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]'}`}>
              <Icon className="w-4 h-4 text-[var(--text-mid)]" />
              <span className="text-sm font-bold text-[var(--text-hi)]">{label}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)]">Voucher válido até</span>
            <input required type="datetime-local" value={form.invite_expires_at} onChange={(event) => setForm((current) => ({ ...current, invite_expires_at: event.target.value }))} className={`${fieldClass} [color-scheme:dark]`} />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)]">Dias de experimentação</span>
            <input required type="number" min="1" max="180" value={form.trial_days} onChange={(event) => setForm((current) => ({ ...current, trial_days: event.target.value }))} className={fieldClass} />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)]">Corretores além do titular</span>
            <input required type="number" min="0" max="100" disabled={form.account_type === 'corretor'} value={form.account_type === 'corretor' ? '0' : form.member_limit} onChange={(event) => setForm((current) => ({ ...current, member_limit: event.target.value }))} className={`${fieldClass} disabled:opacity-45`} />
          </label>
        </div>

        <button type="submit" disabled={saving} className="h-11 px-5 rounded-xl inline-flex items-center gap-2 bg-violet-500/25 border border-violet-400/35 text-violet-100 font-bold text-sm disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
          Gerar voucher
        </button>
      </form>

      {created && (
        <div className="rounded-2xl p-5 bg-emerald-500/10 border border-emerald-400/30">
          <p className="font-bold text-emerald-200 mb-3">Link gerado — copie e envie ao convidado</p>
          <div className="space-y-2">
            {([['url', created.url], ['code', created.code]] as const).map(([kind, value]) => (
              <div key={kind} className="flex items-center gap-2 rounded-xl bg-black/20 border border-white/10 p-2">
                <code className="text-xs text-[var(--text-mid)] truncate flex-1">{value}</code>
                <button type="button" onClick={() => copy(value, kind)} className="shrink-0 p-2 rounded-lg hover:bg-white/10 text-[var(--text-hi)]" aria-label={`Copiar ${kind === 'url' ? 'link' : 'código'}`}>
                  {copied === kind ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl overflow-hidden bg-[var(--control-fill-hover)] border border-[var(--glass-border)]">
        <div className="px-5 py-4 border-b border-[var(--hairline)]"><h3 className="font-bold text-sm text-[var(--text-hi)]">Histórico</h3></div>
        {loading ? (
          <div className="py-14 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-low)]" /></div>
        ) : vouchers.length === 0 ? (
          <div className="py-14 text-center text-sm text-[var(--text-low)]">Nenhum voucher gerado.</div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {vouchers.map((voucher) => {
              const status = STATUS[voucher.status];
              const account = ACCOUNT_TYPES.find((item) => item.value === voucher.account_type);
              return (
                <div key={voucher.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[var(--text-hi)]">{account?.label}</span>
                      <code className="text-[11px] text-[var(--text-low)]">{voucher.code_hint}</code>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${status.cls}`}>{status.label}</span>
                    </div>
                    <p className="text-xs text-[var(--text-low)] mt-1">
                      Convite até {formatDate(voucher.invite_expires_at)} · teste por {voucher.trial_days} dias
                      {voucher.account_type !== 'corretor' ? ` · ${voucher.member_limit} corretor(es)` : ''}
                    </p>
                    {voucher.used_by_account && <p className="text-xs text-blue-300/80 mt-1">Usado por {voucher.used_by_account.name} ({voucher.used_by_account.email}) em {formatDate(voucher.used_at)}</p>}
                  </div>
                  {voucher.status === 'active' && (
                    <button type="button" onClick={() => cancelVoucher(voucher)} disabled={cancellingId === voucher.id} className="self-start md:self-auto h-9 px-3 rounded-lg inline-flex items-center gap-2 text-xs font-bold text-red-300 bg-red-500/10 border border-red-400/20 disabled:opacity-50">
                      {cancellingId === voucher.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                      Cancelar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
