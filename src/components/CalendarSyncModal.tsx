import React, { useEffect, useState } from 'react';
import {
  CalendarSync, Check, Copy, ExternalLink, Loader2, RefreshCw,
  ShieldCheck, Smartphone, Trash2, X,
} from 'lucide-react';
import { authService } from '../services/auth';

interface SyncState {
  configured: boolean;
  subscription_url?: string;
  scope?: 'account' | 'user';
  rotated_at?: string;
  last_accessed_at?: string | null;
}

export function CalendarSyncModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/agenda/calendar-sync', { headers: authService.getAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Falha ao consultar sincronização.');
        if (active) setState(body);
      })
      .catch((reason) => { if (active) setError(reason.message || 'Falha ao consultar sincronização.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function generateLink(replace = false) {
    if (replace && !window.confirm('Trocar o link interrompe a agenda já adicionada no Google ou iPhone. Será necessário assinar o novo endereço. Continuar?')) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/agenda/calendar-sync', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Falha ao gerar link privado.');
      setState(body);
      setCopied(false);
    } catch (reason: any) {
      setError(reason.message || 'Falha ao gerar link privado.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!state?.subscription_url) return;
    try {
      await navigator.clipboard.writeText(state.subscription_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o endereço e copie manualmente.');
    }
  }

  async function disableSync() {
    if (!window.confirm('Desativar a sincronização? O link atual deixará de funcionar no Google Agenda e no iPhone.')) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/agenda/calendar-sync', {
        method: 'DELETE',
        headers: authService.getAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Falha ao desativar sincronização.');
      setState({ configured: false });
      setCopied(false);
    } catch (reason: any) {
      setError(reason.message || 'Falha ao desativar sincronização.');
    } finally {
      setSaving(false);
    }
  }

  function openGoogleInstructions() {
    void copyLink();
    window.open('https://calendar.google.com/calendar/u/0/r/settings/addbyurl', '_blank', 'noopener,noreferrer');
  }

  function openAppleSubscription() {
    if (!state?.subscription_url) return;
    window.location.href = state.subscription_url.replace(/^https:/i, 'webcal:');
  }

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Sincronizar calendário">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-[var(--glass-border-strong)] bg-[var(--bg-elevated)] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--hairline-strong)] px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/12 text-blue-300">
              <CalendarSync size={19} />
            </div>
            <div>
              <h3 className="text-lg font-black text-[var(--text-hi)]">Sincronizar calendário</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-low)]">Veja os compromissos do ImobiFlow no Google Agenda ou Calendário do iPhone.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)]"><X size={18} /></button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5 sm:p-6">
          {error && <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-[var(--text-low)]"><Loader2 className="animate-spin" size={17} /> Consultando integração…</div>
          ) : !state?.configured ? (
            <div className="py-5 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] text-[var(--text-low)]"><CalendarSync size={23} /></div>
              <h4 className="text-[15px] font-bold text-[var(--text-hi)]">Nenhum calendário conectado</h4>
              <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-[var(--text-low)]">Gere um endereço privado. Tudo que for criado, alterado ou cancelado na Agenda do ImobiFlow aparecerá no calendário assinado.</p>
              <button type="button" disabled={saving} onClick={() => generateLink(false)} className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-blue-400/25 bg-blue-600/80 px-5 py-3 text-[13px] font-bold text-white hover:bg-blue-600 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={16} /> : <CalendarSync size={16} />} Gerar link privado
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-200"><ShieldCheck size={15} /> Sincronização disponível</div>
                <p className="mt-1 text-[11px] text-emerald-100/60">{state.scope === 'account' ? 'Inclui a agenda de toda a conta.' : 'Inclui somente os seus agendamentos.'}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-low)]">Endereço privado de assinatura</label>
                <div className="flex gap-2">
                  <input readOnly value={state.subscription_url || ''} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] px-3 py-2.5 text-[11px] text-[var(--text-mid)] outline-none" />
                  <button type="button" onClick={copyLink} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] px-3 py-2 text-[11px] font-bold text-[var(--text-mid)] hover:bg-[var(--control-fill-hover)]">
                    {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-amber-200/70">Este endereço permite ler seus compromissos. Não envie para outras pessoas. Se houver exposição, use “Trocar link”.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-[var(--text-hi)]"><CalendarSync size={16} className="text-blue-300" /> Google Agenda</div>
                  <ol className="mb-4 space-y-1 text-[11px] leading-relaxed text-[var(--text-low)]">
                    <li>1. Abra pelo computador.</li>
                    <li>2. Em “Outras agendas”, clique em <b>+</b>.</li>
                    <li>3. Escolha <b>Do URL</b> e cole o endereço.</li>
                  </ol>
                  <button type="button" onClick={openGoogleInstructions} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[11px] font-bold text-blue-200 hover:bg-blue-500/20"><ExternalLink size={13} /> Copiar e abrir Google</button>
                </div>

                <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-[var(--text-hi)]"><Smartphone size={16} className="text-sky-300" /> iPhone / iCloud</div>
                  <ol className="mb-4 space-y-1 text-[11px] leading-relaxed text-[var(--text-low)]">
                    <li>1. Abra Calendário → Calendários.</li>
                    <li>2. Toque em <b>Adicionar Calendário</b>.</li>
                    <li>3. Escolha <b>Adicionar Calendário Assinado</b>.</li>
                  </ol>
                  <button type="button" onClick={openAppleSubscription} className="inline-flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20"><Smartphone size={13} /> Abrir assinatura no iPhone</button>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)] px-4 py-3 text-[10px] leading-relaxed text-[var(--text-low)]">A assinatura é somente leitura. Alterações são feitas no ImobiFlow; Google e Apple definem a frequência de atualização e podem levar alguns minutos para buscar mudanças.</div>

              <div className="flex flex-col gap-2 border-t border-[var(--hairline)] pt-4 sm:flex-row sm:justify-between">
                <button type="button" disabled={saving} onClick={() => generateLink(true)} className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] disabled:opacity-50"><RefreshCw size={13} /> Trocar link</button>
                <button type="button" disabled={saving} onClick={disableSync} className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold text-red-300/70 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"><Trash2 size={13} /> Desativar sincronização</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
