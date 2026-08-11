import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarSync, Check, Cloud, Copy, ExternalLink, KeyRound, Loader2,
  RefreshCw, ShieldCheck, Smartphone, Trash2, X,
} from 'lucide-react';
import { authService } from '../services/auth';

interface FeedState {
  configured: boolean;
  subscription_url?: string;
  scope?: 'account' | 'user';
  last_accessed_at?: string | null;
}

interface GoogleState {
  available: boolean;
  configured: boolean;
  id?: string;
  status?: 'active' | 'reauthorize' | 'error' | 'disabled';
  scope?: 'account' | 'user';
  last_synced_at?: string | null;
  last_error?: string | null;
}

interface IPhoneState {
  configured: boolean;
  id?: string;
  status?: string;
  server?: string;
  caldav_username?: string;
  username?: string;
  password?: string;
  password_visible_once?: boolean;
  scope?: 'account' | 'user';
  last_synced_at?: string | null;
  last_error?: string | null;
}

type BusyAction = 'google-connect' | 'google-sync' | 'google-delete' | 'iphone-create' | 'iphone-delete' | 'feed' | '';

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authService.getAuthHeaders(), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'Falha na sincronização.');
  return body as T;
}

function whenLabel(value?: string | null): string {
  if (!value) return 'Ainda não sincronizado';
  return `Última sincronização: ${new Date(value).toLocaleString('pt-BR')}`;
}

function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch { /* o campo ao lado ainda permite cópia manual */ }
  }
  return (
    <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--hairline-strong)] bg-[var(--control-fill)] px-3 py-2 text-[11px] font-bold text-[var(--text-mid)] hover:bg-[var(--control-fill-hover)]">
      {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />} {copied ? 'Copiado' : label}
    </button>
  );
}

function CredentialRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-[var(--text-low)]">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} type={secret ? 'text' : undefined} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-[var(--hairline-strong)] bg-black/10 px-3 py-2 text-[11px] text-[var(--text-mid)] outline-none" />
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function CalendarSyncModal({ onClose }: { onClose: () => void }) {
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [google, setGoogle] = useState<GoogleState | null>(null);
  const [iphone, setIphone] = useState<IPhoneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>('');
  const [error, setError] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [feedState, googleState, iphoneState] = await Promise.all([
        api<FeedState>('/api/agenda/calendar-sync'),
        api<GoogleState>('/api/agenda/google-sync'),
        api<IPhoneState>('/api/agenda/iphone-sync'),
      ]);
      setFeed(feedState);
      setGoogle(googleState);
      setIphone(iphoneState);
    } catch (reason: any) {
      setError(reason.message || 'Falha ao consultar sincronizações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'imobiflow:calendar-oauth') return;
      if (!event.data.ok) setError(event.data.message || 'O Google não autorizou a conexão.');
      void load();
      setBusy('');
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [load]);

  async function connectGoogle() {
    setBusy('google-connect'); setError('');
    try {
      const result = await api<{ authorization_url: string }>('/api/agenda/google-sync/connect', { method: 'POST' });
      const popup = window.open(result.authorization_url, 'imobiflow-google-calendar', 'popup,width=560,height=720');
      if (!popup) throw new Error('O navegador bloqueou a janela do Google. Libere pop-ups e tente novamente.');
      const monitor = window.setInterval(() => {
        if (popup.closed) { window.clearInterval(monitor); setBusy(''); void load(); }
      }, 800);
    } catch (reason: any) {
      setError(reason.message || 'Falha ao conectar Google Agenda.'); setBusy('');
    }
  }

  async function syncGoogle() {
    setBusy('google-sync'); setError('');
    try { await api('/api/agenda/google-sync/run', { method: 'POST' }); await load(); }
    catch (reason: any) { setError(reason.message || 'Falha ao sincronizar Google Agenda.'); }
    finally { setBusy(''); }
  }

  async function deleteGoogle() {
    if (!window.confirm('Desconectar o Google Agenda? Os eventos que já estão no Google não serão apagados.')) return;
    setBusy('google-delete'); setError('');
    try { await api('/api/agenda/google-sync', { method: 'DELETE' }); await load(); }
    catch (reason: any) { setError(reason.message || 'Falha ao desconectar Google Agenda.'); }
    finally { setBusy(''); }
  }

  async function createIphone(replace = false) {
    if (replace && !window.confirm('Gerar uma nova senha? O iPhone conectado com a senha anterior deixará de sincronizar.')) return;
    setBusy('iphone-create'); setError('');
    try { setIphone(await api<IPhoneState>('/api/agenda/iphone-sync', { method: 'POST' })); }
    catch (reason: any) { setError(reason.message || 'Falha ao gerar acesso do iPhone.'); }
    finally { setBusy(''); }
  }

  async function deleteIphone() {
    if (!window.confirm('Desativar o calendário gravável do iPhone? A credencial atual deixará de funcionar.')) return;
    setBusy('iphone-delete'); setError('');
    try { await api('/api/agenda/iphone-sync', { method: 'DELETE' }); await load(); }
    catch (reason: any) { setError(reason.message || 'Falha ao desativar iPhone.'); }
    finally { setBusy(''); }
  }

  async function generateFeed(replace = false) {
    if (replace && !window.confirm('Trocar o link interrompe os calendários assinados anteriormente. Continuar?')) return;
    setBusy('feed'); setError('');
    try { setFeed(await api<FeedState>('/api/agenda/calendar-sync', { method: 'POST' })); }
    catch (reason: any) { setError(reason.message || 'Falha ao gerar link privado.'); }
    finally { setBusy(''); }
  }

  const iphoneUsername = iphone?.username || iphone?.caldav_username || '';

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Sincronizar calendário">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-[28px] border border-[var(--glass-border-strong)] bg-[var(--bg-elevated)] shadow-[0_28px_90px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--hairline-strong)] px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/12 text-blue-300"><CalendarSync size={20} /></div>
            <div>
              <h3 className="text-lg font-black text-[var(--text-hi)]">Sincronização da Agenda</h3>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[var(--text-low)]">Crie ou altere compromissos no ImobiFlow, Google Agenda ou iPhone e mantenha tudo organizado.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)]"><X size={18} /></button>
        </div>

        <div className="max-h-[78vh] space-y-4 overflow-y-auto p-4 sm:p-6">
          {error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-[12px] text-[var(--text-low)]"><Loader2 className="animate-spin" size={17} /> Consultando integrações…</div>
          ) : (
            <>
              <section className="rounded-3xl border border-blue-400/20 bg-gradient-to-br from-blue-500/[0.10] to-transparent p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300"><Cloud size={19} /></div>
                    <div>
                      <h4 className="text-[14px] font-black text-[var(--text-hi)]">Google Agenda — bidirecional</h4>
                      <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-[var(--text-low)]">O ImobiFlow cria uma agenda Google separada. Eventos feitos nela pelo computador ou pelo iPhone entram no ImobiFlow.</p>
                    </div>
                  </div>
                  {google?.configured ? (
                    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${google.status === 'active' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/20 bg-amber-500/10 text-amber-200'}`}><ShieldCheck size={12} /> {google.status === 'active' ? 'Conectado' : 'Precisa de atenção'}</span>
                  ) : null}
                </div>
                {!google?.available ? (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-[11px] text-amber-100/80">A integração aguarda as credenciais OAuth do Google no servidor.</div>
                ) : google.configured ? (
                  <div className="mt-4 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[10px] text-[var(--text-low)]">{whenLabel(google.last_synced_at)}{google.last_error ? <span className="mt-1 block text-amber-200/80">{google.last_error}</span> : null}</div>
                    <div className="flex flex-wrap gap-2">
                      {google.status === 'reauthorize' && <button type="button" onClick={connectGoogle} disabled={!!busy} className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-200">Reconectar</button>}
                      <button type="button" onClick={syncGoogle} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[11px] font-bold text-blue-200 hover:bg-blue-500/20 disabled:opacity-50">{busy === 'google-sync' ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} Sincronizar agora</button>
                      <button type="button" onClick={deleteGoogle} disabled={!!busy} aria-label="Desconectar Google" className="rounded-xl p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-200"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={connectGoogle} disabled={!!busy} className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-blue-400/25 bg-blue-600/80 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-blue-600 disabled:opacity-50">{busy === 'google-connect' ? <Loader2 className="animate-spin" size={15} /> : <ExternalLink size={15} />} Conectar Google Agenda</button>
                )}
              </section>

              <section className="rounded-3xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.10] to-transparent p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300"><Smartphone size={19} /></div>
                    <div>
                      <h4 className="text-[14px] font-black text-[var(--text-hi)]">Calendário do iPhone — bidirecional</h4>
                      <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-[var(--text-low)]">Adicione uma conta CalDAV “ImobiFlow”. Eventos criados nessa agenda do iPhone aparecem aqui, sem informar sua senha da Apple.</p>
                    </div>
                  </div>
                  {iphone?.configured && <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-200"><ShieldCheck size={12} /> Ativo</span>}
                </div>

                {!iphone?.configured ? (
                  <button type="button" onClick={() => createIphone(false)} disabled={!!busy} className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-sky-400/25 bg-sky-600/70 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-sky-600 disabled:opacity-50">{busy === 'iphone-create' ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />} Gerar acesso para iPhone</button>
                ) : (
                  <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
                    {iphone.password_visible_once && iphone.password ? (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-[10px] leading-relaxed text-amber-100/80"><b>Salve a senha agora.</b> Por segurança ela é exibida uma única vez. Se perder, gere outra.</div>
                    ) : (
                      <div className="text-[10px] text-[var(--text-low)]">A senha não fica disponível para consulta. Use “Gerar nova senha” se precisar configurar outro aparelho.</div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <CredentialRow label="Servidor" value={iphone.server || ''} />
                      <CredentialRow label="Usuário" value={iphoneUsername} />
                    </div>
                    {iphone.password && <CredentialRow label="Senha" value={iphone.password} secret />}
                    <div className="rounded-2xl border border-[var(--hairline)] bg-black/[0.08] p-4">
                      <p className="text-[11px] font-bold text-[var(--text-hi)]">No iPhone</p>
                      <ol className="mt-2 space-y-1 text-[10px] leading-relaxed text-[var(--text-low)]">
                        <li>1. Ajustes → Apps → Calendário → Contas do Calendário.</li>
                        <li>2. Adicionar Conta → Outra → Adicionar Conta CalDAV.</li>
                        <li>3. Preencha servidor, usuário e senha acima; descrição “ImobiFlow”.</li>
                        <li>4. Ao criar um evento, selecione o calendário <b>ImobiFlow</b>.</li>
                      </ol>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <button type="button" onClick={() => createIphone(true)} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold text-[var(--text-low)] hover:bg-[var(--control-fill-hover)]"><RefreshCw size={13} /> Gerar nova senha</button>
                      <button type="button" onClick={deleteIphone} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold text-red-300/70 hover:bg-red-500/10 hover:text-red-200"><Trash2 size={13} /> Desativar iPhone</button>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)]">
                <button type="button" onClick={() => setShowLegacy((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <div><p className="text-[12px] font-bold text-[var(--text-mid)]">Assinatura simples (.ics)</p><p className="mt-0.5 text-[10px] text-[var(--text-low)]">Opção antiga, compatível e somente leitura.</p></div>
                  <span className="text-[10px] font-bold text-blue-300">{showLegacy ? 'Ocultar' : 'Mostrar'}</span>
                </button>
                {showLegacy && <div className="space-y-3 border-t border-[var(--hairline)] p-4">
                  <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-3 py-2 text-[10px] text-amber-100/70">A assinatura é somente leitura: eventos do telefone não entram no ImobiFlow por este link.</div>
                  {feed?.configured && feed.subscription_url ? (
                    <><CredentialRow label="Endereço privado" value={feed.subscription_url} /><div className="flex justify-end"><button type="button" onClick={() => generateFeed(true)} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-bold text-[var(--text-low)] hover:bg-[var(--control-fill-hover)]"><RefreshCw size={12} /> Trocar link</button></div></>
                  ) : (
                    <button type="button" onClick={() => generateFeed(false)} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl border border-[var(--hairline-strong)] px-3 py-2 text-[11px] font-bold text-[var(--text-mid)]"><CalendarSync size={13} /> Gerar link somente leitura</button>
                  )}
                </div>}
              </section>

              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3 text-[10px] leading-relaxed text-emerald-100/70"><ShieldCheck className="mr-1 inline" size={12} /> Os horários continuam usando a conversão já validada. Google e iPhone recebem datas ISO preservando o fuso de São Paulo.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
