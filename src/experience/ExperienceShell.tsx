import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Plus, ChevronDown, Loader2, Shield, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ManualRail } from './ManualRail';
import { Canvas } from './Canvas';
import { CommandBar } from './CommandBar';
import { PERSONA_LABEL, AREAS } from './engine';
import { fetchCorretorLayout, fetchIncorporadoraLayout, fetchImobiliariaLayout } from './realData';
import { CarteiraArea } from './CarteiraArea';
import { ConversasArea } from './ConversasArea';
import { NegociosArea } from './NegociosArea';
import { ContatosArea } from './ContatosArea';
import { AgendaArea } from './AgendaArea';
import { LocacaoArea } from './LocacaoArea';
import { LancamentosArea } from './LancamentosArea';
import { FinanceiroArea } from './FinanceiroArea';
import { EquipeArea } from './EquipeArea';
import { RelatoriosArea } from './RelatoriosArea';
import { DivulgacaoArea } from './DivulgacaoArea';
import { ConfigArea } from './ConfigArea';
import { AssistenteIAArea } from './AssistenteIAArea';
import type { Autonomy, LayoutSpec, Persona } from './types';
import { authService } from '../services/auth';
import { cn } from '../lib/utils';

const PERSONAS: Persona[] = ['corretor', 'imobiliaria', 'incorporadora'];
const AUTONOMY_LABEL: Record<Autonomy, string> = {
  piloto: 'Piloto automático',
  copiloto: 'Copiloto',
  manual: 'Manual',
};
const AUTONOMY_ORDER: Autonomy[] = ['piloto', 'copiloto', 'manual'];

// Estado vazio, elegante e didático, para áreas ainda não construídas (ensina a dupla via IA/manual).
function AreaEmptyState({ areaKey }: { areaKey: string }) {
  const area = AREAS.find((a) => a.key === areaKey);
  return (
    <div className="max-w-6xl mx-auto w-full flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5
          bg-white/[0.06] border border-white/12">
          <Sparkles className="w-6 h-6 text-violet-200" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">{area?.label}</h2>
        <p className="text-[15px] text-white/55 leading-relaxed">
          Aqui vive tudo de <strong className="text-white/80">{area?.label}</strong>. Você pode pedir à IA
          (ex.: <em>"me mostra {area?.label.toLowerCase()}"</em>) ou usar o botão abaixo para fazer manualmente.
        </p>
        <button className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-white
          bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors">
          <Plus className="w-4 h-4" /> Novo em {area?.label}
        </button>
        <p className="text-[12px] text-white/30 mt-4">Tela manual completa chega na sua etapa do roadmap.</p>
      </div>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
      <Loader2 className="w-7 h-7 text-white/60 animate-spin" />
    </div>
  );
}

export function ExperienceShell() {
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [persona, setPersona] = useState<Persona>('corretor');
  // Só admin pode trocar de persona ("ver como"); usuário normal fica travado
  // no tipo da própria conta (imf_brokers.account_type).
  const [isAdmin, setIsAdmin] = useState(false);
  const [area, setArea] = useState('hoje');
  const [autonomy, setAutonomy] = useState<Autonomy>('piloto');
  const [layout, setLayout] = useState<LayoutSpec | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Bump quando a IA executa uma ação — remonta a área atual (refetch) e
  // refaz o cockpit, pra a tela nunca ficar defasada do que a IA acabou de fazer.
  const [refreshKey, setRefreshKey] = useState(0);

  // /app exige login: o cockpit mostra dados reais da conta, então precisa saber
  // quem está logado. Aqui também buscamos o account_type (o "mundo" da conta) pra
  // travar a persona no tipo certo, e is_admin pra liberar o "ver como".
  useEffect(() => {
    if (!authService.isLoggedIn()) {
      navigate('/login');
      return;
    }
    let cancelled = false;
    fetch('/api/brokers/me', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled) return;
        if (me?.account_type && (PERSONAS as string[]).includes(me.account_type)) {
          setPersona(me.account_type as Persona);
        }
        setIsAdmin(!!me?.is_admin);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCheckingAuth(false); });
    return () => { cancelled = true; };
  }, [navigate]);

  // As 3 personas têm cockpit com dado real agora (Locação/Lançamentos/
  // Relatórios já existem) — nenhuma cai mais em mock puro.
  useEffect(() => {
    if (checkingAuth) return;
    let cancelled = false;
    const refresh = () => setRefreshKey((k) => k + 1);
    setLoadingLayout(true);
    const fetcher =
      persona === 'corretor' ? fetchCorretorLayout() :
      persona === 'incorporadora' ? fetchIncorporadoraLayout(refresh) :
      fetchImobiliariaLayout(refresh, setArea);
    fetcher
      .then((l) => { if (!cancelled) setLayout(l); })
      .finally(() => { if (!cancelled) setLoadingLayout(false); });
    return () => { cancelled = true; };
  }, [persona, checkingAuth, refreshKey]);

  // Mutação manual noutra área (ex.: criar contrato em Locação, sem passar
  // pela IA) não bump a refreshKey — só a IA fazia isso (onActionDone). Sem
  // isso, voltar pro Hoje mostrava número velho até trocar de persona ou dar
  // F5. Dispara só na TRANSIÇÃO pra 'hoje' (não no mount, que o efeito acima
  // já cobre), pra não duplicar a busca inicial.
  const prevAreaRef = useRef(area);
  useEffect(() => {
    if (prevAreaRef.current !== 'hoje' && area === 'hoje') {
      setRefreshKey((k) => k + 1);
    }
    prevAreaRef.current = area;
  }, [area]);

  const cycleAutonomy = () =>
    setAutonomy((a) => AUTONOMY_ORDER[(AUTONOMY_ORDER.indexOf(a) + 1) % AUTONOMY_ORDER.length]);

  // Ao trocar de persona, volta para "Hoje" (área comum a todas).
  const changePersona = (p: Persona) => { setPersona(p); setArea('hoje'); };

  // Quem está logado — precisa ficar visível na barra pra nunca haver dúvida
  // de "em qual conta eu estou" (foi o que causou a confusão do Diego/David).
  const currentUser = authService.getUser();
  const accountLabel = currentUser?.name || currentUser?.email || '';

  if (checkingAuth) return <FullScreenSpinner />;

  return (
    <div className="flex h-screen overflow-hidden font-sans relative
      bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
      {/* brilho de fundo (profundidade de vidro, minimalista) */}
      <div className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[380px] h-[380px] rounded-full bg-indigo-500/15 blur-[120px] pointer-events-none" />

      <ManualRail
        persona={persona}
        active={area}
        onSelect={setArea}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <main className="flex-1 relative overflow-y-auto">
        {/* Barra superior */}
        <div className="sticky top-0 z-20 backdrop-blur-2xl bg-slate-900/30 border-b border-white/8">
          <div className="max-w-6xl mx-auto w-full px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="md:hidden shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
                aria-label="Abrir menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              {isAdmin ? (
                <>
                  {/* Só admin troca de persona — pra demonstrar/dar suporte */}
                  <span className="text-[11px] text-white/35 mr-1 hidden sm:inline">ver como</span>
                  <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.05] border border-white/10">
                    {PERSONAS.map((p) => (
                      <button key={p} onClick={() => changePersona(p)}
                        className={cn(
                          'px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors',
                          persona === p ? 'bg-white/[0.14] text-white' : 'text-white/45 hover:text-white/75',
                        )}>
                        {PERSONA_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                // Usuário normal: só vê o mundo da própria conta (sem troca).
                <span className="px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white/70 bg-white/[0.06] border border-white/10">
                  {PERSONA_LABEL[persona]}
                </span>
              )}
              {/* Aviso honesto: nunca deixar parecer que o mock é dado real da conta */}
              {layout && !layout.isRealData && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300 bg-amber-400/15 px-2 py-1 rounded-full">
                  prévia · dados de demonstração
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Painel admin — só is_admin. Reusa o painel completo do 1.0 (/admin). */}
              {isAdmin && (
                <button onClick={() => navigate('/admin')}
                  title="Painel administrativo"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[12px] font-semibold text-amber-200
                    bg-amber-400/12 border border-amber-300/25 hover:bg-amber-400/20 transition-colors">
                  <Shield className="w-3.5 h-3.5" /> Admin
                </button>
              )}

              {/* Conta logada — clicável leva pra Config (onde vive o "Sair") */}
              {accountLabel && (
                <button onClick={() => setArea('config')}
                  title={currentUser?.email || ''}
                  className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-2xl
                    bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] transition-colors max-w-[180px]">
                  <span className="w-5 h-5 rounded-full bg-violet-500/40 border border-white/15 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                    {accountLabel.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[12px] font-semibold text-white/70 truncate">{accountLabel}</span>
                </button>
              )}

              {/* Botão de autonomia */}
              <button onClick={cycleAutonomy}
                className="flex items-center gap-2 px-3.5 py-2 rounded-2xl text-[12px] font-semibold text-white
                  bg-white/[0.06] border border-white/12 hover:bg-white/[0.12] transition-colors">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {AUTONOMY_LABEL[autonomy]}
                <ChevronDown className="w-3.5 h-3.5 text-white/40" />
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo: canvas generativo (Hoje) ou área manual.
            key inclui refreshKey → ação da IA remonta a área e força refetch. */}
        <div key={`${area}-${refreshKey}`} className="px-6 pt-6 pb-16">
          {area === 'carteira' ? (
            <CarteiraArea />
          ) : area === 'conversas' ? (
            <ConversasArea />
          ) : area === 'negocios' ? (
            <NegociosArea />
          ) : area === 'contatos' ? (
            <ContatosArea />
          ) : area === 'agenda' ? (
            <AgendaArea />
          ) : area === 'locacao' ? (
            <LocacaoArea />
          ) : area === 'lancamentos' ? (
            <LancamentosArea />
          ) : area === 'financeiro' ? (
            <FinanceiroArea />
          ) : area === 'equipe' ? (
            <EquipeArea />
          ) : area === 'relatorios' ? (
            <RelatoriosArea />
          ) : area === 'divulgacao' ? (
            <DivulgacaoArea />
          ) : area === 'assistente-ia' ? (
            <AssistenteIAArea />
          ) : area === 'config' ? (
            <ConfigArea />
          ) : area !== 'hoje' ? (
            <AreaEmptyState areaKey={area} />
          ) : loadingLayout || !layout ? (
            <div className="flex justify-center pt-24">
              <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
            </div>
          ) : (
            <Canvas layout={layout} onAreaClick={setArea} />
          )}
        </div>

      </main>

      {/* Botão flutuante — abre o chat. */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          aria-label="Falar com a IA"
          className="absolute bottom-6 right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center
            text-white bg-gradient-to-br from-violet-500/80 to-indigo-600/80 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_12px_32px_-8px_rgba(76,29,149,0.6)]
            hover:scale-105 active:scale-95 transition-transform"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* Chat — overlay independente, NUNCA aninhado dentro de um ancestral com
          transform (nem em rotateY(0)): qualquer transform em ancestral vira
          containing block novo pra filhos "fixed", e a app inteira tem vários
          modais "fixed inset-0" (leads, equipe, lançamentos, locação,
          conversas) que quebravam — apareciam espelhados/presos no mobile,
          onde o viewport real diverge do 100vh por causa da barra do Safari.
          Por isso a animação de entrada vive só aqui, isolada, sem tocar
          na árvore principal do app. */}
      <AnimatePresence>
        {chatOpen && (
          <div className="fixed inset-0 z-[100]" style={{ perspective: 1800 }}>
            <motion.div
              initial={{ rotateY: -100, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: -100, opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
              style={{ transformStyle: 'preserve-3d', transformOrigin: 'right center' }}
              className="w-full h-full"
            >
              <CommandBar
                persona={persona}
                autonomy={autonomy}
                onNavigate={(a) => { setArea(a); setChatOpen(false); }}
                onActionDone={() => setRefreshKey((k) => k + 1)}
                onClose={() => setChatOpen(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
