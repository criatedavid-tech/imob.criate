import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Plus, ChevronDown, Loader2, Shield, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ManualRail } from './ManualRail';
import { Canvas } from './Canvas';
import { CommandBar } from './CommandBar';
import { PERSONA_LABEL, AREAS, defaultCapabilitiesForPersona } from './engine';
import { fetchCorretorLayout, fetchIncorporadoraLayout, fetchImobiliariaLayout } from './realData';
import { ThemeToggle } from './ThemeToggle';
import type { AccountCapability, Autonomy, LayoutSpec, Persona } from './types';
import { authService } from '../services/auth';
import { cn } from '../lib/utils';

// Cada área vira seu próprio pedaço do bundle, carregado só quando o corretor
// abre aquela tela. Antes tudo entrava no MESMO arquivo (~340 KB): quem só usa
// Conversas baixava Lançamentos, Locação, Config, Equipe, Relatórios e o
// calendário da Agenda sem nunca abrir. São exports nomeados, por isso o .then
// mapeando para `default`.
const CarteiraArea = lazy(() => import('./CarteiraArea').then((m) => ({ default: m.CarteiraArea })));
const ConversasArea = lazy(() => import('./ConversasArea').then((m) => ({ default: m.ConversasArea })));
const NegociosArea = lazy(() => import('./NegociosArea').then((m) => ({ default: m.NegociosArea })));
const ContatosArea = lazy(() => import('./ContatosArea').then((m) => ({ default: m.ContatosArea })));
const LembretesArea = lazy(() => import('./LembretesArea').then((m) => ({ default: m.LembretesArea })));
const AgendaArea = lazy(() => import('./AgendaArea').then((m) => ({ default: m.AgendaArea })));
const LocacaoArea = lazy(() => import('./LocacaoArea').then((m) => ({ default: m.LocacaoArea })));
const LancamentosArea = lazy(() => import('./LancamentosArea').then((m) => ({ default: m.LancamentosArea })));
const FinanceiroArea = lazy(() => import('./FinanceiroArea').then((m) => ({ default: m.FinanceiroArea })));
const EquipeArea = lazy(() => import('./EquipeArea').then((m) => ({ default: m.EquipeArea })));
const RelatoriosArea = lazy(() => import('./RelatoriosArea').then((m) => ({ default: m.RelatoriosArea })));
const DivulgacaoArea = lazy(() => import('./DivulgacaoArea').then((m) => ({ default: m.DivulgacaoArea })));
const ConfigArea = lazy(() => import('./ConfigArea').then((m) => ({ default: m.ConfigArea })));
const AssistenteIAArea = lazy(() => import('./AssistenteIAArea').then((m) => ({ default: m.AssistenteIAArea })));

const PERSONAS: Persona[] = ['corretor', 'imobiliaria', 'incorporadora'];
const AUTONOMY_LABEL: Record<Autonomy, string> = {
  piloto: 'Piloto automático',
  copiloto: 'Copiloto',
  manual: 'Manual',
};
const AUTONOMY_MOBILE_LABEL: Record<Autonomy, string> = {
  piloto: 'Piloto',
  copiloto: 'Copiloto',
  manual: 'Manual',
};
const AUTONOMY_ORDER: Autonomy[] = ['piloto', 'copiloto', 'manual'];
// Só troca o rótulo — desde o hardening contra prompt injection (22/07/2026),
// os 3 modos se comportam igual: toda ação do Assistente IA (cadastrar,
// enviar mensagem, agendar etc.) sempre pede confirmação antes de executar,
// nunca roda sozinha, nem no Piloto automático.
const AUTONOMY_HINT = 'Toda ação do Assistente IA (cadastrar, enviar mensagem, agendar etc.) sempre pede sua confirmação antes de executar — em qualquer um dos 3 modos.';

// Toggle Dia/Noite. Liberado a pedido do usuário pra QA ao vivo do modo Dia.
// O modo Noite é o padrão; o Dia já é funcional (neutros/acentos/semânticos
// são theme-aware), faltando só polimento (latão nos valores R$ e cantos que
// o QA visual revelar).
const THEME_TOGGLE_ENABLED = true;

// Estado vazio, elegante e didático, para áreas ainda não construídas (ensina a dupla via IA/manual).
function AreaEmptyState({ areaKey }: { areaKey: string }) {
  const area = AREAS.find((a) => a.key === areaKey);
  return (
    <div className="max-w-6xl mx-auto w-full flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 border"
          style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
          <Sparkles className="w-6 h-6 cr-accent" />
        </div>
        <h2 className="text-2xl font-black cr-text-hi mb-2">{area?.label}</h2>
        <p className="text-[15px] cr-text-mid leading-relaxed">
          Aqui vive tudo de <strong className="cr-text-hi">{area?.label}</strong>. Você pode pedir à IA
          (ex.: <em>"me mostra {area?.label.toLowerCase()}"</em>) ou usar o botão abaixo para fazer manualmente.
        </p>
        <button className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold cr-text-hi border transition-colors hover:border-[var(--glass-border-strong)]"
          style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
          <Plus className="w-4 h-4" /> Novo em {area?.label}
        </button>
        <p className="text-[12px] cr-text-low mt-4">Tela manual completa chega na sua etapa do roadmap.</p>
      </div>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="app-bg min-h-screen flex items-center justify-center">
      <Loader2 className="w-7 h-7 cr-accent animate-spin" />
    </div>
  );
}

export function ExperienceShell() {
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [persona, setPersona] = useState<Persona>('corretor');
  const [capabilities, setCapabilities] = useState<AccountCapability[]>([]);
  // Só admin pode trocar de persona ("ver como"); usuário normal fica travado
  // no tipo da própria conta (imf_brokers.account_type).
  const [isAdmin, setIsAdmin] = useState(false);
  const [area, setArea] = useState('hoje');
  const [autonomy, setAutonomy] = useState<Autonomy>('piloto');
  const [layout, setLayout] = useState<LayoutSpec | null>(null);
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [conversationThreadOpen, setConversationThreadOpen] = useState(false);
  const [chatComposerFocused, setChatComposerFocused] = useState(false);
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
        if (Array.isArray(me?.capabilities)) {
          setCapabilities(me.capabilities);
        } else if (me?.account_type && (PERSONAS as string[]).includes(me.account_type)) {
          setCapabilities(defaultCapabilitiesForPersona(me.account_type as Persona));
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

  // The global AI action does not participate in composing a conversation.
  // Hide secondary floating actions while the chat input owns focus.
  useEffect(() => {
    let frame = 0;
    const syncComposerFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        setChatComposerFocused(!!active?.closest('[data-chat-composer="true"]'));
      });
    };
    document.addEventListener('focusin', syncComposerFocus);
    document.addEventListener('focusout', syncComposerFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', syncComposerFocus);
      document.removeEventListener('focusout', syncComposerFocus);
    };
  }, []);

  const cycleAutonomy = () =>
    setAutonomy((a) => AUTONOMY_ORDER[(AUTONOMY_ORDER.indexOf(a) + 1) % AUTONOMY_ORDER.length]);

  // Ao trocar de persona, volta para "Hoje" (área comum a todas).
  const changePersona = (p: Persona) => {
    setPersona(p);
    setCapabilities(defaultCapabilitiesForPersona(p));
    setArea('hoje');
  };

  // Quem está logado — precisa ficar visível na barra pra nunca haver dúvida
  // de "em qual conta eu estou" (foi o que causou a confusão do Diego/David).
  const currentUser = authService.getUser();
  const accountLabel = currentUser?.name || currentUser?.email || '';

  if (checkingAuth) return <FullScreenSpinner />;

  return (
    <div className="app-bg flex h-[100dvh] overflow-hidden font-sans relative">
      {/* O mesh gradient do .app-bg já dá a profundidade que o vidro refrata —
          dois realces de acento pra reforçar o "lensing" azure/aqua. */}
      <div className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full blur-[120px] pointer-events-none"
        style={{ background: 'var(--accent-soft)' }} />
      <div className="absolute bottom-0 right-0 w-[380px] h-[380px] rounded-full blur-[120px] pointer-events-none"
        style={{ background: 'var(--accent-2-soft)' }} />

      <ManualRail
        capabilities={capabilities}
        active={area}
        onSelect={setArea}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <main className="flex-1 relative overflow-y-auto">
        {/* Barra superior — vidro translúcido (tier-2) sobre o mesh */}
        <div className="sticky top-0 z-20 backdrop-blur-2xl border-b"
          style={{ background: 'var(--scrim-glass)', borderColor: 'var(--hairline)' }}>
          <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-3.5 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="md:hidden shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors cr-text-mid hover:bg-[var(--accent-soft)]"
                aria-label="Abrir menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              {isAdmin ? (
                <>
                  {/* Só admin troca de persona — pra demonstrar/dar suporte */}
                  <span className="text-[11px] cr-text-low mr-1 hidden sm:inline shrink-0">ver como</span>
                  {/* overflow-x-auto: no mobile as 3 opções (Corretor/Imobiliária/
                      Incorporadora) não cabem lado a lado com o resto da barra —
                      sem isso e sem shrink-0/whitespace-nowrap nos botões, o texto
                      quebrava linha dentro do próprio botão e sobrepunha o botão
                      de autonomia ao lado. */}
                  <div className="flex gap-1 p-1 rounded-2xl border overflow-x-auto max-w-full"
                    style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
                    {PERSONAS.map((p) => (
                      <button key={p} onClick={() => changePersona(p)}
                        className={cn(
                          'px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors shrink-0 whitespace-nowrap',
                          persona === p ? 'is-selected cr-text-hi' : 'cr-text-low hover:text-[var(--text-mid)]',
                        )}>
                        {PERSONA_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                // Usuário normal: só vê o mundo da própria conta (sem troca).
                <span className="px-3 py-1.5 rounded-xl text-[12px] font-semibold cr-text-mid border shrink-0 whitespace-nowrap"
                  style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
                  {PERSONA_LABEL[persona]}
                </span>
              )}
              {/* Aviso honesto: nunca deixar parecer que o mock é dado real da conta */}
              {layout && !layout.isRealData && (
                <span className="cr-chip cr-chip-warning text-[10px] font-bold uppercase tracking-wide shrink-0 whitespace-nowrap">
                  prévia · dados de demonstração
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-3 shrink-0">
              {/* Toggle de tema Dia/Noite — oculto até o modo Dia passar no QA */}
              {THEME_TOGGLE_ENABLED && <ThemeToggle className="shrink-0" />}

              {/* Painel admin — só is_admin. Reusa o painel completo do 1.0 (/admin). */}
              {isAdmin && (
                <button onClick={() => navigate('/admin')}
                  title="Painel administrativo"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[12px] font-semibold hover:brightness-105 transition-all shrink-0 whitespace-nowrap"
                  style={{ background: 'var(--brass-gradient)', color: 'var(--on-brass)' }}>
                  <Shield className="w-3.5 h-3.5 shrink-0" /> Admin
                </button>
              )}

              {/* Conta logada — clicável leva pra Config (onde vive o "Sair") */}
              {accountLabel && (
                <button onClick={() => setArea('config')}
                  title={currentUser?.email || ''}
                  className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-2xl border transition-colors max-w-[180px] hover:border-[var(--glass-border-strong)]"
                  style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ background: 'var(--accent-gradient)', color: 'var(--on-accent)' }}>
                    {accountLabel.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[12px] font-semibold cr-text-mid truncate">{accountLabel}</span>
                </button>
              )}

              {/* No mobile usa um rótulo curto para manter o controle legível sem
                  fazer a barra superior ultrapassar a largura da tela. */}
              <button onClick={cycleAutonomy} title={AUTONOMY_HINT}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2 rounded-2xl border text-[11px] sm:text-[12px] font-semibold cr-text-hi transition-colors shrink-0 whitespace-nowrap hover:border-[var(--glass-border-strong)]"
                style={{ background: 'var(--control-fill)', borderColor: 'var(--glass-border)' }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--success)' }} />
                <span className="sm:hidden">{AUTONOMY_MOBILE_LABEL[autonomy]}</span>
                <span className="hidden sm:inline">{AUTONOMY_LABEL[autonomy]}</span>
                <ChevronDown className="w-3.5 h-3.5 cr-text-low shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo: canvas generativo (Hoje) ou área manual.
            A key remonta a área para forçar refetch depois de uma ação da IA.
            Conversas fica FORA disso: ela já se atualiza sozinha a cada 5s, e
            remontar no meio do atendimento fechava a conversa aberta, apagava
            o rascunho digitado no composer e devolvia o scroll pro topo —
            justamente enquanto o corretor estava falando com um cliente. */}
        <div key={area === 'conversas' ? 'conversas' : `${area}-${refreshKey}`} className={cn(
          'px-6 pt-6 pb-16',
          area === 'conversas' && conversationThreadOpen && 'px-2.5 pt-3 pb-3 sm:px-6 sm:pt-6 sm:pb-16',
        )}>
          <Suspense fallback={
            <div className="flex justify-center pt-24">
              <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
            </div>
          }>
          {area === 'carteira' ? (
            <CarteiraArea />
          ) : area === 'conversas' ? (
            <ConversasArea onThreadOpenChange={setConversationThreadOpen} />
          ) : area === 'negocios' ? (
            <NegociosArea />
          ) : area === 'contatos' ? (
            <ContatosArea />
          ) : area === 'lembretes' ? (
            <LembretesArea />
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
              <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
            </div>
          ) : (
            <Canvas layout={layout} onAreaClick={setArea} />
          )}
          </Suspense>
        </div>

      </main>

      {/* Botão flutuante — abre o chat. */}
      {!chatOpen && !(area === 'conversas' && conversationThreadOpen && chatComposerFocused) && (
        <button
          onClick={() => setChatOpen(true)}
          aria-label="Falar com a IA"
          className={cn(
            'absolute z-30 rounded-full flex items-center justify-center border hover:scale-105 active:scale-95 transition-transform',
            area === 'conversas' && conversationThreadOpen
              ? 'bottom-24 right-3 w-11 h-11 md:bottom-6 md:right-6 md:w-14 md:h-14'
              : 'bottom-6 right-6 w-14 h-14',
          )}
          style={{
            background: 'var(--accent-gradient)',
            color: 'var(--on-accent)',
            borderColor: 'var(--glass-border-strong)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 12px 32px -6px var(--accent-glow)',
          }}
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* Chat — overlay independente, NUNCA aninhado dentro da árvore principal
          do app: fica solto aqui no topo pra não virar containing block dos
          vários modais "fixed inset-0" (leads, equipe, lançamentos, locação,
          conversas), que no mobile apareciam espelhados/presos.
          FLIP-LITE (card-turn): abrir/fechar faz um giro de card em perspectiva
          (rotateY + perspective + fade + scale). É SEGURO no mobile porque a face
          que gira (CommandBar) é OPACA (app-bg, sem backdrop-blur) e é UM único
          elemento — sem `preserve-3d` e sem blur na camada animada, então é só um
          transform de GPU barato. Foi o blur de tela cheia + 3D juntos que
          travavam o compositor do Safari/Chrome mobile antes (travava ao abrir e
          às vezes ficava preso ao fechar); aqui nenhum dos dois acontece. Como o
          CommandBar não tem nenhum filho "fixed", o transform daqui não afeta
          modal nenhum do app. A altura usa 100dvh (viewport dinâmico) pra o
          rodapé/input nunca ficarem atrás da barra do Safari no mobile. */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            key="ai-chat"
            initial={{ opacity: 0, rotateY: -90, scale: 0.9 }}
            animate={{ opacity: 1, rotateY: 0, scale: 1 }}
            exit={{ opacity: 0, rotateY: -90, scale: 0.9 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1600, transformOrigin: 'center', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            className="fixed inset-0 z-[100] h-[100dvh]"
          >
            <CommandBar
              persona={persona}
              autonomy={autonomy}
              onNavigate={(a) => { setArea(a); setChatOpen(false); }}
              onActionDone={() => setRefreshKey((k) => k + 1)}
              onClose={() => setChatOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
