import React, { useEffect, useState } from 'react';
import { Loader2, Megaphone, Copy, Check, ExternalLink, Home } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

// Etapa 10 (Divulgação) — por ora só a vitrine pública (o que dá pra fazer sem
// integração externa). Portais (OLX/ZAP) e disparo de campanha ficam de fora:
// portais exigem integração com cada portal; campanha em massa depende do envio
// por WhatsApp, que se resolve junto com a eliminação do Z-PRO.
export function DivulgacaoArea() {
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/brokers/me', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/properties', { headers: authService.getAuthHeaders() }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([me, props]) => {
        if (!me?.id) throw new Error('Não consegui carregar seu perfil.');
        setBrokerId(me.id);
        const list = Array.isArray(props) ? props : [];
        setAvailableCount(list.filter((p: any) => !['vendido', 'alugado'].includes((p.status || 'disponivel').toLowerCase())).length);
      })
      .catch((e) => setError(e.message || 'Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, []);

  const vitrineUrl = brokerId ? `${window.location.origin}/vitrine/${brokerId}` : '';

  const copy = () => {
    if (!vitrineUrl) return;
    navigator.clipboard.writeText(vitrineUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Divulgação</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Divulgação</h2>

      <GlassCard className="!p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-violet-400/30 to-indigo-500/30 border border-white/20">
            <Megaphone className="w-5 h-5 text-violet-200" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-bold text-white">Sua vitrine pública</h3>
            <p className="text-[13px] text-white/55 mt-1">
              Um link único com todos os seus imóveis disponíveis
              {availableCount !== null && <> — <span className="text-white/80 font-semibold">{availableCount} no ar</span></>}.
              Mande no WhatsApp, coloque na bio do Instagram, use onde quiser.
            </p>

            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <div className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-[13px] text-white/70 font-mono truncate
                bg-white/[0.05] border border-white/12">
                {vitrineUrl}
              </div>
              <button onClick={copy}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white
                  bg-violet-500/30 border border-violet-300/30 hover:bg-violet-500/50 transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
              <a href={vitrineUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white/70
                  bg-white/[0.05] border border-white/12 hover:bg-white/[0.1] transition-colors">
                <ExternalLink className="w-4 h-4" /> Abrir
              </a>
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="!p-6">
        <div className="flex items-center gap-2 mb-3">
          <Home className="w-4 h-4 text-white/40" />
          <h3 className="text-[13px] font-semibold text-white/50 tracking-wide uppercase">Ainda não disponível</h3>
        </div>
        <p className="text-[13px] text-white/40 leading-relaxed">
          Integração com portais (OLX, ZAP, Viva Real) e disparo de campanha em massa por WhatsApp entram numa próxima
          rodada — portais exigem integração com cada um deles, e a campanha depende do envio direto por WhatsApp, que
          está sendo resolvido junto com a migração de mensageria.
        </p>
      </GlassCard>
    </div>
  );
}
