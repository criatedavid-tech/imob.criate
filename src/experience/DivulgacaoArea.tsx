import React, { useEffect, useState } from 'react';
import { Loader2, Megaphone, Copy, Check, ExternalLink, Monitor, Building2 } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

// Etapa 10 (Divulgação) — por ora só a vitrine pública (o que dá pra fazer sem
// integração externa). Portais (OLX/ZAP) e disparo de campanha ficam de fora:
// portais exigem integração com cada portal; campanha em massa depende do envio
// por WhatsApp, resolvida pelo transporte nativo da V2.
export function DivulgacaoArea() {
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [developmentsCount, setDevelopmentsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'vitrine' | 'lancamentos' | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/brokers/me', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/properties', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/lancamentos/developments', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([me, props, devs]) => {
        if (!me?.id) throw new Error('Não consegui carregar seu perfil.');
        setBrokerId(me.id);
        const list = Array.isArray(props) ? props : [];
        setAvailableCount(list.filter((p: any) => !['vendido', 'alugado'].includes((p.status || 'disponivel').toLowerCase())).length);
        setDevelopmentsCount(Array.isArray(devs) ? devs.length : 0);
      })
      .catch((e) => setError(e.message || 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, []);

  const vitrineUrl = brokerId ? `${window.location.origin}/vitrine/${brokerId}` : '';
  const lancamentosVitrineUrl = brokerId ? `${window.location.origin}/lancamentos-vitrine/${brokerId}` : '';

  const copy = (url: string, which: 'vitrine' | 'lancamentos') => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Divulgação</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Divulgação</h2>

      <GlassCard className="!p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-violet-400/30 to-indigo-500/30 border border-[var(--glass-border)]">
            <Megaphone className="w-5 h-5 text-violet-200" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-bold text-[var(--text-hi)]">Sua vitrine pública</h3>
            <p className="text-[13px] text-[var(--text-mid)] mt-1">
              Um link único com todos os seus imóveis disponíveis
              {availableCount !== null && <> — <span className="text-[var(--text-hi)] font-semibold">{availableCount} no ar</span></>}.
              Mande no WhatsApp, coloque na bio do Instagram, use onde quiser.
            </p>

            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <div className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-[13px] text-[var(--text-mid)] font-mono truncate
                bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
                {vitrineUrl}
              </div>
              <button onClick={() => copy(vitrineUrl, 'vitrine')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)]
                  bg-violet-500/30 border border-violet-300/30 hover:bg-violet-500/50 transition-colors">
                {copied === 'vitrine' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied === 'vitrine' ? 'Copiado' : 'Copiar'}
              </button>
              <a href={vitrineUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-[var(--text-mid)]
                  bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] transition-colors">
                <ExternalLink className="w-4 h-4" /> Abrir
              </a>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Prévia ao vivo da vitrine — iframe da própria página pública (/vitrine/:id).
          Same-origin: CSP frameAncestors 'self' + X-Frame-Options SAMEORIGIN permitem.
          É a página REAL, então o que o corretor vê aqui é idêntico ao que o cliente vê. */}
      <GlassCard className="!p-0 overflow-hidden mb-5">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--hairline)]">
          <Monitor className="w-4 h-4 text-[var(--text-low)]" />
          <h3 className="text-[13px] font-semibold text-[var(--text-low)] tracking-wide uppercase">Prévia da vitrine</h3>
          <span className="text-[12px] text-[var(--text-low)] hidden sm:inline">— é isso que seu cliente vê ao abrir o link</span>
        </div>

        {availableCount === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[14px] text-[var(--text-mid)]">Nenhum imóvel disponível pra mostrar ainda.</p>
            <p className="text-[13px] text-[var(--text-low)] mt-1">Cadastre imóveis na Carteira e eles aparecem aqui na hora.</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[var(--control-fill)] border-b border-[var(--hairline)]">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--danger)' }} />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--warning)' }} />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--success)' }} />
              <div className="flex-1 min-w-0 mx-2 truncate text-center text-[11px] font-mono text-[var(--text-low)] rounded-md px-3 py-1
                bg-[var(--bg-base)] border border-[var(--hairline)]">
                {vitrineUrl}
              </div>
              <a href={vitrineUrl} target="_blank" rel="noreferrer"
                className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--text-mid)] hover:text-[var(--text-hi)] transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> Abrir
              </a>
            </div>
            <iframe
              src={vitrineUrl}
              title="Prévia da vitrine pública"
              loading="lazy"
              className="w-full block bg-[var(--bg-base)]"
              style={{ height: 540, border: 0 }}
            />
          </div>
        )}
      </GlassCard>

      {developmentsCount !== null && developmentsCount > 0 && (
        <GlassCard className="!p-6 mb-5">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
              bg-gradient-to-br from-violet-400/30 to-indigo-500/30 border border-[var(--glass-border)]">
              <Building2 className="w-5 h-5 text-violet-200" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[16px] font-bold text-[var(--text-hi)]">Vitrine de Lançamentos</h3>
              <p className="text-[13px] text-[var(--text-mid)] mt-1">
                Um link único com seus <span className="text-[var(--text-hi)] font-semibold">{developmentsCount} empreendimento{developmentsCount === 1 ? '' : 's'}</span>,
                com foto, benefícios e % vendido — sem expor dado de comprador.
              </p>

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <div className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-[13px] text-[var(--text-mid)] font-mono truncate
                  bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
                  {lancamentosVitrineUrl}
                </div>
                <button onClick={() => copy(lancamentosVitrineUrl, 'lancamentos')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold text-[var(--text-hi)]
                    bg-violet-500/30 border border-violet-300/30 hover:bg-violet-500/50 transition-colors">
                  {copied === 'lancamentos' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied === 'lancamentos' ? 'Copiado' : 'Copiar'}
                </button>
                <a href={lancamentosVitrineUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-[var(--text-mid)]
                    bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] transition-colors">
                  <ExternalLink className="w-4 h-4" /> Abrir
                </a>
              </div>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
