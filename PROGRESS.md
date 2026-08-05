# Estado do projeto

## Fix: convidado via as abas Equipe/Desempenho no menu (2026-08-05)

- Usuário testou ao vivo logado como membro convidado (não titular) e
  mandou print: a sidebar mostrava as abas "Equipe" e "Desempenho" iguais
  às do titular. Auditoria confirmou: o rail (`AREAS`/`areasForCapabilities`
  em `engine.ts`) sempre filtrou só por capability da conta (rentals/
  finance/team), nunca por quem está logado — qualquer membro do broker via
  o mesmo menu do titular. O conteúdo das duas telas já era titular-only
  (Desempenho já dava 403 com mensagem própria; Equipe já mostrava só ações
  de admin pra quem é titular) — só a aba em si aparecia indevidamente.
- Fix: `GET /api/brokers/me` (`brokers.ts`) passou a devolver `is_owner`
  (via `isBrokerOwner`, já existente). `ExperienceShell.tsx` guarda em
  estado (`isOwner`) e repassa pra `ManualRail`, que agora filtra
  `equipe`/`desempenho` da lista de áreas quando `!isOwner`
  (`OWNER_ONLY_AREAS` em `ManualRail.tsx`).
- Verificado localmente com sessão real minerada via
  `admin.auth.admin.generateLink` (mesmo padrão das rodadas anteriores) pro
  titular e pro membro convidado de teste: convidado deixou de ver as duas
  abas; titular continua vendo as duas normalmente. `tsc`/`knip`/`build`
  limpos (só os 2 erros pré-existentes de sempre em LocacaoArea/
  LocacaoPanels, não relacionados).
- **Segundo achado, também corrigido**: auditando o resto do menu pra
  responder esse mesmo report, `server/routes/locacao.ts` (24 rotas —
  contratos, inquilinos, cobranças, chaves) não tinha NENHUMA checagem de
  titularidade, só `requireUser` — qualquer membro convidado tinha CRUD
  completo sobre contrato de locação, dado de inquilino (CPF/CNPJ,
  contato) e cobrança, mesmo sem ser titular. Perguntei ao usuário como
  travar — confirmou "só titular acessa" (mesmo padrão da chave Asaas).
  Fix: o `.use("/api/locacao", ...)` no topo do router ganhou mais um
  middleware, depois de `requireAccountCapability("rentals")`, que resolve
  `brokerId` e 403 se `!isBrokerOwner(userId, brokerId)` — cobre as 24
  rotas de uma vez (exceto `/n8n/*`, que já pula pra `rentalAgent.ts` com
  auth própria por token interno, intocado). `locacao` também entrou em
  `OWNER_ONLY_AREAS` no `ManualRail.tsx`, junto com `equipe`/`desempenho`.
  Verificado: `curl` direto contra `/api/locacao/contracts` com sessão real
  do convidado devolve 403; com sessão do titular devolve 200. Na UI,
  titular abre "Aluguéis" normal; convidado nem vê a aba, e a Home dele
  (que chama `/api/locacao/contracts` direto, fora do rail) degrada bem —
  o `.catch(() => [])` já existente vira lista vazia, mesma tela de "ainda
  não há contratos" que já aparecia antes.
- Ajustei `tests/accountCapabilities.test.ts`: o teste de regressão que
  confere o `.use()` de `locacao.ts` esperava `requireAccountCapability
  ("rentals")` fechando o parêntese na hora — quebrou com o middleware
  novo no meio. Relaxei o regex (não exige mais fechamento imediato) e
  somei uma asserção nova conferindo que `isBrokerOwner(userId, brokerId)`
  está no arquivo, pra esse teste também vigiar contra alguém remover essa
  checagem no futuro. `npm test`: 95/96 (o 1 que falha é o CRLF conhecido
  do Windows em `scheduledCardEditing.test.ts`, não relacionado, passa no
  CI/Linux).

## Aba "Desempenho": ver o retorno de cada corretor (2026-08-05)

- Pedido do usuário depois de ver a tela de Equipe no ar: uma aba dedicada
  pra navegar o desempenho de toda a equipe (hoje o drill-down por membro
  só existia clicando um por vez em Equipe, sem visão de conjunto).
- Confirmado com o usuário (2 perguntas diretas): o "ROI" usa só dado que
  já existe hoje (retorno por lead + conversão), sem pedir custo/salário
  cadastrado; e vai ser aba nova no menu, não alteração da tela de Equipe.
- **Backend**: `GET /api/equipe/performance?months=3|6|12` (novo, em
  `equipe.ts`, titular-only — mesmo padrão de `GET /api/equipe/ranking`).
  Por corretor (inclusive suspensos, marcados): leads recebidos no período,
  fechados (cohort separada por `closed_at`, mesmo padrão de
  `relatorios.ts`), taxa de conversão, unidades vendidas e
  `retorno por lead` (R$ vendido ÷ leads recebidos). Ordenado por venda,
  como o ranking já faz. **Não mexe em `GET /api/equipe/ranking`** — outro
  consumidor (o card pequeno dentro de Equipe) continua exatamente igual.
- Pra não duplicar paginação: `collectPages`/`collectForIds`/`reportPeriod`
  saíram de privados pra `export` em `relatorios.ts` e agora são
  importados em `equipe.ts` — zero lógica de paginação nova escrita.
- **Frontend**: aba nova "Desempenho" no menu lateral
  (`src/experience/engine.ts` + `ManualRail.tsx`, ícone `TrendingUp`,
  mesma capability `team` de Equipe/Financeiro/Locação/Lançamentos —
  filtro real do menu é só por capability, o campo `personas` de cada
  item é decorativo, não usado em runtime). Novo componente
  `src/experience/DesempenhoArea.tsx`: lista os corretores ordenados por
  venda com toggle 3/6/12 meses (mesma UX de Relatórios), cada linha
  clicável abre o drill-down daquele corretor em Relatórios (reaproveita
  literalmente o mesmo `onOpenMemberReport`/`setReportMember` já
  conectado pelo ícone de gráfico em Equipe na rodada anterior — zero
  mudança extra em `ExperienceShell.tsx` além de registrar a área nova).
- Achado ao mapear o menu: **não existe nenhum arquivo compartilhado entre
  backend e frontend pra capabilities/áreas** — `AccountCapability` é
  redeclarada à mão em `src/experience/types.ts`, sincronizada manualmente
  com `server/services/accountCapabilities.ts`. Reaproveitei a capability
  `team` já existente, sem criar nova, mas fica registrado como um ponto
  frágil do projeto (fácil dessincronizar ao criar capability nova no
  futuro).
- **Testado localmente**: conta de teste isolada (mesmo padrão da rodada
  anterior), com leads em datas diferentes (dentro/fora da janela de 3
  meses) e uma unidade vendida. 3 asserções via HTTP, todas corretas de
  primeira: 6 meses inclui um lead captado há 4 meses (3 leads, conversão
  33%), 3 meses exclui esse mesmo lead (2 leads, conversão 50%, mesma
  venda), e membro comum recebe 403 ao tentar chamar o endpoint. Dados de
  teste apagados depois. `tsc`/`npm test`/`knip`/`build`/`git diff --check`
  limpos (mesma falha local pré-existente de sempre, CRLF do Windows,
  confirmada que passa no CI/Linux). Aguardando autorização de commit/push.
- Fora de escopo (documentado, não construído): ROI "de verdade" com
  custo/salário cadastrado por corretor — usuário escolheu explicitamente
  a opção sem custo nesta rodada.

## Conta administradora: imobiliária/incorporadora gerencia sua equipe (2026-08-05)

- Pedido do usuário: a conta de imobiliária/incorporadora funcionar como
  **conta administradora** da própria equipe de corretores — controle
  completo sobre a operação deles, sem acesso às funções exclusivas do
  super admin da Criate (`is_admin`, isolado em `admin.ts`, já correto hoje
  e sem nenhuma mudança necessária).
- Auditoria (2 agentes Explore + 1 Plan em paralelo) confirmou que
  hierarquia/reatribuição/suspensão ficaram como "decisão de produto em
  aberto" — documentado em pelo menos 3 comentários no próprio código
  (`equipe.ts`, `EquipeArea.tsx`, `UX_MASTERPLAN.md`). Usuário confirmou (via
  pergunta direta) as 4 lacunas a fechar nesta rodada, todas priorizadas
  igualmente.
- **Migrations**: `20260805b_broker_member_suspension.sql` (`suspended_at`/
  `suspended_by` em `imf_broker_members`); `20260805c_broker_goals_per_member.sql`
  (`user_id` em `imf_broker_goals`, com 2 índices únicos parciais no lugar
  do `UNIQUE(broker_id, month)` original — null = meta da conta, preenchido
  = meta pessoal).
- **Reatribuição de dados** (`GET/POST /api/equipe/members/:userId/
  {data-summary,reassign}`): leads/imóveis/agenda de um corretor nunca
  mudavam de dono sozinhos — ficavam órfãos pra sempre quando alguém saía.
  Segue o padrão SELECT-antes-de-UPDATE já estabelecido em
  `leadBrokerAccess`/`GET /api/leads/recent` pro caso de lead sem
  `property_id` (bug conhecido do supabase-js com `.or()` + `.update()`).
  A origem não precisa mais ser membro atual — dá pra limpar órfãos de quem
  já saiu com o mesmo endpoint.
- **Suspender/reativar** (`PATCH /api/equipe/members/:userId/
  {suspend,reactivate}`): novo gate em `requireUser` (`auth.ts`), cache e
  invalidação próprios (nunca reaproveita o cache de conta, senão a
  mensagem ficaria errada — "contrate um plano" em vez de "suspenso pelo
  administrador"). Suspender desconecta o WhatsApp próprio do membro,
  best-effort; reativar não reconecta sozinho (limitação assumida).
- **Drill-down de relatório** (`GET /api/relatorios/summary?member_user_id=`):
  reaproveita literalmente a mesma query do `scope:"personal"` já existente,
  só trocando qual `user_id` filtra. Bloco de Locação (sem autoria por
  membro) passa a só aparecer na visão de conta, nunca no drill-down de uma
  pessoa — pra não vazar o caixa da empresa inteira como se fosse de um
  corretor só.
- **Meta individual + bug corrigido**: `POST /api/equipe/goal` antes
  aceitava qualquer membro reescrever a meta da CONTA INTEIRA (sem checar
  titularidade) — corrigido; agora sem `user_id` no corpo, titular grava a
  meta da conta e membro comum grava a própria (autoatendimento, sem
  precisar de nenhuma mudança no card "Meta do mês" já existente).
- **Frontend** (`EquipeArea.tsx`, `RelatoriosArea.tsx`, `ExperienceShell.tsx`):
  badge "Suspenso", 4 ícones novos por membro (desempenho, meta, reatribuir,
  suspender/reativar), `ReassignModal` novo, `GoalEditor` parametrizado por
  membro, `handleRemove` avisando contagens órfãs antes de confirmar,
  navegação centralizada (`goToArea`) limpando o drill-down de relatório ao
  sair da tela.
- **Testado localmente (não em produção)**: conta de teste isolada criada
  via API (2 usuários reais, sessão minerada por magic-link já que
  sign-in por senha via chave anônima falhou nesta máquina — chave de
  serviço não é afetada), com leads/imóvel/evento de agenda de teste.
  18+ asserções via HTTP contra o servidor local, todas passaram na
  primeira tentativa: contagens de reatribuição batendo (inclusive lead
  sem `property_id`), rejeição de destino suspenso, bug da meta confirmado
  corrigido (membro não altera mais a meta da conta), bloqueio imediato ao
  suspender (mensagem própria, não a de plano) e liberação imediata ao
  reativar (sem esperar o TTL de 60s do cache). Dados de teste (2 contas
  auth, 1 broker, leads/imóvel/agenda/metas) totalmente apagados depois.
  `tsc`/`npm test`/`knip`/`build`/`git diff --check` limpos (mesma falha
  local pré-existente de sempre em `scheduledCardEditing.test.ts`, CRLF do
  Windows, confirmada que passa no CI/Linux). Aguardando autorização de
  commit/push.
- Fora de escopo desta rodada (documentado, não construído): sistema
  paralelo `corretora.ts`/`CorretoraSettings.tsx` (agrupamento por CNPJ de
  contas independentes — usuário não reconheceu o conceito, "não sei o que
  é isso"; fica pendente confirmar com quem construiu antes de mexer).

## CRM automático no agente de vendas do WhatsApp (2026-08-05)

- Auditoria pedida pelo usuário ("Verificações e Funcionalidades da IA")
  encontrou que o agente externo de vendas (n8n, persona configurável)
  qualificava o cliente e agendava visitas de verdade, mas nunca tocava o
  CRM — zero menção a lead/pipeline no system prompt (confirmado lendo o
  prompt completo, 8773 caracteres, via API do n8n).
- Novo `server/routes/crmSalesAgent.ts`: `POST /api/crm/n8n/sync-lead`
  (`requireInternalToken`), mesmo princípio do agente de locação ("a IA
  conversa, o backend decide"). Cria/atualiza lead por telefone (mesmo
  dedupe de `create-lead` em `conversations.ts`), valida posse de
  `property_id` antes de aceitar (nunca confia no que o modelo manda),
  guarda a qualificação em `leads.notes` (sobrescreve com o resumo mais
  recente, sem migration nova).
- Nova `advanceLeadToVisitStage` em `crmPipelines.ts`, pendurada em
  `POST /api/agenda/n8n/create` (`agenda.ts`): quando uma visita é
  agendada de verdade pelo agente, o lead avança sozinho pra etapa
  "Visita" do pipeline (casada por nome, nunca anda pra trás nem pula
  won/lost) — automático, sem depender do modelo lembrar. Zero mudança no
  workflow do n8n necessária pra essa parte.
- Testado ao vivo contra o banco real (`npm run dev` local + curl +
  consulta direta via Supabase, dados de teste sintéticos removidos
  depois): criação de lead, dedupe/atualização, rejeição de `property_id`
  de outro corretor, e avanço automático pra "Visita" — todos confirmados
  funcionando.
- Falta a ferramenta nova no n8n (`sincronizar_lead`, chamando o endpoint
  acima) e o trecho novo no system prompt do "Agente IA Corretor1" —
  entregue pronto pro usuário colar, sem editar o workflow de produção
  direto pela API (é o agente que atende cliente real agora mesmo).
- Fora de escopo desta rodada (documentado, não construído): mover pra
  "Proposta"/"Fechado" automaticamente, qualificação estruturada (JSONB),
  tags/scoring automático de lead, e qualquer coisa no agente de locação
  (já tem sistema próprio).
- Checklist: `npm test` (95/96 — a 1 falha é `scheduledCardEditing.test.ts`,
  pré-existente, artefato de CRLF local no Windows, confirmado que passa
  no CI/Linux), `tsc`/`knip`/`build`/`git diff --check` limpos.
- **Deploy e teste ao vivo (05/08/2026, mesmo dia):** commit `4852c8f` em
  produção. Node `sincronizar_lead1` criado manualmente no n8n (o paste de
  JSON não funcionou nesse ambiente) e conectado como `ai_tool`; faltava um
  gatilho explícito no prompt (a lista de ferramentas descrevia a tool mas
  não mandava chamá-la em nenhum passo — diferente de `agendamento`/
  `verificacao`, que têm seção própria com passos numerados). Adicionada a
  seção "SINCRONIZAÇÃO COM O CRM" no system prompt do "Agente IA Corretor"
  com o gatilho explícito.
- Teste real (telefone "Marcos") caiu num dedupe por telefone com um lead
  antigo já Fechado ("leon") que tinha o mesmo número normalizado — dedupe
  funcionando corretamente, só confundiu o teste. Segundo teste com
  telefone novo ("Ryan") confirmou criação de lead limpa em "Novo".
- **Bug real encontrado nesse teste:** `$fromAI` de 4 argumentos (com valor
  padrão, usado em `property_id` e `qualification_note` pra ficarem
  opcionais) vaza um `"="` literal na frente do valor resolvido quando a IA
  fornece um valor de verdade — `client_name`, que usa `$fromAI` de 3
  argumentos sem padrão, nunca apresentou o problema. Sem correção, um
  `property_id` vindo sujo nunca bateria com `imf_properties.id`, quebrando
  o vínculo do imóvel silenciosamente. Corrigido com sanitização defensiva
  no backend (`cleanAiString` em `crmSalesAgent.ts`, remove `=` à esquerda
  de todos os campos vindos do n8n antes de usar) em vez de depender do
  node ficar "certo" no n8n. Testado localmente simulando o payload sujo
  (`property_id`/`qualification_note` com `=` na frente): saiu limpo no
  banco. Checklist completo (`tsc`/`npm test`/`knip`/`build`/
  `git diff --check`) limpo de novo. Commit `6d81d25` em produção.
- **Validação final ao vivo (05/08/2026):** reset da conversa "Ryan" +
  nova mensagem + aceite de visita real. Confirmado no banco: nota da
  qualificação saiu limpa (sem `=`), e a etapa do lead avançou sozinha
  de "Novo" pra "Visita" no exato momento em que a visita foi criada via
  `POST /api/agenda/n8n/create` — sem nenhuma ação manual no CRM. Rollout
  desta rodada considerado concluído. Pendência secundária identificada:
  a IA nunca chegou a passar `imovel_id` pro `sincronizar_lead1` em
  nenhum teste, mesmo sabendo qual imóvel era (apareceu no título da
  visita) — lead não fica com `property_id` vinculado. Não bloqueia nada
  (lead cria/atualiza/avança normalmente), registrado como pendência em
  `NEXT_TASK.md` pra investigar depois.

## Confirmação de WhatsApp adicional no convite (2026-08-04, publicada)

- Em plano pago, quando todas as vagas próprias estão usadas ou reservadas, o
  modal oferece mais uma por `MEMBER_WHATSAPP_SLOT_PRICE`, mostra o novo total e
  exige confirmação antes de alterar a assinatura.
- A migration `20260804c_team_invite_slot_upgrade.sql` torna atômicos o aumento
  de `member_limit` e a criação do convite; se o convite falhar, nada é cobrado.
- `request_id` idempotente impede duplicação de convite/vaga em duplo clique ou
  retry após perda de conexão.
- Em experimentação não existe compra: o modal informa o limite do voucher e
  oferece convite com WhatsApp compartilhado.
- Validação local concluída: 86/86 testes, TypeScript, Knip, build de produção e
  `git diff --check` aprovados.
- A migration foi aplicada manualmente no Supabase antes desta entrega. O código
  dependente foi incluído na mesma publicação da `v2`; resta o smoke autenticado
  com uma conta paga descartável.

## Cota de WhatsApp próprio nos vouchers (2026-08-04, publicada)

- O Admin passa a definir separadamente quantos corretores adicionais podem ser
  convidados e quantos deles poderão conectar WhatsApp próprio. O titular não
  consome essa cota.
- A migration aditiva `20260804b_trial_voucher_whatsapp.sql` cria
  `whatsapp_member_limit` no voucher e `trial_whatsapp_member_limit` na conta,
  além de substituir as RPCs de emissão/aceite por versões com lock e reserva de
  vagas para convites pendentes.
- Durante o teste, a cota não pode ser alterada pelo titular nem gera cobrança.
  Ao migrar para plano pago, o checkout exige no mínimo os slots já em uso.
- Validação local concluída: 85/85 testes, TypeScript, Knip, build de produção e
  `git diff --check` aprovados.
- A migration foi aplicada manualmente no Supabase e o código foi publicado no
  commit `d0a5ac2`. O GitHub Actions run `30913606899` aprovou os testes e o
  deploy. Smoke público pós-deploy confirmou `/api/health` HTTP 200 e voucher
  inexistente HTTP 404. Resta o smoke autenticado com vouchers descartáveis.

## Vouchers administrativos de experimentação (2026-08-04)

- Implementação publicada para corretor, imobiliária e incorporadora no commit
  `39d92ba` em 04/08/2026.
- Admin define expiração do convite, 1–180 dias de teste e até 100 corretores
  adicionais; voucher pode ser cancelado e possui histórico de status.
- Cadastro por link não cobra, ativa o plano interno `experimentacao` e fixa a
  modalidade escolhida pelo admin.
- Código armazenado somente como hash; resgate, perfil e membership são
  atômicos; falha remove o usuário Auth recém-criado.
- Expiração bloqueia frontend e APIs autenticadas, preservando apenas os
  endpoints necessários para contratar um plano.
- Limite de equipe é protegido no banco na emissão e no aceite do convite.
- Validação local e no GitHub Actions: 84/84 testes, TypeScript, Knip, build de
  produção e `git diff --check` aprovados. A migration
  `20260804_trial_vouchers.sql` foi aplicada manualmente no Supabase antes do
  deploy. Smoke pós-deploy confirmou `/api/health` HTTP 200, página pública do
  convite HTTP 200, código inexistente HTTP 404 e rota Admin HTTP 401 sem
  sessão. O smoke autenticado de criação/cancelamento ainda requer uma sessão
  Admin no navegador.
- O deploy atualizou e deixou saudáveis as quatro Machines existentes (duas
  `web`, um `worker` e um `scheduler`). A Fly não reservou CPUs em `gru` para a
  capacidade alvo de três `web` e dois `worker`; o workflow passou a tratar a
  escala como melhor esforço com warning e repete a tentativa em cada deploy.

## Funções combináveis por conta (2026-08-03)

- Mantido `account_type` como tipo principal e adicionada a camada de
  capabilities `rentals`, `developments`, `finance` e `team`.
- A conta conserva os módulos históricos quando não possui override; o admin
  agora pode combinar, por exemplo, Locação e Lançamentos na mesma operação.
- Migration criada: `20260803_account_capability_overrides.sql`, com RLS,
  acesso exclusivo da `service_role` e RPC atômica para substituir o conjunto.
- `GET /api/brokers/me`, rail, rotas especializadas e Assistente IA usam as
  permissões efetivas. O backend ignora a persona enviada pelo navegador para
  usuários comuns e revalida ações de locação/lançamentos na confirmação.
- Painel Admin ganhou seleção das funcionalidades e informa quando a migration
  manual ainda não foi aplicada.
- Validação local desta rodada aprovada: 60/60 testes, TypeScript, Knip,
  build de produção e `git diff --check` sem erros.
- Migration aplicada manualmente no Supabase em 03/08/2026 e código publicado
  no commit `5dd570d`. O GitHub Actions run `30849756989` aprovou validação e
  deploy; smoke pós-deploy confirmou `/api/health` HTTP 200 e tela de login sem
  erros no console.
- Hotfix do rollout: os guards de capability dos routers foram limitados aos
  respectivos prefixos `/api/locacao`, `/api/lancamentos`, `/api/financeiro` e
  `/api/equipe`. Isso impede que uma sessão ausente/expirada intercepte `/` ou
  `/login`; o teste de regressão exige explicitamente os quatro prefixos.

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
