# Estado do projeto

## Sentry ativado com privacidade (2026-07-27)

- Integração publicada no commit `4ee40d6`: inicialização central no backend,
  captura de respostas HTTP 5xx e error handler do Express.
- Produção atualizada na release Fly `v185`; três Machines `web` com health
  check passando, `scheduler` e `worker` ativos e segunda worker em standby.
- `SENTRY_DSN` cadastrado como secret da Fly. O valor não é versionado nem
  registrado na documentação.
- Privacidade: `sendDefaultPii: false`, variáveis locais e tracing desativados;
  evento remove usuário, extras, corpo, query, cookies, cabeçalhos, IP,
  breadcrumbs de console e parâmetros/fragmentos de URL.
- Evento artificial `ImobiFlow Sentry validation`, sem dados de clientes, foi
  aceito pelo SDK, visualizado no painel e marcado como resolvido. A consulta
  `is:unresolved` ficou sem resultados depois da resolução, como esperado.

## Etapa 1 do cadastro vira cards de plano (2026-07-27)

- Pedido do usuário com print de referência (pricing estilo Zapier: 3 cards,
  destaque "mais popular", toggle Mensal/Anual) + print da nossa Etapa 1
  atual ("Você é" em lista de radio buttons).
- `src/pages/Signup.tsx`: a lista de `ACCOUNT_TYPES` virou 3 cards de plano —
  preço real via `GET /api/config/plan` (rota pública já existente, mesma
  usada por `PaymentPending.tsx`), checklist de 5 features base + a feature
  extra de WhatsApp por membro da equipe (imobiliária/incorporadora), badge
  "mais popular" no Corretor autônomo, toggle Mensal/Anual decorativo (Anual
  mostra aviso "chega em breve", nunca muda o preço exibido).
- Nenhuma mudança de backend/preço real: os 3 planos cobram o mesmo valor
  hoje — só apresentação. Decisão registrada em DECISIONS.md.
- Primeira versão alargava o card do wizard só na Etapa 1 (`max-w-3xl`) pra
  caber os 3 cards lado a lado; usuário testou no localhost e reportou que o
  salto de largura ao avançar pra Etapa 2 prejudicava a UX. Corrigido:
  largura do card fica constante (`max-w-3xl`) nas 3 etapas, e as Etapas 2/3
  centralizam os campos numa faixa `max-w-md` dentro desse card largo — sem
  outro alargamento condicional.
- Verificado com o usuário rodando `npm run dev` local antes da publicação.
  Em 27/07/2026, a produção também foi validada em `/signup`: os três cards
  exibem o preço fornecido por `/api/config/plan`; no viewport móvel de 360 px
  ficam empilhados, sem overflow horizontal.
- Publicado pelos commits `5431ad1` (versão inicial) e `8aae185` (largura
  constante + documentação), GitHub Actions aprovado e release Fly `v181`
  saudável. Checklist registrado no commit: 32/32 testes, TypeScript, Knip,
  build e `git diff --check`.

## Estado consolidado em 27/07/2026

Esta seção é a fotografia atual. As entradas datadas abaixo são histórico de
implementação e podem citar topologias, modelos ou pendências que eram verdade
naquele dia, mas já foram substituídas.

- Baseline funcional da branch `v2` sincronizado com produção no commit
  `4ee40d6`, release Fly `v185`; o pacote seguinte é exclusivamente
  documental e não altera a aplicação.
- Três `web` ativas e saudáveis, um `scheduler` singleton ativo e um `worker`
  ativo; a segunda Machine de worker está em standby parada.
- Redis Upstash ativo para rate limit distribuído, com PING real, timeouts
  curtos, preferência IPv6 no host Fly/Upstash e fail-open.
- Scheduler executa 11 jobs: aos oito originais somaram-se retenção das filas,
  guardião de webhook e backfill de mídia recebida.
- Conversas recebeu persistência/reprodução de anexos e mídia recebida,
  backfill, autocura de webhook, auto-scroll e várias correções de estabilidade
  do composer/teclado no mobile.
- CRM e menus mobile foram contidos no viewport; temas Dia/Noite estão
  habilitados e receberam correções de contraste e responsividade.
- Vitrines públicas e landing pages de imóveis/lançamentos receberam as
  rodadas mais recentes de apresentação; preços legados têm normalização.
- Hot paths receberam cache/menos round-trips, índices versionados e escala
  horizontal da web. A aplicação da migration
  `20260724_scale_hot_path_indexes.sql` ainda precisa de confirmação manual.
- Agente interno usa `xiaomi/mimo-v2.5`; agente externo do N8N usa, por padrão,
  `google/gemini-2.5-flash`; mídia usa
  `google/gemini-2.5-flash-lite`; texto auxiliar usa `openai/gpt-4o-mini`.
- O painel Admin expõe saúde de filas, Redis, N8N, memória e ações idempotentes
  de intervenção. Redis e Sentry estão ativos.
- Restam QA autenticado multi-tenant, teste de carga em staging, confirmação
  do hardening/deduplicação no N8N e alertas operacionais complementares.

## Redesign da área de Conversas: inbox mobile+desktop (2026-07-23)

- Usuário mostrou 3 screenshots do mobile real: lista e thread empilhadas
  verticalmente (grid `md:grid-cols-[320px_1fr]` colapsava pra 1 coluna sem
  esconder nenhum lado), 3 pills de status redundantes no cabeçalho, "Sem
  fila"/Notas/+Tag soltos, painel de Notas separado abrindo acima das
  mensagens (por isso "aparecia no topo" — não era ordenação errada).
- Antes de implementar: usado EnterPlanMode (não pra "consultar o usuário",
  mas porque é decisão de arquitetura de verdade). Perguntado via
  AskUserQuestion: Kanban literal (arrastar cards, como NegociosArea.tsx) vs
  inbox reorganizado (Zendesk/Intercom/Chatwoot). Usuário escolheu **inbox**
  (recomendado) — conversa recebe mensagem nova a cada poucos segundos,
  arrastar esse tipo de card ao vivo é incomum e mais arriscado no mobile.
- Investigação de backend antes de mexer: `server/routes/conversations.ts`
  tinha bloqueio explícito "ticket encerrado é imutável"; confirmado que a
  checagem seguinte ("outro ticket ativo pro telefone") já é o guarda-corpo
  suficiente, e que `ensureConversationTicket` (conversationTickets.ts) já
  reaproveita ticket ativo — reabertura manual e automática convergem com
  segurança. Confirmado também que a RPC de follow-up não filtra por
  pending/open, só por timers — remover esse toggle da UI não quebra nada.
- Implementado (`src/experience/ConversasArea.tsx` reescrito + 3 linhas em
  `server/routes/conversations.ts`):
  - Mobile: lista OU thread nunca empilhadas (`hidden md:block`/`md:flex`
    condicionados a `selected`) + seta voltar.
  - Menu hambúrguer mobile (Tags + Nova conversa); "Gerenciar tags"→"Tags".
  - "Criar lead"→"Criar CRM"; "Já é lead"→"CRM criado".
  - Cabeçalho da thread sem as 3 pills de status; botão Detalhes + faixa
    "Reabrir" quando encerrado.
  - Modal único "Detalhes do atendimento" (mesmo padrão visual do
    TagsManagerModal) com Responsável/Fila (agora `<select>` nativo, trocando
    3 dropdowns customizados por 2 selects) + Tags + Reabrir.
  - Timeline única mensagens+notas ordenada por `created_at` (merge no
    client, backend intocado).
  - Backend: removido o bloqueio de imutabilidade do status `closed`.
- Verificação extra: testei o `cn()`/`tailwind-merge` do projeto DE VERDADE
  via node (não só lendo o código) pra confirmar que combinar `flex` +
  `hidden md:flex` no mesmo elemento resolve corretamente (mantém a última
  classe conflitante) — resultado confirmado, sem bug de CSS.
- Checklist: tsc limpo, knip ok, build ok, diff --check limpo.
- QA visual ao vivo NÃO rodada (mesma limitação de sempre: backend real
  dispara jobs de produção, vite preview não autentica). Recomendo QA real
  no celular assim que subir — é a mudança de UI mais estrutural da sessão.

## Teste de modelo: xiaomi/mimo-v2.5 no Assistente IA (2026-07-23)

- Usuário pediu pra trocar o modelo do Assistente IA no OpenRouter, "para
  testarmos". Modelo escolhido: `xiaomi/mimo-v2.5` (Xiaomi, omnimodal, 1M
  contexto, $0.105/$0.28 por 1M tokens in/out, é modelo de RACIOCÍNIO — retorna
  campo `reasoning`/`reasoning_details` junto da resposta).
- Antes de trocar: confirmado que o modelo existe no catálogo do OpenRouter
  (não estava na primeira busca por listagem completa, achado via WebSearch)
  e testado ISOLADO (chamada direta à API do OpenRouter, sem tocar
  Supabase/backend — só precisa da `OPENROUTER_API_KEY` do `.env` local):
  - JSON mode (`response_format:"json_object"`) funciona — resposta em JSON
    válido, sem markdown, sem texto fora do JSON.
  - Teste de extração estruturada (`create_lead` com nome/telefone/property_id
    de um pedido em português) devolveu EXATAMENTE os campos esperados, sem
    campo extra — importante porque os schemas zod são `.strict()` (rejeitam
    campo desconhecido).
  - Latência ~2.7s por chamada (mais lento que o `openai/gpt-4o-mini` anterior,
    esperado por ser modelo de raciocínio); custo por chamada de teste:
    ~$0.000045.
- `server/services/agent.ts`: `model: "openai/gpt-4o-mini"` →
  `model: "xiaomi/mimo-v2.5"` (única linha, com comentário explicando a troca
  e por que é seguro testar mesmo sem suporte confirmado a json_object —
  falha de parse já cai num erro tratado em `runAgent`, nunca quebra).
- Checklist: tsc limpo, 8/8 testes, knip ok, build ok, diff --check limpo.
- ⚠️ Sem staging: ao dar deploy, TODOS os corretores que usarem o Assistente
  IA passam a usar esse modelo — não é um teste isolado, é a produção real.
  Reverter é trocar a mesma linha de volta pra `openai/gpt-4o-mini`.

## Flip-lite (card-turn) ao abrir/fechar o Assistente IA (2026-07-23)

- Patch recebido pronto (`imob-cristal-rodadas-2a4.patch`, 3 commits
  bundlados). Partes 1/3 e 2/3 já estavam publicadas (1/3 = commit `bfb30a6`
  do Codex; 2/3 = commit `6d77e24`, a lente de vidro já aplicada nesta sessão)
  — extraída e aplicada só a parte 3/3, nova.
- `ExperienceShell.tsx`: a animação de abrir/fechar o Assistente IA trocou de
  slide+fade (`translateX`) pra um giro de card em perspectiva — "flip-lite"
  (`rotateY -90→0` + `scale 0.9→1` + fade, `transformPerspective:1600`).
- Repete um problema já visto antes (flip 3D que travava o compositor no
  Safari/Chrome mobile, por isso tinha sido trocado por slide) — mas de um
  jeito deliberadamente seguro desta vez: um ÚNICO elemento anima (sem
  `preserve-3d`, sem elemento pai 3D separado do filho), e a face que gira
  (`CommandBar`) é opaca (`app-bg`, comentário explícito "Sem backdrop-blur"
  no próprio arquivo) — sem blur de tela cheia empilhado com o 3D, que era a
  combinação que travava antes. Verificado lendo o código do CommandBar antes
  de aplicar.
- Checklist: tsc limpo, knip ok, build ok, diff --check limpo.
- QA visual real não feita (mesma limitação de sempre: dev server dispara
  jobs de produção, vite preview não autentica); recomendar teste ao vivo no
  celular após o deploy, já que o risco histórico dessa animação é mobile.

## Tooltip honesto no botão de autonomia (2026-07-23)

- Usuário pediu explicação simples dos 3 modos (Piloto automático/Copiloto/
  Manual). Achado ao investigar: desde o hardening contra prompt injection
  (`eb5bd99`, 22/07/2026), os 3 modos SE COMPORTAM IGUAL — toda mutação do
  Assistente IA sempre propõe e espera confirmação, nunca auto-executa (nem
  no Piloto). O rótulo do botão (`ExperienceShell.tsx`) ficou prometendo uma
  diferença que não existe mais.
- Decisão do usuário: manter o comportamento seguro (sempre confirmar), só
  corrigir o texto pra não prometer o que não faz mais.
- `ExperienceShell.tsx`: `title={AUTONOMY_HINT}` no botão — tooltip explica
  que a confirmação é sempre obrigatória nos 3 modos.
- `CommandBar.tsx`: comentário desatualizado corrigido (ainda citava "agente
  Gemini" — já é OpenRouter — e dizia que o Piloto executa na hora).
- Checklist: tsc/knip/build/diff --check limpos.

## Lente de vidro no rail + toggle Dia/Noite (2026-07-23)

- Patch recebido pronto (`imob-cristal-polish-3.patch`, já escrito por Claude
  Opus 4.8 em outra sessão) e aplicado com `git apply` — só identidade visual,
  nenhuma função/rota alterada.
- `ManualRail.tsx`: o indicador do item ativo (rail desktop + drawer mobile)
  deixou de ser a borda/fundo estático `.is-selected` e virou uma LENTE DE
  VIDRO que desliza entre os itens via `layoutId` do Framer Motion (`motion`,
  já era dependência usada em várias telas). Ícone ativo em latão por cima.
- `ThemeToggle.tsx`: o thumb deslizante virou a mesma lente de vidro sobre o
  ícone ativo (sol/lua), em vez do preenchimento sólido em gradiente.
- `index.css`: 2 classes novas, `.cr-glass-lens` (rail) e `.cr-toggle-glass`
  (toggle) — `backdrop-filter: blur + saturate + brightness`, sem filtro de
  deslocamento (evita o "piscar" de outras tentativas de vidro).
- Checklist: tsc limpo, knip ok, build ok, diff --check limpo.
- QA visual: dev server real não rodado (backend dispara WhatsApp de produção
  via jobs de fundo); `vite preview` não autentica (sem backend). Verificado
  em harness estático isolado com os tokens/classes REAIS do `index.css`
  (`getComputedStyle` confirmou `backdrop-filter`/`border-radius`/`z-index`
  aplicando sem conflito de seletor, console sem erros) — não é screenshot
  pixel-a-pixel da tela real, então QA visual final fica pra produção/usuário.

## Assistente IA: link da vitrine + broadcast pra contatos (2026-07-22)

- Problema (mostrado pelo usuário): "envie a minha divulgação pros meus contatos"
  saía errado — 1 contato só, texto "minha área de divulgação" sem sentido, sem
  link. Diagnóstico A/B/C aprovado pelo usuário ("abc").
- **A** — `buildSnapshot` inclui `vitrineUrl` (=`PUBLIC_APP_URL/vitrine/:id`) no
  Snapshot; o assistente passa a conhecer o link real.
- **C** — regra de divulgação no system prompt: pedido de divulgar/compartilhar
  imóveis → mensagem-convite ao cliente COM o link; proíbe "minha área de
  divulgação"/telas internas.
- **B** — nova ação `broadcast_message` (envia pra TODOS os contatos salvos;
  sem phone, destino resolvido no servidor por `broker_id`; trava de 50).
  Confirmável: `runAgent` sobrescreve o `reply` com a contagem REAL + prévia
  (a UI só mostra o reply). Não pausa a IA (senderType "ai", sem
  `pauseAiForHumanTakeover`) — replies seguem atendidos. Registrada em
  `CONFIRMABLE_ACTIONS` e no schema zod (2 uniões) + `JSON_SHAPE_HINT`.
- Arquivos: `server/services/agent.ts`, `server/security/agentGuardrails.ts`,
  `server/routes/agent.ts`, `tests/agentGuardrails.test.ts` (+2 casos).
- Checklist: 8/8 testes, tsc limpo, knip ok, build ok, diff --check limpo.
- Verificação ao vivo NÃO feita (envio real de WhatsApp em produção) — QA fica
  pra depois do deploy, com autonomia=manual/copiloto (ação só proposta).
- Pendente: problema 2 (loop "posso enviar mais detalhes?" no atendimento N8N)
  — fora deste repo.

## Divulgação: prévia ao vivo da vitrine (2026-07-22)

- Pedido do usuário: o card "Ainda não disponível" (portais OLX/ZAP/Viva Real +
  campanha em massa) estava vago demais; tirar e no lugar mostrar uma **prévia
  da landing page com os imóveis disponíveis**.
- `src/experience/DivulgacaoArea.tsx`: removido o card de roadmap; adicionada uma
  prévia ao vivo — `iframe` da própria página pública `/vitrine/:brokerId`,
  enquadrada como janela de navegador (barra com URL + botão Abrir). Como é a
  página REAL, o que o corretor vê é idêntico ao que o cliente vê. Same-origin,
  liberado pela CSP `frameAncestors 'self'` + `X-Frame-Options: SAMEORIGIN`
  (helmet, `server.ts`). Estado vazio quando não há imóvel disponível.
- Checklist: tsc limpo, knip sem apontamentos, build ok, `git diff --check` limpo.
- Verificação visual em browser NÃO rodada localmente (dev server local usa
  Supabase de produção — risco de jobs de fundo dispararem WhatsApp real); QA
  visual fica pra produção após deploy / tela do usuário.

## Sistema de cores "Cristal" + tema Dia/Noite (2026-07-22)

- Pedido do usuário: trocar SÓ as cores do app pra paleta Cristal (grafite frio
  + acento azure->aqua + latao premium) e ter alternancia Dia/Noite. Layout e
  estrutura ficam idênticos — nada de vidro/componentes novos.
- Fundação em `src/index.css`: tokens de cor Noite (`:root`) e Dia
  (`:root[data-theme="light"]`), `.app-bg` (mesh), transição de tema. Toggle:
  `src/lib/theme.ts` + `src/experience/ThemeToggle.tsx` (localStorage, padrão
  Noite), `initTheme()` no `main.tsx`.
- Recolor em massa (só cor, estrutura intacta): neutros `text/bg/border-white/x`
  -> tokens via codemod (1.832 trocas em 33 arquivos); acentos (violet/purple/
  indigo/blue) e semânticos (emerald/green/teal, amber/yellow, red/rose)
  remapeados no `@theme` pros tokens `--accent`/`--accent-2`/`--success`/
  `--warning`/`--danger` (reagem ao tema, zero edição por arquivo); fundo escuro
  `from-slate-900 via-blue-950 to-indigo-900` -> `.app-bg` (19x/14 arquivos).
  `GlassCard` (`ui.tsx`) recolorido cascateia todos os cards.
- Naquele commit, `tsc`/`knip`/`build` ficaram verdes e o toggle ainda estava
  travado em Noite aguardando QA. **Estado atual:** as rodadas seguintes
  concluíram o polimento e habilitaram `THEME_TOGGLE_ENABLED=true`.


## Hardening contra prompt injection publicado (2026-07-22)

- Auditoria encontrou risco indireto no Assistente interno: últimas mensagens
  de clientes eram interpoladas no `system prompt` e mutações podiam ser
  autoexecutadas no modo piloto.
- Novo `server/security/agentGuardrails.ts`: contrato Zod discriminado para 14
  tipos de ação, rejeição de campos extras, limites de tamanho/formato e
  separação do snapshot em `UNTRUSTED_ACCOUNT_CONTEXT`.
- Toda mutação agora retorna proposta para confirmação humana; apenas
  `answer`, `navigate` e `query_agenda` seguem sem confirmação. Fallback de
  autonomia mudou de `piloto` para `copiloto`.
- Suíte ampliada de 8 para 15 testes. Testes, TypeScript, Knip, diff-check e
  build completo passaram numa cópia temporária limpa do commit publicado,
  sem incluir nem alterar os oito arquivos visuais inacabados do Claude.
- Publicado no commit `eb5bd99`; GitHub Actions run `29929111553` aprovado e
  release Fly `v142` saudável. Smoke HTTP 200 nas quatro páginas principais;
  `/api/agent/command` e `/api/agent/execute` responderam 401 sem autenticação.
- N8N não foi acessado ou alterado. Pendente: confirmação server-side por ID
  de uso único, policy gateway do proxy N8N e red-team em staging isolado.

## Escala: testes e scheduler dedicado publicados (2026-07-22)

- Auditoria confirmou a branch `v2` limpa e sincronizada em `853aff0`; os dez
  commits posteriores a `4ffe30e` tiveram GitHub Actions aprovado.
- Migrations `20260721f` e `20260721g` estão aplicadas: todas as cinco colunas
  novas foram confirmadas no schema.
- Baseline de 24h: 8 contas, 4 tickets ativos, 49 mensagens; inbox p95 4.101ms,
  outbox p95 1.371ms, zero `pending`/`processing`/`dead`.
- Criados `server/lib/recurringJobs.ts`, `scheduler-worker.ts`, process group
  `scheduler`, endpoint `/api/health`, suíte Node Test e harness protegido de
  carga. Oito testes aprovados; Fly config validada.
- Smoke local: 1.000 GETs em `/api/health`, concorrência 25, 1.307,94 req/s,
  p95 36,8ms, p99 54,8ms, 100% HTTP 200 e zero erro.
- O scheduler impede execução sobreposta, sobrevive a falha de tick e drena no
  SIGTERM. `server.ts` não registra mais jobs recorrentes.
- Publicado no commit `1b928a7`; GitHub Actions run `29920550228` aprovado e
  release Fly `v140` saudável com `web` (1 GB), `worker` (1 GB) e `scheduler`
  (512 MB). Lint, Knip, build, diff-check e os oito testes passaram.
- Smoke pós-deploy: `/api/health`, `/`, `/login` e `/app` responderam HTTP 200;
  inbox/outbox permaneceram sem `pending`, `processing` ou `dead`.
- A auditoria encontrou uma instância UAZAPI ainda apontada para o ingresso
  legado `appback.criate.online`. Ela foi reapontada e confirmada em
  `https://imobiflow-v2.fly.dev/api/wpp-shim/inbound/:instanceId`, sem acessar
  nem alterar o n8n.
- Gate definido naquela data: criar staging/conta sintética, executar o mix
  autenticado e webhooks sob carga, configurar Redis e só então testar escala
  da web. **Atualização:** Redis foi ativado e a produção passou a três web;
  o teste de carga em staging continua pendente, portanto a capacidade ainda
  não está certificada.

## Feature: notificar corretor quando a IA de atendimento marca visita (2026-07-21)

- Quando o cliente agenda visita conversando com a IA no WhatsApp
  (`POST /api/agenda/n8n/create`), o corretor não estava no loop. Agora é
  avisado por duas vias (escolha do usuário): badge na Agenda dentro do app
  **e** WhatsApp num número pessoal.
- Migration `20260721g_visit_broker_notification.sql` aplicada e verificada:
  `imf_agenda.booked_by_chatbot`, `broker_seen_at`, `whatsapp_notified_at` +
  `imf_brokers.notification_phone` + índice parcial.
- Backend: rota N8N grava `booked_by_chatbot=true`; novo
  `POST /api/agenda/visits/mark-chatbot-seen`; job
  `server/services/visitAlerts.ts` (`runVisitWhatsappAlertTick`, 60s) manda o
  WhatsApp pro `notification_phone` a partir da instância da conta;
  `/api/brokers/me` + `/api/brokers/settings` passam a expor/gravar
  `notification_phone`.
- Frontend: badge no ícone da Agenda (`useNewChatbotVisitCount` em
  `ManualRail.tsx`) que zera ao abrir a Agenda; campo "Número pessoal para
  alertas" em Config → Seu perfil (`ConfigArea.tsx`), com aviso pra usar um
  número diferente do comercial.
- Motivo do número separado: a instância UAZAPI é o número comercial que a IA
  usa com o cliente; um número não notifica a si mesmo de forma confiável.
  Sem `notification_phone`, só o badge in-app aparece.
- Publicado no commit `853aff0`; GitHub Actions run `29871344447` aprovado.

## Melhoria: seletor de data/hora no "Agendar Visita" da landing (2026-07-21)

- Usuário pediu que o campo "Horário de preferência" (antes texto livre) vire
  um calendário com relógio. Trocado por `<input type="datetime-local">` em
  `PropertyLanding.tsx` — calendário + seletor de hora nativos (desktop e
  mobile), com `min` = agora (bloqueia horário no passado). Como
  datetime-local não aceita placeholder, o rótulo "Horário de preferência
  (opcional)" virou label acima do campo.
- O valor (`YYYY-MM-DDTHH:mm`, fuso local do cliente) é formatado pra pt-BR
  ("22/07/2026 às 15:00") antes de ir pra nota do lead. Continua opcional e
  continua NÃO agendando nada em `imf_agenda` — é só a preferência do cliente.
- `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration,
  sem mudança de backend. Não foi possível QA visual ao vivo (browser pane
  indisponível nesta sessão) — comportamento nativo do input, validar após
  deploy.
- Publicado no commit `fdd8f93`; QA visual ainda recomendado.

## Fix: foto falsa de corretor na landing (2026-07-21)

- Print do usuário: a seção "Seu Corretor" mostrava a foto de um homem
  aleatório (placeholder Unsplash hardcoded) como se fosse o corretor
  "hunter" — o fallback disparava sempre que o corretor não tinha foto
  própria configurada no perfil (caso da conta de teste).
- Correção em `PropertyLanding.tsx` (seção + modal "Saiba Mais"): fallback
  virou monograma com a inicial do nome, no estilo da seção; foto real
  (perfil do Dashboard 1.0, `broker_address.photoUrl`) continua aparecendo
  quando configurada.
- `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration.
- Publicado no commit `457418a`; QA visual ainda recomendado.

## Bug: dados cadastrados sumidos da landing page do imóvel (2026-07-21)

- Print do usuário: a landing pública mostrava só título/preço/descrição —
  faixa de specs, tags de característica e mini-stats (quartos, banheiros,
  piscina, varanda gourmet) não apareciam, mesmo com o formulário de edição
  exibindo tudo preenchido.
- Causa: desde a modularização (`8443173`), `GET /api/properties/:slug`
  separa o bloco `---DETALHES-GERADOS---` da descrição no servidor e devolve
  o JSON parseado em `details` — mas `PropertyLanding.tsx` (anterior a isso)
  continuava parseando o bloco de dentro da `description`, que passou a
  chegar limpa → `extraData` ficava `{}` → tudo condicionado a `> 0` sumia.
  A tela de edição não sofria porque `CarteiraArea.tsx` espalha `...details`
  ao abrir o form. Bug latente desde a modularização.
- Correção: landing usa `property.details` como fonte primária; parse
  inline vira fallback pra resposta antiga com o bloco embutido.
- Verificado contra o payload REAL de produção do imóvel do print:
  `details` presente com `quartos:4, banheiros:4, piscina:"Sim",
  varanda_gourmet:"Sim"` e description sem separador — o que também
  confirma que a segunda parte do pedido do usuário ("quando ditado para o
  agente, cada parte deve ser agregada onde compete") JÁ funciona: o
  `create_property` do Assistente IA extraiu os campos estruturados
  corretamente do ditado; o elo quebrado era só a exibição na landing.
- `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration,
  sem mudança de backend.
- Publicado no commit `9a4436f`; QA visual ainda recomendado.

## Bug: microfone abre a galeria no iOS (2026-07-21, resolvido na 2ª tentativa)

- Relatado pelo usuário (iPhone 11): tocar no microfone do Assistente IA
  abria o seletor de foto ("Photo Library / Take Photo / Choose Files") em
  vez de gravar. Falhava ~6 de cada 7 toques.
- **1ª tentativa (publicada em `4c60a45`, hipótese ERRADA):** retenção de
  foco no controle nativo após abrir o seletor → `key={fileInputResetKey}`
  remontando o input após cada uso. Usuário retestou: continuou falhando
  (1 sucesso em 7), inclusive sem foto anexada — a correlação "só com
  foto" do primeiro relato era coincidência. O remount ficou no código
  (inócuo), mas não era a causa.
- **Causa real (geométrica):** o controle nativo do `<input type="file">`
  no iOS tem largura intrínseca (~110px+) que o WebKit não encolhe pra
  caber no wrapper de 32px; sem `overflow-hidden`, o excedente invisível
  (opacity-0) transbordava por cima do mic (8px de gap) — e o input
  posicionado (`absolute`) pinta/recebe toque acima do botão estático.
  O "1 em 7" era o dedo acertando além da borda do transbordo.
- **Correção em `CommandBar.tsx` (duas camadas):** `overflow-hidden` no
  wrapper do clipe (clipa pintura e hit-test nos 32px; comentário ⚠️ no
  código marca como obrigatório) + `relative z-10` no botão de microfone
  (defesa extra: posicionado com z-index fica acima do input mesmo se
  algum engine vazar hit-area). Padrão Android preservado por completo.
- Validado: `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. QA
  no iPhone depende do usuário (não reproduzo iOS nem tenho device aqui).
- Publicado no commit `2383308`; QA em iPhone ainda recomendado. Sem migration.

## Bug: texto repetido nas seções da landing page de imóvel (2026-07-21)

- Usuário mostrou print: a mesma descrição aparecia em TODAS as seções
  ("Sobre o Imóvel", "Detalhes", "Experiência", "Exclusividade") da página
  pública do imóvel. Causa em `src/pages/PropertyLanding.tsx`: o template já
  dividia a descrição em parágrafos (`descParagraphs`, por quebra dupla de
  linha) pra dar um parágrafo diferente a cada seção, mas o fallback
  (`descParagraphs[i] || descParagraphs[0] || cleanDescription`) repetia o
  parágrafo 0 inteiro em TODA seção sem parágrafo próprio — e uma descrição
  ditada por voz pro Assistente IA sai como um bloco só (sem quebra de
  linha), então vira exatamente 1 parágrafo e todas as 5 seções mostravam
  o mesmo texto completo.
- Corrigido: só a seção 0 ("Sobre o Imóvel") cai pra descrição inteira; as
  seções seguintes só mostram texto se tiverem parágrafo PRÓPRIO
  (`descParagraphs[i]`), senão ficam sem parágrafo de corpo (mantêm
  heading/tag e o conteúdo extra que já existia — tags de característica,
  mini-stats, botões de CTA). Sem duplicar texto nunca mais, independente de
  como o imóvel foi cadastrado (voz, texto, formulário).
- Validado simulando a transformação exata com o texto real do print do
  usuário (script isolado, fora do repo): antes, as 5 seções mostravam os
  335 caracteres completos; depois, só a seção 0. Não consegui abrir o
  Browser pane nesta sessão pra verificação visual ao vivo (tabs_create e
  navigate falharam) — parei o dev server que cheguei a levantar
  (`imobiflow-dev`, que rodou uma purge real de `webhook_logs` antigos
  contra a Supabase de produção, efeito colateral esperado do maintenance
  job — nada de errado, só um lembrete de que dev local usa o banco real).
- `npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration,
  sem mudança de backend.
- Publicado no commit `865f592`; confirmação visual real ainda recomendada.

## Bug: horário absoluto em schedule_followup/create_reminder (2026-07-21)

- Usuário pediu "agendar um follow pro Hiago às 16:00" e o sistema agendou
  pra 19:39 — visível no print da aba Lembretes. Causa: `create_reminder`/
  `schedule_followup` só tinham `delay_value`+`delay_unit` (prazo relativo:
  "em 24h", "2 dias"); um horário do relógio não tem pra onde ir nesse
  formato, então o modelo era forçado a inventar um prazo relativo a partir
  da hora — e inventava errado. Mesma categoria do bug de "5 minutos"
  corrigido antes hoje, mas na raiz: ali era um bug de código (unidade
  tratada errado); aqui é uma capacidade que faltava (nenhum jeito de
  expressar hora do relógio).
- Corrigido reaproveitando o par `date`+`time` que `create_visit`/
  `update_visit` já usam (já existe no `AgentAction`/`JSON_SHAPE_HINT`,
  nenhum campo novo): `resolveDueAt` (`server/services/agent.ts`) tenta
  date+time (absoluto) primeiro, cai pro delay_value/delay_unit (relativo)
  se os dois não vierem. Sempre valida que o resultado é no futuro —
  recusa com mensagem honesta se já passou, em vez de arriscar disparar o
  job de 60s na hora.
- Prompt do modelo atualizado pras duas ações explicando quando usar cada
  par (hora do relógio → date+time; prazo/duração → delay_value/
  delay_unit), com a regra explícita de nunca converter uma hora do
  relógio num prazo chutado.
- Durante a implementação, `if (!resolved.ok)` com union discriminada por
  boolean (`{ok:true;...}|{ok:false;...}`) não narrava sob este tsconfig
  (sem `strict`/`strictNullChecks` — confirmado isolando o padrão num
  arquivo à parte). Redesenhado pra um campo nullable simples
  (`{date: Date|null; reason?: ...}`), sem depender de narrowing de union.
- Validado localmente: `npx tsc --noEmit`, `npx knip`, `npm run build`
  aprovados.
- Publicado no commit `060b507`; validar com um novo horário absoluto.

## Dois bugs de UI relatados pelo usuário (2026-07-21)

- **Barra superior sobrepondo no mobile (admin):** print do usuário mostrava
  "Corretor/Admin" e "Piloto automático" sobrepostos no celular. Causa: as
  pílulas "ver como" (Corretor/Imobiliária/Incorporadora) e o botão de
  autonomia ("Piloto automático") não tinham `shrink-0`/`whitespace-nowrap` —
  a barra inteira não cabe nessa largura, então o texto quebrava linha dentro
  dos próprios botões e as duas linhas se sobrepunham. Corrigido em
  `ExperienceShell.tsx`: pílulas de persona ganharam `shrink-0
  whitespace-nowrap` e o container delas `overflow-x-auto` (rola se ainda não
  couber); botão de autonomia esconde o rótulo de texto abaixo de `sm`
  (mostra só bolinha+seta) — sem remover nenhuma função, só reduz o que
  aparece por extenso no celular.
- **Campo de mensagem de uma linha só:** usuário pediu ver o texto inteiro
  depois de escrever ou ditar por voz — hoje só rolava na horizontal.
  `CommandBar.tsx`: trocado `<input>` por `<textarea rows={1}>` que cresce
  com o conteúdo (efeito lendo `scrollHeight`) até `MAX_INPUT_HEIGHT_PX`
  (144px), depois rola por dentro. Enter sozinho continua enviando (igual
  antes); Shift+Enter agora quebra linha. Ditado por voz cai na mesma
  `value`, então também cresce.
- Validado localmente: `npx tsc --noEmit`, `npx knip`, `npm run build`
  aprovados. Confirmação visual real (mobile, admin autenticado) ainda
  depende do usuário — não reproduzo sessão autenticada nem visão de admin
  sem credenciais.
- Publicado no commit `320ad1d`; QA visual mobile ainda recomendado.

## Alerta de lembrete vencido: badge + WhatsApp pro corretor (2026-07-21)

- Usuário pediu duas formas de alertar sobre lembrete vencido: badge visual
  no app e WhatsApp pro próprio corretor. As duas implementadas.
- Badge: `ManualRail.tsx` ganhou `useDueReminderCount` (poll a cada 60s em
  `GET /api/agenda/visits?event_type=lembrete`, já existente) e `RailIcon`
  (badge vermelho sobre o sino quando há lembrete `pendente` com
  `scheduled_at` no passado). Sem rota nova, sem migration. Falha de rede é
  silenciosa — badge é cosmético, não pode travar a navegação. Publicado no
  commit `67aa90d`, run `29857448606` (entrou junto com a limpeza do Codex,
  mesma árvore compartilhada).
- WhatsApp: novo `server/services/reminderAlerts.ts`
  (`runReminderWhatsappAlertTick`, job de 60s registrado em `server.ts`) —
  busca lembrete `pendente` vencido e ainda não alertado
  (`whatsapp_alert_sent_at IS NULL`), manda `sendUazapiText` pro telefone da
  conta (`imf_brokers.phone`/`uazapi_instance_token`) e marca
  `whatsapp_alert_sent_at`. Lock com `try_billing_lock`, mesmo padrão de
  `agentScheduledFollowups.ts`. Adiado até o Codex publicar a limpeza do
  transporte (`67aa90d`) — implementado logo em seguida, já sobre
  `server/services/uazapi.ts`. Migration
  `20260721f_reminder_whatsapp_alert.sql` (coluna nova), aplicada e verificada.
- **Limitação conhecida:** o alerta por WhatsApp sempre usa o número da
  CONTA, nunca a instância própria de um membro em modo "own" — não existe
  telefone do membro salvo no schema.
- Validado localmente: `npx tsc --noEmit`, `npx knip`, `npm run build`
  aprovados. Confirmação visual do badge e teste real do envio ainda
  dependem de sessão autenticada com lembrete vencido de verdade.
- Publicado no commit `30ef784`; QA real de badge + entrega ainda recomendado.

## Limpeza total do transporte antigo publicada (2026-07-21)

- A origem pública agora é exclusivamente `PUBLIC_APP_URL`; o fallback antigo
  foi removido do código e do `.env.example`.
- Removidos endpoints órfãos de compatibilidade e campos antigos expostos por
  broker/admin/assinatura.
- O cliente do provedor foi renomeado para `server/services/uazapi.ts`; as
  conversas ficam em `server/routes/conversations.ts`.
- `source_ticket_id` substitui o identificador antigo em follow-up e billing.
- Migration `20260721e` aplicada manualmente e verificada no schema em
  21/07/2026: é aditiva, cria a RPC exclusiva da V2 e preserva
  função/colunas compartilhadas com a V1. O n8n não foi alterado.
- Guias obsoletos foram retirados da V2 e preservados localmente em
  `work/legacy-archive` fora do repositório.
- Secrets residuais de URL/admin foram removidos do Fly em 21/07/2026. O
  rolling restart terminou com web/worker saudáveis, HTTP 200 e a leitura da
  UAZAPI manteve o webhook habilitado em `imobiflow-v2.fly.dev`.
- Publicada no commit `67aa90d`, GitHub Actions run `29857448606`, release Fly
  v128. Uma web e um worker ativos, health check passando; `/`, `/login` e
  `/app` HTTP 200; inbox/outbox sem itens problemáticos.

## Bug crítico encontrado: CRM/Pipelines fora do ar (2026-07-21)

- Investigado a partir do print do usuário: aba Negócios mostrava "Erro ao
  carregar pipelines." `flyctl logs` (em produção) revelou a causa real:
  `imf_crm_ensure_default_pipeline` (autocura chamada por `GET /api/crm/
  pipelines` antes de listar) tem uma coluna ambígua (42702) — a função
  declara `RETURNS TABLE (pipeline_id UUID, ...)`, e uma consulta no corpo
  referenciava `pipeline_id` sem alias, colidindo com a coluna real de
  `imf_crm_pipeline_stages`.
- Essa consulta é a própria condição de um `IF` (roda sempre, não depende de
  nenhum dado existir): a função falhava em 100% das chamadas, pra qualquer
  broker, desde que `20260720b_crm_security_hardening.sql` foi aplicada
  (20/07/2026). A tela Negócios/CRM ficou fora do ar esse tempo todo sem
  ninguém perceber, porque nunca houve QA autenticado ao vivo dessa tela
  (`DOCUMENTACAO.md` já registrava isso como pendência).
- Correção pronta: `supabase/migrations/20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql`
  — mesma função, só qualifica a referência com o alias `stage` (padrão já
  usado no resto da própria função). Não precisa de deploy: efeito imediato
  assim que a migration rodar no Supabase.
- Auditado o resto do arquivo `20260720b` em busca do mesmo padrão (OUT
  parameter de `RETURNS TABLE` com nome igual a coluna real, referenciado sem
  alias): as outras quatro funções e o trigger usam variáveis `v_`/`p_`
  prefixadas ou já qualificam com alias — bug isolado, só nesta função.
- Migration aplicada e correção publicada no commit `7f25b31`, run
  `29854511196` aprovado. Nenhuma mudança de código TypeScript.

## Fila durável de webhooks publicada (2026-07-21)

- `POST /api/wpp-shim/inbound/:instanceId` não confirma mais antes de guardar
  o evento: autenticação da instância + INSERT na inbox precedem o HTTP 200;
  falha de banco responde 503 para provocar retry da UAZAPI.
- `server/services/inboundWebhookQueue.ts` processa inbox/outbox em batches,
  preserva ordem por conversa, recupera leases após crash, aplica retry com
  backoff e move poison messages para `dead` após o limite de tentativas.
- O payload do N8N foi preservado e ganhou `event_id` estável. Migration:
  `supabase/migrations/20260721b_webhook_inbox_outbox.sql`.
- `npm run lint`, `npm run build` e `git diff --check` aprovados localmente.
- Migration aplicada manualmente e verificada por leitura em 21/07/2026: as
  duas tabelas estão acessíveis pelo backend, vazias e sem itens `dead`.
- Publicado no commit `28de500`; GitHub Actions run `29840243877` aprovou
  TypeScript, Knip, build e deploy Fly. Smoke pós-deploy: `/`, `/login` e
  `/app` HTTP 200; inbox/outbox sem itens `pending`, `processing` ou `dead`.
- Smoke real aprovado em 21/07/2026: inbox `completed` em uma tentativa e
  outbox `completed` cerca de 0,3 s depois, sem erro; eco `fromMe` ignorado e
  zero itens `pending`, `processing` ou `dead`. O incidente anterior era a
  URL da UAZAPI ainda apontada ao backend legado; a instância foi corrigida e
  o usuário confirmou a chegada de uma nova mensagem no V2.
- Continua pendente deduplicar `event_id` no workflow N8N.

## Worker separado publicado (2026-07-21)

- Worker da fila separado da API: `webhook-worker.ts` executa inbox/outbox,
  `server.ts` e o endpoint UAZAPI apenas persistem, e o gatilho em memória foi
  removido. `fly.toml` define `web`/`worker`, associa HTTP somente a `web` e
  concede 30 s para desligamento; o worker para novos ciclos e aguarda o ciclo
  ativo por até 25 s. Sem migration e sem alteração no n8n.
- Validações locais aprovadas: `npm run lint`, `npx knip`, `npm run build`,
  parse do `fly.toml` e `git diff --check`.
- Publicado no commit `e42c765`; GitHub Actions run `29852566289` aprovou
  validação e deploy. Smoke `/`, `/login` e `/app` HTTP 200; filas sem itens
  `pending`, `processing` ou `dead`.
- O primeiro rollout criou duas Machines `web` pela HA padrão do Fly. Como os
  schedulers restantes do Express não podem rodar duplicados com segurança, a
  correção `45b41e0` adicionou `--ha=false` e `flyctl scale count web=1` ao
  workflow. GitHub Actions run `29853031218` aprovado; uma `web` foi removida,
  ficando, naquela release histórica, uma `web` ativa, uma `worker` ativa e a
  standby parada do worker. **Estado atual:** três web, um worker ativo, um
  worker standby e scheduler singleton.
- Smoke final: `/`, `/login` e `/app` HTTP 200; inbox/outbox sem itens
  `pending`, `processing` ou `dead`.

## Aba Lembretes publicada (2026-07-21)

- Nova aba **Lembretes** na experiência V2 (3 personas), separada da Agenda a
  pedido do usuário (evita misturar visita real com lembrete/follow-up
  agendado na mesma tela): `src/experience/LembretesArea.tsx`, registrada em
  `engine.ts`/`ManualRail.tsx`/`ExperienceShell.tsx` e em `AREAS_BY_PERSONA`
  (`server/services/agent.ts`, pra ação `navigate` reconhecer a área nova).
  Lista os `create_reminder` (agora com "Concluir"/apagar, reaproveitando os
  endpoints já existentes `PATCH`/`DELETE /api/agenda/visits/:id`) e os
  `schedule_followup` (novos endpoints `GET`/`DELETE
  /api/agent/scheduled-followups`, com cancelamento só enquanto `pending`).
- Nova coluna `imf_agenda.event_type` (`'visita'|'lembrete'`, default
  `'visita'`) pra separar de vez lembrete de visita real — sem ela, lembrete
  contaminava "Próximas visitas"/"Visitas neste mês" do Assistente IA,
  Relatórios, o KPI do Dashboard 1.0 e a lista que o agente externo de
  WhatsApp usa pra decidir horário ocupado/livre. Todos os 4 consumidores
  ganharam o filtro `.eq('event_type','visita')`; `create_reminder` passou a
  gravar `event_type:'lembrete'` explicitamente; o resto do código (visitas
  manuais, N8N) não precisou mudar por já cair no `DEFAULT`.
- Migration `supabase/migrations/20260721c_agenda_event_type.sql` aplicada e
  coluna `event_type` verificada por leitura no Supabase.
- Validado localmente: `npx tsc --noEmit`, `npx knip` e `npm run build`
  aprovados. `git diff --check` aprovado.
- Publicada nos commits `a023d78` + `0916b8a`; GitHub Actions run
  `29851172091` aprovado.

## Concluído e publicado

- **Lembrete e follow-up agendado do Assistente IA interno** (`create_reminder`/
  `schedule_followup`, `server/services/agent.ts`): publicado nos commits
  `0e3373b`+`0b4f981`; corrigido no mesmo dia um bug real de fuso (unidade
  "minutos" tratada como "horas" no cálculo do prazo — relatado pelo usuário
  ao vivo, "5 minutos" virou "+5 horas") no commit `7a1db57`+`2378cc3`.
  GitHub Actions runs `29837571160` e `29839683334` aprovados; smoke `/`,
  `/login`, `/app` HTTP 200 nas duas rodadas. Migration
  `20260721_agent_scheduled_followups.sql` aplicada e verificada.

- CRM substituiu Leads: Kanban + gerenciamento de pipelines/etapas por broker;
  compatibilidade com `leads.status` preservada. Releases iniciais v94/v95.
- Drag-and-drop migrado para `@dnd-kit/core` e confirmado em Android/iPhone.
- Hardening do CRM aplicado e verificado: RPCs transacionais restritas à
  `service_role`, reorder validado, etapa/pipeline inativo bloqueado, UI de
  membro somente leitura e exclusão integral do broker com CASCADE correto.
- Operações financeiras dos clientes desativadas; locação/financeiro exibem
  apenas registros e valores. Asaas continua apenas para assinatura SaaS.
- Correções mobile confirmadas: áudio iOS, seletor de fotos Android e aviso para
  WebView sem suporte.
- Webhook UAZAPI ganhou self-heal ao reconectar instâncias legadas.
- Inbound privado de PTT e imagem implementado: download UAZAPI, transcrição ou
  visão OpenRouter, persistência textual, deduplicação e fallback. Publicado no
  commit `5d096ef`; GitHub Actions run `29781792572` aprovado; `/`, `/login` e
  `/app` retornaram HTTP 200.
- Assistente interno (`server/services/agent.ts`, ação `send_message`) para de
  narrar a própria ação em mensagens ao cliente ("estou fazendo um
  follow-up..."). Regra explícita + exemplo no prompt; validado com chamada
  real ao modelo em `autonomy=manual` (ação só proposta, nunca enviada).
  Publicado no commit `c372ccc`; smoke `/`, `/login`, `/app` HTTP 200.

## Pacote publicado nesta sessão

- Novo `PROMPT-AGENTE-WHATSAPP.md`: respostas de 1–3 frases, uma pergunta por
  vez, linguagem natural e transparente, catálogo tratado como dado, agenda
  protegida e personalização subordinada às regras do produto.
- `GET /api/brokers/:id/agent` passa a priorizar `imf_brokers.ai_name`, definido
  na tela Assistente IA, com fallback para `broker_agents.agent_name` e
  `Juliana`.
- `ai_name` é validado como texto, normalizado e limitado a 60 caracteres.
- `DOCUMENTACAO.md` e os arquivos PMP foram atualizados.
- Validações locais aprovadas: `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`.
- Nenhuma migration criada. Pacote publicado no commit `069db64`; GitHub
  Actions run `29832355248` aprovado; `/`, `/login` e `/app` retornaram HTTP
  200. O N8N não foi alterado porque a instância exige uma sessão autenticada.

## Pendências de QA

- Confirmar no workflow N8N online Header Auth, credenciais, memória isolada,
  prompt vigente e deduplicação por `event_id`.
- Testar texto, PTT, imagem e documento em conversa privada na topologia atual.
- Confirmar isolamento titular/membro e operações críticas do CRM em produção.
- Validar IA desativada/human takeover e ausência de duplicação/vazamento nos
  logs.
- Executar o plano de carga em staging e confirmar a migration de índices de
  24/07 no Supabase.

## Limitações conhecidas

- A instância N8N exige sessão autenticada com acesso de edição; instalação do
  prompt permanece manual.
- Vídeo, sticker e mídia de grupos continuam fora do processamento do agente;
  documentos suportados podem aparecer como anexo no chat.
- Deploy normal ocorre pelo GitHub Actions; `flyctl` é usado para diagnóstico
  e intervenções operacionais conscientes.
- Testes físicos mobile dependem do usuário.
