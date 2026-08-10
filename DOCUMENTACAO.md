# ImobiFlow V2 — referência atual do projeto

> Estado consolidado do código da branch `v2` em 2026-08-10.
>
> Este arquivo descreve somente como o sistema está estruturado e o que é
> verdade agora. Guias de integrações desativadas não fazem parte da V2.
> Entradas com data/release antiga registram a evolução histórica; quando
> houver divergência, prevalecem o estado de produção abaixo e as seções
> arquiteturais atuais.

### Piloto financeiro sandbox (preparado em 2026-08-10)

O deploy V2 habilita o módulo financeiro de clientes em modo de homologação,
com `CLIENT_FINANCIAL_OPERATIONS_ENABLED=true` no runtime e a flag Vite
equivalente no build. A trava adicional
`CLIENT_FINANCIAL_SANDBOX_ONLY=true` aceita somente a chave Asaas sandbox da
própria conta cliente. Produção é recusada nas rotas, no resolvedor de
credenciais e no scheduler. Geração, régua e contrato continuam desligados por
padrão e exigem ativação explícita em três níveis.

Antes de emitir aluguel ou sinal de reserva, o backend lista os webhooks da
conta Asaas própria e cria/atualiza a URL
`PUBLIC_APP_URL/api/webhooks/asaas`, usando `ASAAS_WEBHOOK_TOKEN` e apenas os
eventos financeiros necessários. Se o token tiver menos de 32 caracteres ou o
Asaas não confirmar a configuração, a emissão é bloqueada antes da criação da
cobrança. Essa etapa permite homologar também a conciliação do pagamento.
O endpoint sandbox segue a URL oficial atual
`https://api-sandbox.asaas.com/v3` e envia `User-Agent` próprio da integração.

### Controle híbrido de pagamento de aluguel

A competência mensal possui dois modos compatíveis:

- **Asaas:** o webhook continua sendo a confirmação principal e o scheduler
  consulta cobranças pendentes/atrasadas a cada 10 minutos para recuperar
  eventos perdidos. `RECEIVED`, `CONFIRMED` e `RECEIVED_IN_CASH` dão baixa,
  registram a origem Asaas e interrompem a régua porque a competência deixa de
  estar pendente/atrasada.
- **Externo/manual:** o usuário cria a competência, importa um boleto PDF no
  bucket privado `imf-rental-bills`, envia a cobrança pelo WhatsApp e acompanha
  o recebimento. O boleto é entregue por URL assinada temporária; o arquivo não
  é público. Esse modo não exige chave Asaas.

No **Controle mensal**, `Marcar pago` dá baixa manual auditável e interrompe os
próximos follow-ups. `Marcar não pago` reabre como pendente/atrasado e torna a
competência novamente elegível, desde que as chaves globais da régua e o piloto
do contrato estejam ligados. Uma confirmação posterior do Asaas sempre vence
o override manual e limpa a marca manual. Uma baixa externa que possui recibos
não pode ser reaberta diretamente, porque isso exigiria estornar o histórico.

O envio manual exige confirmação na interface, contrato ativo, telefone
válido, boleto ou PIX e tem limite de cinco envios por usuário a cada 15
minutos. A migration aditiva obrigatória é
`supabase/migrations/20260810b_rental_payment_control.sql`; ela adiciona os
campos de auditoria/conciliação, o índice parcial e o bucket privado.
Foi aplicada e verificada em produção em 10/08/2026: 8 colunas encontradas,
bucket privado presente e índice de conciliação ativo.

### Controle de retirada e devolução de chaves

Na aba **Aluguéis → Para alugar**, cada imóvel disponível mostra somente a
posse atual da chave. A retirada exige nome, telefone brasileiro válido quando
informado, finalidade e uma previsão futura de devolução. O cartão diferencia
explicitamente os estados **Em posse** e **Em atraso**; a devolução é uma ação
separada, chamada **Registrar devolução**, e exige confirmação para evitar que
um clique seja confundido com a leitura de um status.

O formulário de entrega usa um modal responsivo: pessoa e telefone ficam em
duas colunas somente quando há largura suficiente, a finalidade é escolhida em
botões próprios (sem o menu nativo do navegador), e a previsão de devolução
ocupa uma linha exclusiva. Em telas estreitas, todos os campos e ações empilham
sem sobreposição.

O botão de histórico preserva e exibe todas as retiradas e devoluções do
imóvel, inclusive quem levou, finalidade, telefone, horários previstos e reais.
O indicador **Visitas feitas** contabiliza as retiradas com finalidade
**Visita** cuja devolução já foi registrada; **Visitas marcadas**, no resumo da
aba, continua mostrando separadamente os compromissos futuros não cancelados da
Agenda. Essa separação evita tratar uma reserva futura como visita realizada.
O scheduler verifica chaves vencidas a cada 15 minutos e envia um único alerta
ao telefone de notificação do responsável. A API mantém no máximo uma retirada
em aberto por imóvel e nunca esconde falhas de leitura como uma lista vazia.

A migration original `20260804_rental_autopilot.sql` está aplicada e a tabela
foi verificada em 10/08/2026. O hardening incremental obrigatório
`20260810d_property_keys_hardening.sql` ativa RLS, revoga acesso direto do
navegador e impõe integridade para novos registros sem alterar o histórico
legado. Foi aplicado e verificado em produção em 10/08/2026: o backend com
`service_role` continuou acessando os 7 registros existentes e uma consulta
direta com a chave pública do navegador passou a ser recusada com HTTP 401.

## 1. Produto, escopo e ambientes

O ImobiFlow é uma plataforma imobiliária multi-tenant com três experiências no
mesmo produto:

- **Corretor:** operação individual de carteira, leads, conversas e agenda.
- **Imobiliária:** operação de equipe, locação, financeiro e cobrança própria.
- **Incorporadora:** operação de equipe, lançamentos, reservas, documentos e
  financeiro.

Ambientes que não devem ser confundidos:

| Ambiente | Endereço | Papel |
| --- | --- | --- |
| V2 | `https://imobiflow-v2.fly.dev/app` | produto que substituirá a V1 |
| Dashboard 1.0 dentro da V2 | `https://imobiflow-v2.fly.dev/` | interface legada ainda roteada e suportada |
| V1 | `https://imobiflow.fly.dev/` | aplicação anterior; não alterar durante trabalhos na V2 |

A branch de trabalho e publicação da V2 é `v2`. A branch `main` e o app Fly
`imobiflow` pertencem à V1 e ficam fora do escopo.

### Estado conhecido de produção

O deploy é publicado automaticamente pelo workflow `deploy-v2.yml` a partir
do HEAD da branch `v2`. O baseline funcional auditado e publicado em
10/08/2026 está no commit `31c2b93`, GitHub Actions run `#139`, imagem Fly
`deployment-01KZNWFBXDY55ZP94QF33TJV3K`, região `gru`. Os jobs **Validate V2**
e **Deploy imobiflow-v2** concluíram com sucesso; as seis Machines atualizadas
atingiram estado saudável e `/`, `/login` e `/app` responderam HTTP 200 após o
rollout.

A topologia observada possui três Machines `web` iniciadas e saudáveis, uma
Machine `scheduler` iniciada e o grupo `worker` com uma Machine ativa e uma
standby parada. A segunda worker fornece failover de host, não throughput
adicional enquanto parada. Redis Upstash e Sentry estão ativos. O painel Admin
confirma saúde de filas, N8N e Redis e oferece intervenções idempotentes.

Desde 20/07/2026, **todo `git push origin v2` publica automaticamente** em
`imobiflow-v2.fly.dev` via GitHub Actions (`.github/workflows/deploy-v2.yml`,
gatilho `push`, secret `FLY_API_TOKEN_V2` — separado do `FLY_API_TOKEN` da
v1). Não existe mais um passo manual de deploy nem uma revisão entre commit
e publicação: `npx tsc --noEmit`/`npm run build`/`git diff --check` precisam
rodar **antes** do commit, não depois. Motivo da mudança: o `flyctl` local
pode ficar bloqueado por política de Application Control (Smart App Control)
do Windows — o CI builda e publica 100% nos runners do GitHub, sem depender
de nada local.

O produto está funcional, mas **não deve ser declarado 100% pronto para
lançamento** enquanto QA multi-tenant, carga em staging, hardening do N8N e os
itens da seção 15 não forem concluídos. A quantidade atual de Machines não é,
por si só, certificação de capacidade.

## 2. Arquitetura atual

```text
Navegador
  React 19 + React Router + Tailwind CSS 4 + Vite
       │ HTTPS / JSON
       ▼
Fly.io / Node.js em três process groups
  web: Express, autenticação, domínio e SPA estática
  worker: inbox/outbox e processamento de mídia
  scheduler: jobs periódicos singleton
       │ service_role somente no backend
       ▼
Supabase
  Auth + PostgreSQL + Storage privado
       │
       ├── UAZAPI ── WhatsApp por conta/membro
       ├── N8N ───── automação e agente
       ├── OpenRouter/proxy LLM
       ├── Asaas ─── assinatura SaaS; integrações financeiras de clientes ficam desligadas
       ├── Redis ─── rate limit distribuído (ativo)
       └── Sentry ── erros sanitizados, sem PII/tracing (ativo)
```

### Stack

- frontend: React 19, React Router 7, Tailwind CSS 4, Motion e Lucide;
- build/dev: Vite 6, TypeScript 5.8 e `tsx`;
- backend: Express 4, Zod, Helmet e `express-rate-limit`;
- dados/autenticação: Supabase Auth, PostgreSQL e Supabase Storage;
- infraestrutura: Redis/ioredis e Sentry ativos; Sentry restrito a erros
  sanitizados, sem PII e sem tracing;
- produção: container Docker no Fly.io; HTTP na porta interna 3000 apenas no
  process group `web`.

### Entradas e organização

| Caminho | Responsabilidade |
| --- | --- |
| `server.ts` | bootstrap Express, headers, routers e entrega do SPA; não registra jobs |
| `webhook-worker.ts` | processamento independente de inbox/outbox e mídia |
| `scheduler-worker.ts` | 11 jobs periódicos singleton |
| `server/config.ts` | leitura centralizada das variáveis de ambiente |
| `server/middleware/auth.ts` | JWT, tenant e distinção titular/membro |
| `server/routes/` | endpoints separados por domínio |
| `server/services/` | billing, WhatsApp, IA, reservas, jobs e integrações |
| `src/App.tsx` | rotas públicas, privadas, Dashboard 1.0 e cockpit V2 |
| `src/experience/` | shell e áreas manuais da experiência V2 |
| `src/pages/Dashboard.tsx` | Dashboard 1.0; continua vivo na rota `/` |
| `supabase/migrations/` | evolução versionada do schema compartilhado |
| `fly.toml` / `Dockerfile` | execução e publicação da V2 no Fly |

## 3. Convenções obrigatórias

- Novas tabelas do ImobiFlow devem usar o prefixo `imf_`, pois o projeto
  Supabase é compartilhado. Existem tabelas históricas sem esse prefixo, como
  `leads` e `followup_conversations`; isso não autoriza criar novas exceções.
- Valores monetários persistidos usam centavos inteiros (`*_cents`). Conversão
  para reais pertence à apresentação ou à borda da integração.
- Datas persistidas usam ISO/UTC. Regras de calendário de Relatórios usam
  `America/Sao_Paulo` explicitamente.
- A identidade vem exclusivamente do JWT Supabase validado. Nunca confiar em
  `x-user-id`, IDs recebidos do frontend ou parâmetros de tenant sem conferir
  posse no backend.
- Toda consulta autenticada deve começar pelo `brokerId` resolvido pelo
  backend e aplicar o escopo de titular/membro apropriado.
- Segredos ficam apenas no ambiente ou criptografados. Nunca colocar
  `service_role`, tokens UAZAPI, chaves Asaas/OpenRouter ou `.env` real no Git.
- Migrations não são executadas automaticamente pelo deploy. Aplicar e
  verificar o SQL antes de publicar código que dependa do novo schema.
- A V1, o Dashboard 1.0 e migrations antigas não são alvos de limpeza
  automática. Remoção exige decisão de produto e QA específico.

## 4. Autenticação, contas e isolamento multi-tenant

### Vouchers de experimentação (publicado em 04/08/2026)

O painel Admin possui uma área exclusiva para gerar vouchers de uso único nas
modalidades `corretor`, `imobiliaria` e `incorporadora`. O administrador define
a validade do convite, a duração do teste e, para contas com equipe, quantos
corretores podem ser convidados além do titular. O link aponta para
`/experimentacao/:voucherCode`; o cadastro fixa a modalidade concedida e não
passa pelo checkout.

A extensão `20260804b_trial_voucher_whatsapp.sql`, aplicada no Supabase e
publicada no commit `d0a5ac2` em 04/08/2026, separa duas cotas: `member_limit`
no voucher é o total de corretores adicionais; `whatsapp_member_limit` é quantos
desses convidados poderão ter instância própria. O titular mantém a instância
principal e não consome essa segunda cota. Para corretor autônomo, ambas
permanecem zero.

A migration `20260804_trial_vouchers.sql` cria `imf_trial_vouchers` e os campos
de auditoria do teste em `imf_brokers`. O código completo nunca é persistido:
o banco guarda SHA-256 e uma dica parcial, e o Admin recebe o segredo uma única
vez na criação. O resgate bloqueia a linha com `FOR UPDATE` e cria perfil,
membership do titular e consumo do voucher na mesma transação. RLS e grants
impedem acesso por `anon`/`authenticated`; somente a `service_role` executa as
RPCs.

Durante o teste, a conta usa `plan='experimentacao'`, `status='ativo'` e
`trial_ends_at`. Ao vencer, `/api/subscription` e o middleware autenticado
mudam a conta para `inativo`; somente consulta de assinatura, checkout,
leitura mínima do perfil e aceite de termos continuam disponíveis, permitindo
contratar um plano. A cota da equipe é validada na emissão e no aceite dos
convites por RPCs serializadas, evitando ultrapassagem por requisições
simultâneas.

Com a extensão de WhatsApp, o resgate copia a segunda cota para
`imf_brokers.trial_whatsapp_member_limit`; o campo pago
`imf_brokers.member_limit` permanece zero durante a experimentação. Convites
`own` pendentes reservam slot, e as RPCs revalidam a cota na emissão e no aceite
sob lock da conta. A API e o frontend oferecem mensagens amigáveis, mas o banco
é a autoridade final. O titular não pode aumentar essa cota em Config durante o
teste. Na contratação posterior, o checkout recusa uma quantidade paga menor
que o total de membros que já usa WhatsApp próprio.

A migration foi aplicada manualmente no Supabase em 04/08/2026, antes da
publicação do commit `39d92ba`, conforme a ordem obrigatória de rollout. O
smoke público confirmou saúde, rota da página, consulta de voucher e proteção
da API Admin; criação, cancelamento e resgate ainda devem ser exercitados com
uma sessão Admin e contas descartáveis.

### Contratação de WhatsApp próprio durante o convite

Em plano pago, quando todos os slots próprios estão usados ou reservados, a API
de convite responde com `WHATSAPP_SLOT_CONFIRMATION_REQUIRED`, preço unitário,
próximo limite e novo total mensal. O modal não altera nada nessa primeira
resposta: o titular pode voltar, convidar com WhatsApp compartilhado ou confirmar
explicitamente a vaga adicional.

A migration `20260804c_team_invite_slot_upgrade.sql` amplia
`imf_create_broker_invite` para receber a confirmação. Sob o mesmo `FOR UPDATE`
da conta, a RPC aumenta `imf_brokers.member_limit` e insere o convite; qualquer
falha reverte os dois efeitos. O servidor, e não o navegador, define preço e
teto. A liberação é imediata e a sincronização com o valor da assinatura ocorre
no próximo ciclo pelo mecanismo de billing já existente.

Cada modal gera um `request_id` UUID. A tabela de convites mantém unicidade por
conta e a RPC devolve o registro original quando a solicitação é repetida. Isso
torna duplo clique e retry após perda de resposta seguros, sem nova vaga ou novo
convite.

Contas `plan='experimentacao'` nunca entram nesse fluxo pago: continuam presas
à `trial_whatsapp_member_limit` concedida pelo voucher e recebem como alternativa
o convite compartilhado. A migration foi aplicada manualmente antes da
publicação do código dependente em 04/08/2026.

### Modelo de conta

- `imf_brokers` representa a conta/tenant e guarda o titular em `user_id`.
- `imf_broker_members` vincula usuários da equipe ao `broker_id`. Contas
  antigas são autocuradas pelo `getBrokerId`, que cria a membership do titular.
- `account_type` fixa a persona da conta em `corretor`, `imobiliaria` ou
  `incorporadora`. Um administrador pode alternar visualmente entre personas
  para QA, sem mudar a natureza dos dados da conta.
- `is_admin` libera o painel administrativo global; isso é diferente de ser o
  titular de uma conta.

### Titular como administrador da equipe (2026-08-05)

O titular de uma conta imobiliária/incorporadora administra sua própria
equipe de corretores, sem nenhum acesso às rotas exclusivas de `is_admin`
(`server/routes/admin.ts` continua 100% isolado, nenhuma mudança nesta
rodada). Além de convidar/remover membros (já existente), o titular agora
pode:

- **Reatribuir dados** (`GET/POST /api/equipe/members/:userId/
  {data-summary,reassign}`): move `owner_user_id` de leads, imóveis e
  eventos de agenda de um corretor pra outro membro ativo. A origem não
  precisa ser membro atual — serve tanto pra redistribuir carga quanto pra
  limpar dados órfãos de quem já saiu da equipe.
- **Suspender/reativar** (`PATCH /api/equipe/members/:userId/
  {suspend,reactivate}`): bloqueia o acesso de um membro sem removê-lo —
  `imf_broker_members.suspended_at` (migration `20260805b`), checado em
  `requireUser` com cache/invalidação próprios. Suspender desconecta o
  WhatsApp próprio do membro, se houver; reativar não reconecta sozinho.
- **Desempenho por corretor** (`GET /api/relatorios/summary?member_user_id=`):
  o mesmo relatório que hoje só existe agregado (conta) ou pessoal (o
  próprio chamador) ganha um terceiro escopo (`"member"`), só pro titular,
  mirando um corretor específico. Locação nunca aparece nesse escopo (não
  tem autoria por corretor).
- **Meta individual** (`imf_broker_goals.user_id`, migration `20260805c`,
  null = meta da conta): `POST /api/equipe/goal` agora exige titularidade
  pra gravar a meta da conta inteira — antes qualquer membro conseguia
  reescrever a meta de todo mundo sem querer.
- **Aba "Desempenho"** (menu lateral, capability `team`,
  `src/experience/DesempenhoArea.tsx`): lista toda a equipe de uma vez
  (`GET /api/equipe/performance?months=`), com leads recebidos/fechados,
  conversão e retorno por lead (R$ vendido ÷ leads recebidos) por pessoa —
  clicar num corretor abre o mesmo drill-down por `member_user_id` do item
  acima. Indicador de retorno usa só dado já existente (sem custo/salário
  cadastrado, por escolha do usuário).
- **Financeiro** (`GET /api/financeiro/summary`, `financeiro.ts`): o bloco
  de aluguel (contratos ativos, receita mensal, inadimplência,
  recebimentos) só é consultado se `isBrokerOwner` — não-titular recebe
  esses campos zerados. O bloco de venda de lançamento continua igual
  (própria venda pra não-titular, total pra titular — desenho original,
  não mudou). Na sidebar, a aba "Financeiro" some pra quem não é titular
  E não tem a capability `developments` (nada sobraria pra ver ali); segue
  visível pra corretor de incorporadora, que ainda tem a própria venda.
- **Abas "Equipe", "Desempenho" e "Locação" ficam invisíveis pra membro
  convidado** (2026-08-05, achado ao vivo pelo usuário: um membro comum
  via essas abas no rail iguais às do titular). O rail (`AREAS`/
  `areasForCapabilities`, `engine.ts`) sempre filtrou só por capability da
  conta, nunca por quem está logado. `GET /api/brokers/me` agora devolve
  `is_owner` (via `isBrokerOwner`); `ExperienceShell.tsx` guarda em estado
  e passa pra `ManualRail`, que tira as três da lista quando `!isOwner`
  (`OWNER_ONLY_AREAS`). Equipe/Desempenho já eram titular-only no backend
  antes disso (só a aba aparecia à toa); **Locação não era** — nenhuma das
  24 rotas de `locacao.ts` checava titularidade, só sessão válida, então
  qualquer convidado tinha CRUD completo sobre contrato, dado de inquilino
  (CPF/CNPJ) e cobrança. Corrigido no middleware de topo do router
  (`.use("/api/locacao", ...)`, depois de `requireAccountCapability`): 403
  se `!isBrokerOwner(userId, brokerId)`. `imf_rental_contracts` não tem
  coluna de corretor responsável — locação sempre foi dado da empresa
  inteira, então "só titular" (e não um split leitura/escrita por membro)
  foi a escolha do usuário, mesmo padrão já usado na chave Asaas.

### Permissões granulares por membro da equipe (2026-08-06)

Extensão do modelo acima: até aqui, um membro tinha exatamente UM nível
de acesso (o mesmo de qualquer outro membro) — só o titular tinha algo a
mais. O usuário pediu controle fino: escolher, por membro, quais módulos
e quais ações (Visualizar/Criar/Editar/Excluir/Gerenciar) ele tem, com
perfis prontos pra aplicar de uma vez e histórico de quem mudou o quê.
Pedido original citava "Contas Agregadas"/"contas filhas ou vinculadas" —
investigação achou um segundo sistema candidato, `corretora.ts`/
`CorretoraSettings.tsx` (agrupa contas INDEPENDENTES por CNPJ), mas ele
está praticamente morto (3 rotas, zero RLS, nenhum acesso a dado de
negócio entre contas, nem aparece mais em `/app` — só sobrevive no
Dashboard legado, `/`). Confirmado com o usuário: esta rodada é só
Equipe; repartilhar dado entre contas independentes fica de fora.

**Schema** (`imf_member_permissions`, `broker_id, user_id, module,
action` — só guarda linha quando concedido, ausência = negado; titular
real NUNCA tem linha aqui, acesso dele é sempre implícito via
`isBrokerOwner`) + `imf_permission_audit_log` (append-only,
`change_type` grant/revoke/profile_applied + `diff` jsonb). RPCs
`imf_set_member_permission`/`imf_replace_member_permissions`
(`RETURNS VOID` de propósito, mesmo motivo do fix de `ON CONFLICT`
ambíguo documentado acima na seção de CRM). Os 6 perfis prontos
(Administrador/Gestor/Corretor/Atendente/Financeiro/Só visualização)
ficam fixos como constante TypeScript — aplicar um substitui a grade
inteira do membro, nunca une com o que já tinha.

**Módulos** (14): `carteira`, `negocios`, `contatos`, `agenda`,
`conversas`, `locacao`, `lancamentos`, `financeiro`, `equipe`,
`whatsapp-conexoes`, `relatorios`, `integracoes`, `configuracoes`,
`assistente-ia`. Nem todo módulo aceita as 5 ações — `financeiro`/
`relatorios`/`conversas`/`integracoes`/`configuracoes`/`assistente-ia`
só têm Visualizar/Gerenciar (são resumos agregados ou configs de
conta/toggle, sem CRUD de registro individual).

**Motor** (`server/services/permissions.ts`, espelha
`accountCapabilities.ts`): `hasPermission(userId, brokerId, module,
action)` atalha por `isBrokerOwner` primeiro — titular sempre passa,
comportamento idêntico a antes desta mudança. Membro só passa se tiver a
linha concedida, checagem cacheada 60s (mesmo padrão de TTL de
`isBrokerOwner`, invalidado explicitamente a cada escrita e nos mesmos
pontos onde `invalidateIdentityCache` já era chamado — remover/suspender/
reativar membro).

**Quem gerencia a grade de outro membro: só o titular real, sempre
hard-coded, nunca delegável** — nem por um membro com o perfil
"Administrador" aplicado. Se desse pra delegar via a própria grade, um
membro poderia se auto-conceder qualquer coisa e o modelo furaria a si
mesmo por dentro. Os 5 endpoints novos (`GET/PUT .../permissions`,
`POST .../apply-profile`, `GET .../permissions/audit`, `GET
/api/equipe/permission-profiles`) usam o `isOwner()` local de
`equipe.ts`, nunca `hasPermission`.

**8 rotas que já eram hard-coded titular-only viraram configuráveis**
(comportamento do titular idêntico a antes; membro sem grant nenhum
também idêntico a antes — só quem ganha uma linha concedida muda de
comportamento): `equipe.ts` (convidar/remover/reatribuir/suspender/
reativar/ranking/performance/slots de WhatsApp), `locacao.ts` (era UM
gate de router bloqueando tudo pro não-titular — virou um classificador
por verbo/rota: GET→visualizar, POST→criar, PATCH/PUT→editar,
DELETE→excluir, rotas de config/régua/autopilot→gerenciar; não dá pra
filtrar "só os meus contratos" porque `imf_rental_contracts` não tem
autor por corretor), `crmPipelines.ts` (`requireOwner()` →
`negocios:gerenciar`), `financeiro.ts` (resumo de aluguel →
`financeiro:gerenciar`), `relatorios.ts` (drill-down por membro →
`relatorios:gerenciar`), `brokers.ts` (chave Asaas →
`integracoes:gerenciar`), `lancamentos.ts` (7 sub-rotas
financeiras/documentos de reserva → `lancamentos:gerenciar`),
`conversations.ts` (bypass de dono em `canAccessTicket` →
`conversas:gerenciar`).

**Acesso básico automático pra membro novo** (seed em `POST
/api/auth/join`, ao aceitar convite): replica exatamente o que um membro
já conseguia fazer sem checagem nenhuma antes desta mudança — CRUD
completo em Carteira/Negócios/Contatos/Agenda, visualizar em Conversas/
Relatórios/Equipe/Assistente IA/Configurações, gerenciar a própria
instância de WhatsApp. Locação/Lançamentos/Financeiro/Integrações ficam
de fora por padrão — só liberados manualmente pelo titular, cumprindo
literalmente o pedido ("funções administrativas, configurações
sensíveis e integrações só liberadas manualmente").

**Frontend**: `src/experience/PermissionsModal.tsx` (novo) — aba "Grade"
(14 módulos × ações válidas, checkbox otimista com reversão em erro) +
aba "Histórico" (auditoria paginada, nomes de ator/alvo resolvidos com o
mesmo padrão de `supabase.auth.admin.getUserById` já usado em
`equipe.ts`) + seletor "Aplicar perfil" com confirmação explícita
avisando que substitui toda a grade atual. Ícone novo (`ShieldCheck`) na
mesma fileira de ações por membro em `EquipeArea.tsx` — não criou item
novo no menu lateral, a própria aba Equipe já é essa tela.

**Verificado ao vivo**: 27 asserções via HTTP contra conta de teste
descartável — confirmam bit-a-bit que um membro pré-existente sem
nenhuma linha concedida se comporta IDÊNTICO a antes nas 8 rotas
tocadas; conceder/revogar tem efeito imediato (sem esperar o TTL do
cache); combinação inválida (`financeiro:criar`) rejeitada com 400;
titular não tem grade própria (400); membro nunca gerencia permissão
nenhuma, nem a própria (403 mesmo tentando); aplicar perfil substitui
(nunca une) e gera a linha de auditoria certa; fluxo real de
convite→entrada popula o seed corretamente. Checagem visual adicional
com sessão real injetada no navegador: grade renderiza certo, toggle
dispara o PUT real e persiste, histórico mostra o texto certo em
português. `tsc`/`knip`/`build` limpos; `npm test` só o CRLF conhecido —
precisou ajustar a guarda de regressão `tests/accountCapabilities.
test.ts`, que travava o texto-fonte antigo de `locacao.ts`.

**Fora de escopo desta rodada**: CRUD do PRÓPRIO registro em Leads/
Imóveis/Agenda (hoje sem checagem nenhuma — revogar isso é mudança de
comportamento maior, e as mesmas rotas também são chamadas pelo n8n
agindo "como" um membro); perfis customizados além dos 6 fixos;
enforcement no módulo Contatos (catalogado na taxonomia, sem rota gated
ainda); sistema Corretora (continua só metadado, intocado).

### WhatsApp Pai — Fase 1: permissão granular chega ao agente de IA (2026-08-07)

Pedido: número de WhatsApp central onde qualquer usuário da plataforma
manda comando em linguagem natural e a IA executa a ação real na conta
correta, respeitando as mesmas permissões do painel — sem n8n, nativo.
Investigação prévia (agentes de exploração em paralelo + validação de
arquitetura) confirmou que `server/services/agent.ts` já é o cérebro
completo por trás do assistente do painel — `runAgent()`/`executeAction()`
já são funções puras, sem acoplamento a req/res, prontas pra uma porta de
entrada nova. Plano completo (7 fases) em
`.claude/plans/zany-forging-curry.md`.

**Lacuna encontrada**: o motor de permissões granulares da seção acima
(`hasPermission`) nunca era consultado por `agent.ts`/`routes/agent.ts` —
um membro sem `carteira:criar` já conseguia cadastrar imóvel só pedindo
pro assistente de IA do painel. Fechado nesta Fase 1, pré-requisito
explícito do pedido do WhatsApp Pai ("se não tiver autorização... a IA
também não pode") e que já vale pro assistente do painel hoje, não só
pro WhatsApp futuro.

**Implementação**: `AGENT_ACTION_PERMISSION` (`server/services/agent.ts`)
mapeia as 12 ações mutantes do agente + `query_agenda` pro par
módulo:ação de `permissions.ts` (`create_property→carteira:criar`,
`create_lead→negocios:criar`, `send_message`/`broadcast_message`/
`schedule_followup→conversas:gerenciar`, `end_rental_contract→
locacao:excluir`, `update_unit→lancamentos:editar`, etc.). Dois pontos de
checagem: gate soft em `runAgent` (nem propõe a ação sem permissão) e
gate hard em `executeAction` (nunca executa — cobre inclusive o cenário
de corrida onde a permissão é revogada entre a proposta e a confirmação
vinda de `/api/agent/execute`). Titular sempre passa (`hasPermission`
atalha por `isBrokerOwner`). Teste novo `tests/agentPermissions.test.ts`
deriva a lista de ações mutantes direto do schema Zod existente
(`agentActionSchema.options`), evitando uma segunda lista hardcoded que
pudesse ficar desatualizada.

Verificado ao vivo com conta descartável (titular + 1 membro, servidor
real, Supabase real, chamada real ao OpenRouter): membro sem grade →
negado sem propor; aplica perfil "corretor" → proposta+confirmação
normal; titular sempre passa; revoga → nega na hora; cenário de corrida
propor→revogar→confirmar → bloqueado pelo gate hard com 400.

### WhatsApp Pai — Fase 2: vínculo de telefone com verificação (2026-08-07)

Continuação da Fase 1 acima. Antes de qualquer inbound do futuro WhatsApp
central existir (Fase 4), staff precisa provar, dentro do painel já
autenticado, que um número de WhatsApp é dele — sem isso não há como
resolver "quem está mandando esse comando" a partir de um telefone.

**Schema** (`supabase/migrations/20260807_whatsapp_pai_staff_links.sql`,
aditiva): `imf_whatsapp_staff_links`, PK = telefone normalizado (não
`user_id`) — o caminho quente futuro é "esse telefone bate com quem",
busca direta O(1); sem `broker_id`, derivado em tempo de leitura via
`getBrokerId` (já cacheado), evitando um dado derivado que ficaria
desatualizado se o usuário mudasse de conta.

**Backend**: `server/security/whatsappVerificationCode.ts` (código de 6
dígitos + hash sha256, espelha `trialVoucherCode.ts` — nunca texto puro
persistido). `server/services/whatsappStaffLinks.ts` —
`startPhoneVerification` recusa sobrescrever um número já VERIFICADO por
outra conta (nunca "rouba" um vínculo confirmado), mas permite reiniciar
uma verificação ainda pendente de qualquer um (nada foi provado ainda,
sem risco); `confirmPhoneVerification` expira em 10 min, máx. 5
tentativas, sempre resolve pra tentativa mais recente do próprio usuário;
`unlinkPhone` filtra por `user_id` — ninguém desvincula número alheio.
Rotas `GET/POST/DELETE /api/me/whatsapp-link*` (`requireUser` + rate
limit novo `whatsappLinkLimiter`, 8/15min por usuário — cada `start`
dispara uma mensagem REAL). Frontend: card novo em `ConfigArea.tsx`
(telefone → código → confirmar, lista de vínculos com botão de
desvincular).

**Achado de infraestrutura durante o teste ao vivo** (pré-existente, não
introduzido nesta rodada): o envio do código copiava o mesmo padrão que
a recuperação de senha via WhatsApp já usa (`server/routes/auth.ts`,
`POST /message/text/:session`) — mas ao vivo esse endpoint devolve 405
pra qualquer valor, e `server/services/uazapi.ts` já documentava desde
03/07/2026 que essa hipótese foi "testada e descartada" em favor de
`POST /send/text` com o token da própria instância no header. Corrigido
pra reusar `sendUazapiText` diretamente. Separado disso, a variável local
`UAZAPI_PLATFORM_SESSION` no `.env` do repositório nunca tinha sido
preenchida de verdade (ficou o placeholder `"COLE_O_NOME_DA_SESSAO_AQUI"`)
— não necessariamente afeta produção, que usa secrets do Fly. Provisionada
uma instância UAZAPI temporária pareada com o número pessoal do usuário
só pra validar o fluxo localmente, com comentário explícito marcando como
temporário até a Fase 3 trazer o número oficial.

Testado ao vivo: telefone inválido, código errado, código expirado,
bloqueio após 5 tentativas e confirmação cross-account todos rejeitados
corretamente via script contra o servidor real; fluxo feliz completo
(código chega de verdade no WhatsApp, usuário digita, confirma) validado
pelo próprio usuário direto na tela real do navegador.

### WhatsApp Pai — Fase 3: instância central gerenciada pelo admin (2026-08-07)

Enquanto a Fase 2 prova "esse número é de fulano", a Fase 3 resolve o
outro lado: qual número CENTRAL recebe os comandos de todo mundo. Pedido
explícito do usuário durante a implementação — *"quando um corretor
entrar na plataforma o whatsapp pai já deve estar cadastrado, caso ele se
desconecte, na conta de super admin deve ter a opção de colocar o
whatsapp pai pra todos os tenants"* — confirmou o desenho já em curso:
instância única, compartilhada, gerenciada só pelo admin, sem nenhuma
ação extra exigida de cada corretor.

**Schema** (`supabase/migrations/20260807b_whatsapp_pai_platform_instance.sql`,
aditiva): `imf_platform_instances`, linha única `key='pai'` — diferente de
`imf_brokers`/`imf_broker_members` (1 linha = 1 instância própria por
conta), o Pai é literalmente UMA instância pra plataforma inteira.

**Backend**: `server/services/provisioning.ts` ganhou `setUazapiWebhookUrl`
(núcleo puro do POST `/webhook`, extraído de `setUazapiWebhook` pra ser
reaproveitado com uma URL diferente) e `ensurePlatformInstance`/
`provisionUazapiInstanceForPlatform` — mesmo padrão de comparar-e-trocar
já provado em `ensureInstance` (broker/membro), adaptado pra chave de
texto em vez de UUID. O webhook do Pai aponta pra uma URL FIXA
`/api/wpp-pai/inbound` (sem `:instanceId` no path — a Fase 4 vai resolver
quem está mandando por telefone do remetente, não por qual instância
recebeu; até lá essa URL dá 404, inofensivo). Rotas novas em `admin.ts`:
`GET /api/admin/whatsapp-pai/status`, `POST .../connect` (QR ou código de
pareamento, mesma lógica do fluxo de conexão do corretor em `brokers.ts`),
`POST .../disconnect` — todas atrás de `requireAdmin`.

**Frontend**: aba nova "WhatsApp Pai" no Painel Admin
(`src/components/AdminWhatsappPai.tsx`, lazy-loaded igual às outras abas
de `pages/Admin.tsx`), mesmo padrão visual/de polling de
`WhatsAppConnectCard`, com aviso explícito de que conectar/desconectar
ali vale pra **todos os tenants de uma vez**.

A instância temporária de teste da Fase 2 (já pareada com o número
pessoal do usuário) foi inserida direto na tabela nova em vez de deixar
`ensurePlatformInstance` provisionar do zero — evita perder o pareamento
já feito. Trocar pelo número oficial mais tarde é só usar a mesma tela
(desconectar → conectar com o número novo), sem mudar nenhum código.

Testado ao vivo: conta sem `is_admin` recebe 403 no status; conta admin
vê `provisioned=true, connected=true` com dados reais (perfil, número) da
instância já conectada; UI checada de ponta a ponta com uma sessão de
admin descartável injetada no navegador — a aba renderiza exatamente o
status ao vivo.

### WhatsApp Pai — Fase 4: pipeline de inbound + confirmação persistida (2026-08-07)

O WhatsApp central passa a RECEBER comando de verdade — texto apenas
nesta fase (áudio/foto ficam pra Fase 5, `server/services/
inboundMedia.ts` já tem o pipeline de download/transcrição pronto pra
reusar).

**Schema** (`supabase/migrations/20260807c_whatsapp_pai_inbox_and_pending_actions.sql`,
aditiva): `imf_pai_inbox` — fila durável própria pro Pai (não estende
`imf_webhook_inbox`, entrelaçada com despacho pro n8n/debounce,
irrelevantes aqui — nativo, sem n8n, cada mensagem é 1 turno só), mesmo
padrão SKIP LOCKED comprovado em `claim_imf_webhook_inbox`
(`20260721b_webhook_inbox_outbox.sql`), particionada por `sender_phone`
em vez de `broker_id` (o Pai não sabe de quem é a mensagem até resolver
o telefone) — garante que mensagens da MESMA pessoa nunca processam fora
de ordem/concorrentes. `imf_whatsapp_pending_actions` — PK em `user_id`
(garante "1 ação pendente por remetente" de graça, já que
`imf_broker_members.user_id` é `UNIQUE`). `imf_agent_log` ganha `channel`
('web'|'whatsapp') e `provider_message_id` (índice único parcial = trava
de idempotência contra reprocessamento após crash).

**Backend**: `server/services/whatsappPaiQueue.ts` (novo) — resolve
telefone→`imf_whatsapp_staff_links` (só verificado)→`userId`→
`getBrokerId`; número não vinculado recebe orientação pra vincular no
painel, nada é tocado. Ação pendente existente e não vencida: classifica
a resposta por palavra-chave determinística em PT-BR (nunca pergunta ao
modelo se "sim"/"não" — mesmo princípio de `resolveDueAt`/`computeDueAt`
em `agent.ts`); qualquer coisa fora das duas listas abandona a pendência
em silêncio e trata a mensagem como comando novo, nunca executa por
engano. Confirma → `parseConfirmedAgentAction` + `executeAction` — o
MESMO `executeAction` da Fase 1, com o gate de permissão já embutido, sem
duplicar lógica nenhuma. Sem pendência: monta `history` das últimas 8
linhas de `imf_agent_log` (qualquer canal — memória contínua entre
painel e WhatsApp) e chama `runAgent`, o MESMO cérebro do assistente do
painel. `server/routes/whatsappPai.ts` (novo) — `POST /api/wpp-pai/inbound`,
autentica por `body.token` contra o token da instância central (1
instância só, sem lookup por id, diferente do inbound de broker). Ciclo
novo `cycles.pai` em `webhook-worker.ts`; job novo
`expirePaiPendingActions` (60s) em `scheduler-worker.ts`; `imf_pai_inbox`
entrou na retenção de filas existente.

**2 bugs reais achados testando ao vivo** (não hipotéticos, só apareceram
rodando contra o servidor real com mensagens em sequência):
1. `runPaiInboxTick` não tinha a mesma trava anti-sobreposição que
   `runWebhookInboxTick` já tem (`inboxTickRunning`) — duas mensagens
   próximas no tempo (comum, já que `runAgent` leva alguns segundos)
   disparavam ciclos concorrentes colidindo entre si. Corrigido com o
   mesmo padrão `paiTickRunning` boolean.
2. `classifyReply` não tirava pontuação antes de comparar — "sim, pode
   confirmar" virava `firstWord` `"sim,"`, não batia com `"sim"` da
   lista, e a pendência era abandonada em silêncio em vez de confirmada
   (o imóvel nunca era criado, sem erro nenhum aparecer). Corrigido
   tirando pontuação final da palavra antes de comparar.

Testado ao vivo com payload sintético no formato exato da UAZAPI e
*polling* do status da fila (mais confiável que espera fixa — `runAgent`
varia de ~5 a ~10s): telefone não vinculado → orientação; comando
mutante → proposta persistida; "não" → cancela, nada criado; comando de
novo + "sim" → imóvel REAL criado; reenvio da mesma mensagem → bloqueado
pelo `dedupe_key`, sem duplicar; log com `channel='whatsapp'`; membro sem
`carteira:criar` → negado através do WhatsApp Pai, mesma mensagem da
Fase 1 — prova de que o gate de permissão vale igual não importa a porta
de entrada.

### WhatsApp Pai — Fase 5: mídia (voz + fotos de imóvel antes do texto) (2026-08-07)

**Contexto**: entre a Fase 4 e esta, o número de teste (pessoal do
usuário, usado deliberadamente "só pra teste" até vir o número oficial)
foi banido pelo WhatsApp por spam — efeito colateral do volume de
mensagens automatizadas dos testes anteriores num número recém-pareado,
gatilho clássico de detecção de abuso contra clientes não-oficiais tipo
UAZAPI. Confirmado direto contra `GET /instance/status`
(`connected:false, loggedIn:false`). Isso impediu teste ao vivo com
download real de mídia nesta fase (exige instância conectada); a
implementação seguiu normal e a verificação foi adaptada (ver "Testado").

Fotos entregues pelo WhatsApp chegam uma mensagem por vez, sem estado de
sessão entre elas — diferente do array em memória da `CommandBar.tsx` no
painel. `imf_whatsapp_staged_media(user_id, broker_id, url, created_at)`
(migration `20260807d_whatsapp_pai_staged_media.sql`, aditiva) faz esse
papel de forma persistida: cada foto recebida vira uma linha; a próxima
mensagem de TEXTO do mesmo usuário é que dispara o comando de verdade e
recolhe as fotos staged.

**Backend**:
- `server/services/propertyImages.ts` (novo) — `uploadPropertyImageBase64`
  extraída de `POST /api/properties/upload-image`, comportamento
  idêntico; a rota virou wrapper fino.
- `server/services/inboundMedia.ts` — `detectInboundMediaKind`,
  `mediaMessageId`, `declaredFileLength` exportadas (eram privadas) pra
  reuso, evitando duplicar a extração de id/tamanho do payload UAZAPI
  entre os dois pipelines (cliente e Pai).
- `server/services/whatsappPaiQueue.ts` — `handleIncomingPhoto` baixa via
  `downloadUazapiMedia`, sobe pro bucket `property-images` e grava em
  staging — SEM `describeImageWithOpenRouter`: diferente do pipeline do
  cliente, a foto do Pai nunca é descrita por IA, vira anexo puro (mesmo
  comportamento do painel hoje, decisão do plano original).
  `handleIncomingAudio` baixa + transcreve com `transcribeWithOpenRouter`
  (mesma IA já usada no pipeline do cliente); o texto transcrito
  substitui a mensagem normal e segue o fluxo comum. `fetchStagedPhotoUrls`
  alimenta `opts.imageUrls` do `runAgent` — `create_property` já sabia
  carimbar isso sozinho desde que o agente ganhou esse parâmetro
  (`agent.ts:1068-1070`, usado pela `CommandBar.tsx`), zero mudança lá.
  Staging é limpo em `handlePendingAction` assim que um `create_property`
  é confirmado e executado com sucesso.
- `server/services/maintenance.ts` — `expireStagedWhatsappMedia` (TTL
  60min, rede de segurança pro staging abandonado); job novo em
  `scheduler-worker.ts` (5 em 5 min).

**1 bug de TypeScript, mesma causa-raiz já documentada na Fase 2**:
`handleIncomingPhoto`/`handleIncomingAudio` devolviam originalmente
`{ok:true,...}|{ok:false,error}`, e o acesso a `.error` no ramo negado
falhava a compilar. Isolado com repro mínimo fora do projeto: com
`strictNullChecks` desligado (confirmado no `tsconfig.json` — sem
`"strict"` nem `"strictNullChecks"`), `!x.ok` e `if (!x.ok)` NÃO estreitam
união discriminada, só `x.ok === false` estreita. Corrigido lançando
exceção em vez de devolver `{ok,error}`, mesma solução já usada em
`whatsappStaffLinks.ts`/`confirmPhoneVerification`.

**Testado** (adaptado à instância banida — ver Contexto): 2 fotos
inseridas diretamente em staging simulando envio prévio → comando de
texto "cadastra um imóvel..." → ação pendente chega com `image_urls`
contendo as 2 URLs staged (prova que staging→`runAgent`→`create_property`
funciona de ponta a ponta); "sim" → imóvel REAL criado em
`imf_properties` com as 2 fotos no campo `image_url`; staging confirmado
vazio depois; mensagem de foto sintética contra a instância desconectada
→ `downloadUazapiMedia` falha com HTTP 503 → capturado, logado, resposta
amigável enviada, linha da fila termina `completed` (não trava, não vira
`dead`) — prova de degradação graciosa mesmo sem conexão real. O caminho
de download bem-sucedido em si (função já comprovada, reusada do
pipeline do cliente) fica pendente de validação ao vivo pra quando houver
número pareado de novo. `npx tsc --noEmit`, `npx knip`, `npm test`
(144/144) e `npm run build` limpos.

### WhatsApp Pai — Fase 6: novas consultas (leads e relatório), compartilhadas com o painel (2026-08-07)

Duas ações novas no agente de IA, determinísticas em código (o modelo só
decide QUANDO chamar e extrai o parâmetro, nunca calcula o número — mesmo
princípio de `query_agenda`): `query_leads` (leads captados num período,
com filtro opcional pra só os sem atendimento) e `query_report`
(relatório de desempenho: leads, visitas, vendas, locação). Como as duas
entram em `runAgent`/`executeAction`, o MESMO cérebro usado pelo painel e
pelo WhatsApp Pai, o assistente do painel ganha essas perguntas junto —
não é feature exclusiva de canal.

`buildRelatoriosSummary(brokerId, months, owner, targetUserId, scope)`
extraída de `GET /api/relatorios/summary` (`server/routes/
relatorios.ts`), reusando `collectPages`/`collectForIds`/`reportPeriod`
como já eram — a rota HTTP virou wrapper fino, resposta idêntica
(inclusive o drill-down por membro, que continua exclusivo dela).
`queryLeadsAction`/`queryReportAction` novos em `agentGuardrails.ts`
(schemas Zod + `NON_MUTATING_ACTIONS`, nunca pedem confirmação).
`queryLeadsSummary`/`queryReportSummary` novos em `agent.ts` — a primeira
consulta `leads` por `created_at` (filtro `status='new'` quando pedem "não
atendidos"); a segunda chama `buildRelatoriosSummary` com `months`
derivado de `period` (mes=1/trimestre=3/semestre=6/ano=12) e formata em
texto curto. `AGENT_ACTION_PERMISSION` ganhou as duas entradas
(`negocios:visualizar`/`relatorios:visualizar`) — mesmo gate soft da
Fase 1.

Testado ao vivo contra o servidor real, conta descartável com titular + 1
membro, dados reais semeados (3 leads em estágios/dias diferentes, 1
visita realizada), via payload sintético no WhatsApp Pai: contagem de
leads de hoje bate exatamente (2, excluindo o de ontem), filtro "não
atendidos" isola só o esperado, relatório do mês reflete os números
semeados, e o resultado bate com `GET /api/relatorios/summary` chamado
com uma sessão real (magic-link) — confirma extração byte-idêntica.
Membro com `negocios:visualizar`/`relatorios:visualizar` revogados
explicitamente → negado nos dois casos, mesma mensagem de negação da
Fase 1, provando o gate valendo pras ações novas também.

Com isso, as Fases 1-6 do plano do WhatsApp Pai ficaram completas. A Fase 7
foi definida e implementada na sequência, conforme a seção abaixo.

### WhatsApp Pai — Fase 7: documentos como contexto temporário (2026-08-07)

Documento recebido pelo número central não é anexado automaticamente a nenhum
objeto do produto. Ele funciona como contexto de uso único para o próximo
comando do mesmo usuário vinculado. Isso permite perguntas como “resuma este
contrato” ou “cadastre o imóvel com os dados deste PDF” sem inventar um acervo
genérico nem escolher silenciosamente entre imóvel, lead, locação e reserva.

**Formatos e limites**:

- PDF, TXT, CSV, JSON, Markdown e XML;
- máximo de 8 MB por arquivo;
- no máximo 3 documentos staged por usuário;
- até 2.000 caracteres factuais extraídos por documento;
- DOC/DOCX/XLS/XLSX/PPT/PPTX devem ser convertidos para PDF.

**Persistência e privacidade**: a migration
`20260807e_whatsapp_pai_staged_documents.sql` cria
`imf_whatsapp_staged_documents` com `user_id`, `broker_id`, nome sanitizado,
MIME, tamanho, SHA-256, texto extraído e `created_at`. O arquivo bruto não é
salvo no Storage nem no banco. A tabela usa RLS, revoga `anon`/`authenticated`,
aceita apenas `service_role`, deduplica por usuário+hash e expira em 60 minutos.
Depois do próximo comando, todas as linhas staged daquele usuário são apagadas.

**Extração**: arquivos textuais são decodificados localmente em UTF-8. PDF é
enviado em base64 pelo tipo `file` da API do OpenRouter, usando explicitamente
o parser `cloudflare-ai`; a configuração evita ativar OCR pago de forma
silenciosa. O resultado é limitado antes de persistir.

**Segurança da IA**: `runAgent` recebe os documentos em `attachedDocuments`
dentro de `UNTRUSTED_ACCOUNT_CONTEXT`, separado de
`CURRENT_AUTHENTICATED_BROKER_REQUEST`. Instruções, prompt injection ou pedidos
contidos no documento são apenas dados. Somente a mensagem atual do usuário
autenticado expressa intenção e toda mutação ainda passa por schema Zod,
permissão granular e confirmação humana.

**Estado de rollout**: implementação e testes unitários locais concluídos. A
migration foi aplicada manualmente e confirmada. O número oficial foi pareado
pelo Admin local, mas não havia um segundo número disponível para o smoke; não
houve envio real nem chamada real ao OpenRouter. O webhook temporário de teste
foi desativado e o túnel encerrado.

**Resiliência do webhook central**: `setUazapiPlatformWebhook` aceita somente
origem HTTPS pública e monta a rota fixa `/api/wpp-pai/inbound`. O Admin a
reafirma antes de toda conexão e falha com 503 se não conseguir configurá-la.
O guardião periódico passou a incluir também a linha `key='pai'` de
`imf_platform_instances`; antes cuidava apenas das instâncias de brokers e
membros, permitindo o Pai aparecer conectado com inbound silenciosamente
desviado.

### Assistente IA — reset unificado de painel e WhatsApp Pai (2026-08-10)

O histórico operacional do Assistente IA é pessoal por `broker_id` +
`user_id` e compartilhado entre a CommandBar do painel e o WhatsApp Pai. Para
começar um teste ou atendimento sem contexto anterior, a mensagem inteira
`@reset` é interceptada deterministicamente antes de qualquer chamada ao
modelo. `@RESET` e espaços externos são aceitos; frases que apenas contenham o
token não são tratadas como reset.

A migration `20260810a_agent_conversation_reset.sql` cria a RPC transacional
`imf_reset_agent_conversation`, exclusiva da `service_role`. Ela apaga:

- `imf_agent_log` do usuário/conta;
- proposta do WhatsApp Pai ainda não executada;
- fotos staged ainda não vinculadas a imóvel;
- contexto textual de documentos staged.

Leads, imóveis, agenda, contatos, conversas comerciais, ações já executadas e
`imf_pai_inbox` não são tocados. A inbox permanece porque é a fonte de
idempotência e auditoria técnica. Se uma ação estiver em `executing` ou
`executed` aguardando entrega, a RPC retorna `action_in_progress`; remover essa
linha poderia permitir repetição após falha do provedor.

`DELETE /api/agent/history`, o botão **Nova conversa** e o comando digitado no
painel usam a mesma RPC. No WhatsApp, a confirmação do reset não é gravada de
volta no `imf_agent_log`, mantendo a tela vazia ao recarregar. O produto não
consegue apagar retroativamente as bolhas locais do aplicativo WhatsApp; elas
continuam visíveis no aparelho, porém deixam de ser memória da IA.

Migration aplicada no Supabase de produção em 10/08/2026 e verificada por
chamada neutra com UUIDs inexistentes, que retornou `ok=true` e quatro contagens
iguais a zero. Validação local: TypeScript, Knip, build, `git diff --check` e
167 testes aprovados. Código publicado no commit `31c2b93`, GitHub Actions run
`#139`, imagem Fly `deployment-01KZNWFBXDY55ZP94QF33TJV3K`; smoke público
pós-deploy aprovado em `/`, `/login` e `/app`. O aceite de `@reset` na conta
real permanece manual para não apagar histórico do usuário sem sua ação.

### Follow-Up Inteligente: de 3 passos fixos para até 8 (2026-08-06)

A régua de reativação automática de lead (`/app` → Assistente IA,
componente `FollowUpCard` em `AssistenteIAArea.tsx`) passou de 3 passos
sempre fixos pra até 8, configuráveis com um "+" que revela o próximo
bloco por vez — só o Dashboard antigo (rota `/`, `src/components/
FollowUpSettings.tsx`) ficou de fora dessa rodada por pedido explícito do
usuário, continua travado em 3 (sem regressão, já era assim).

- **Schema** (`followup_config`, migration `20260806c_followup_
  progressive_steps.sql`, aditiva): coluna nova `follow_count` (1-8,
  default 3 — brokers existentes não mudam de comportamento) +
  `delay_minutes_4..8`/`message_4..8`. Tabelas `followup_config`/
  `followup_conversations` nunca tiveram `CREATE TABLE` rastreado no repo
  (criadas direto no Supabase antes deste histórico de migrations) — essa
  e qualquer migration futura nelas só pode ser `ADD COLUMN IF NOT EXISTS`.
- **RPC** `public.claim_due_followups_v2()`: ganhou 5 branches novos no
  `WHERE` (índice 3→`delay_minutes_4` ... índice 7→`delay_minutes_8`) e
  passou a limitar por `fc.follow_message_index < cfg.follow_count` (era
  hardcoded `< 3`) — broker com `follow_count=3` continua funcionando
  idêntico a antes. Como a assinatura de retorno mudou (`follow_count`
  novo na saída), precisou `DROP FUNCTION` antes do `CREATE` — Postgres
  não deixa `CREATE OR REPLACE` trocar o tipo de retorno de uma função
  existente (erro `42P13`). **Existe uma função V1 irmã sem `_v2`, não
  rastreada no repo — só vive no Supabase, não foi tocada.**
- **Backend** `server/services/followup.ts::runFollowupTick`: único
  hardcode de "3" do arquivo virou `row.message_index < row.follow_count`
  (campo que a RPC agora devolve).
- **Frontend**: `FOLLOWS` (array de metadados de cada bloco) virou
  `[...3 objetos originais, ...5 gerados por loop]` — os 5 novos usam
  prazo recomendado em progressão semanal (14d/21d/28d/35d/42d,
  continuando o ritmo 24h→72h→7d já existente). Render é
  `FOLLOWS.slice(0, cfg.follow_count)`; o "+"/"-" só somam/subtraem
  `follow_count` no estado local (1-8, sem auto-save, mesmo padrão do
  resto do form — persiste só ao clicar "Salvar Follow-Up"; o "-" foi
  pedido numa segunda rodada, mesmo dia, depois que o usuário testou o
  "+" e não tinha como voltar). Textos que citavam "3" (subtítulo, aviso
  de rodapé) viraram dinâmicos por `cfg.follow_count`.
- Verificado ao vivo: RPC testada direto no banco (índice 6 → claim
  correto do Follow 7, segunda chamada não repete — atomicidade
  preservada); UI testada com sessão real (8 blocos revelados um a um,
  "+" some no 8, F5 confirma que `follow_count` persistiu; "-" desce até
  1, botões certos aparecendo/sumindo nos dois extremos).
- **Cancelamento imediato quando um humano assume (2026-08-06)**: regra
  pedida explicitamente pelo usuário — follow-up só roda com IA ativa e
  conduzindo; se um humano assume ou responde, cancela na hora; com IA
  desligada, nunca dispara. As regras de "IA ativa"/"IA desligada" já
  eram garantidas pela RPC (`ai_active = TRUE` e `cfg.enabled = TRUE`).
  Auditoria achou 2 caminhos que desligavam `ai_active` sem também travar
  `follow_sent=true` (`PATCH /api/conversas/:ticketId/ai-toggle` e
  `POST /api/conversas/create`, em `conversations.ts`) — os outros
  (`pauseAiForHumanTakeover`, usado por `agent.ts`, pela resposta manual
  em `conversations.ts` e por `/api/followup/broker-reply` do N8N) já
  travavam os dois campos. Sem `follow_sent=true`, religar a IA manualmente
  depois (sem o cliente ter mandado mensagem nova) podia disparar um
  follow-up com timing de ANTES da pausa. Fix: os 2 endpoints também
  passaram a gravar `follow_sent=true` ao desligar (nunca ao religar —
  só reseta de verdade quando o cliente manda mensagem nova, via
  `/api/followup/inbound`, caminho que já existia). Testado ao vivo:
  ticket de teste com silêncio já vencido, IA desligada e religada sem
  resposta do cliente → RPC não claimou (sem o fix, teria disparado).

### Regras de visibilidade

Desde 03/08/2026, `account_type` continua sendo o tipo principal da conta para
onboarding e cockpit, mas deixou de ser a única fonte das áreas especializadas.
A migration `20260803_account_capability_overrides.sql` adiciona overrides por
conta para `rentals`, `developments`, `finance` e `team`. Sem override, os
padrões antigos são preservados; com override, o admin pode combinar Locação e
Lançamentos na mesma conta. A tabela não é acessível por `anon` ou
`authenticated`: somente o backend com `service_role` lê e altera os registros
por meio da RPC atômica `imf_set_account_capabilities`.

`GET /api/brokers/me` devolve as funcionalidades efetivas. O rail filtra pelas
funcionalidades, e as rotas de Locação, Lançamentos, Financeiro e Equipe repetem
a verificação no backend. O Assistente IA ignora a persona enviada pelo browser
para clientes comuns e deriva tipo/funções do banco; ações confirmadas de
locação e lançamentos são revalidadas antes da execução. A migration foi
aplicada em produção em 03/08/2026; em novos ambientes, continua sendo uma
etapa manual obrigatória antes de o admin salvar combinações.

- O titular (`imf_brokers.user_id`) vê o consolidado de sua conta.
- Em Carteira, Leads, Agenda e Conversas, membros são filtrados por
  `owner_user_id` e só podem ver ou alterar o que lhes pertence.
- Operações de equipe e áreas financeiras conferem permissões e/ou titularidade
  no backend; esconder um botão no frontend não é autorização.
- Dados de locação consolidados não são mostrados a membros nos Relatórios,
  pois os contratos atuais não possuem autoria individual confiável.
- Documentos de reserva são privados e dependem de posse, `financial_access`
  e URL assinada de curta duração.

O backend usa a `SUPABASE_SERVICE_ROLE_KEY`, que ignora RLS. Portanto, RLS é
defesa adicional; o filtro explícito em cada rota continua obrigatório.

## 5. Personas e módulos

| Área | Corretor | Imobiliária | Incorporadora |
| --- | :---: | :---: | :---: |
| Hoje | sim | sim | sim |
| Conversas | sim | sim | sim |
| Assistente IA | sim | sim | sim |
| Carteira | sim | sim | sim |
| Leads | sim | sim | sim |
| Agenda | sim | sim | sim |
| Contatos | sim | sim | sim |
| Lembretes | sim | sim | sim |
| Locação | — | sim | — |
| Lançamentos | — | — | sim |
| Financeiro | — | sim | sim |
| Equipe | — | sim | sim |
| Divulgação | sim | sim | sim |
| Relatórios | sim | sim | sim |
| Config | sim | sim | sim |

### Situação funcional por domínio

- **Hoje:** indicadores da operação real por persona.
- **Conversas** (redesenhada 2026-07-23 — inbox estilo Zendesk/Intercom, não
  Kanban de arrastar; ver "Redesign da área de Conversas" abaixo): caixa por
  status, histórico, resposta humana, liga/desliga IA, responsável, fila,
  tags, notas e exclusão definitiva de um ticket/ciclo
  (`DELETE /api/conversas/:ticketId`, com mensagens/tags/notas em cascata).
  Nome do contato (de `imf_contacts`, auto-salvo no primeiro inbound) exibido
  na lista e no cabeçalho. Tags têm gerenciamento próprio (criar, renomear,
  trocar cor, apagar — botão **"Tags"**, `PATCH`/`DELETE
  /api/conversas/tags/:id`). Botão **"Criar CRM"** cadastra o contato da
  conversa como lead (nome + telefone), sem imóvel de interesse ainda —
  idempotente, mostra **"CRM criado"** se já existir um lead com o telefone
  (`POST /api/conversas/:ticketId/create-lead`).
  A thread suporta anexos enviados pelo corretor e mídia recebida reproduzível
  (áudio, imagem e documentos suportados). O composer mobile foi estabilizado
  para teclado virtual, notas internas e envio sem redimensionamento inesperado;
  menus/ações do CRM permanecem contidos no viewport.
- **Assistente IA:** nome, instruções e Follow-Up Inteligente em área própria.
  Config não contém mais campos de IA na V2.
- **Carteira:** imóveis, estados, imagens, landing pública e vitrine.
- **CRM (antiga "Leads", tela em `NegociosArea.tsx`, chave interna
  `negocios` inalterada):** duas abas, Kanban e Pipelines — ver detalhamento
  na seção 6 ("CRM: pipelines e etapas"). Criação, edição e exclusão
  definitiva de lead (`DELETE /api/leads/:id`) continuam como antes. Lead
  nem sempre tem imóvel — os criados a partir de uma conversa ficam
  escopados direto por `broker_id` (`property_id` null); os do fluxo
  tradicional (landing/cadastro manual) continuam escopados via o imóvel.
  Migration `20260717b_crm_pipelines.sql` aplicada; deployado na release v94
  (ver seção 6 "CRM: pipelines e etapas" e seção 14).
- **Agenda:** visitas e calendário com criação, alteração e cancelamento.
- **Contatos:** CRUD e salvamento automático a partir de conversas.
- **Lembretes:** lembretes (`create_reminder`) e follow-ups agendados
  (`schedule_followup`) criados pelo Assistente IA — ver "Ações agendadas do
  Assistente IA interno" adiante. Sem cadastro manual próprio ainda; tela só
  lista, conclui/apaga lembrete e cancela follow-up pendente.
- **Locação:** contratos residenciais, comerciais ou de temporada; partes,
  vigência, garantia única, taxa de administração, multa, juros, encargos por
  responsável e regra de reajuste. O controle mensal cria competências
  discriminadas e registra pagamentos feitos fora do ImobiFlow, inclusive
  recebimentos parciais e a forma/data informada pela imobiliária. Contrato
  sem histórico pode ser apagado; depois da primeira competência, deve ser
  encerrado para preservar o histórico. Boleto/PIX do cliente continua
  desativado por padrão e nenhum valor passa pela Criate. Inquilinos têm
  cadastro independente por conta, histórico de contratos e estado
  ativo/inativo. A aba **Inquilinos** consolida a situação financeira dos
  contratos ativos em **Adimplente**, **Inadimplente** ou **Sem cobrança**, com
  quantidade e saldo vencido; o mesmo indicador aparece no cartão do contrato.
  O cálculo usa o fuso de Brasília, não considera cobrança futura como atraso e
  mantém acordo sem pagamento no saldo inadimplente. O KPI geral de
  inadimplência usa o saldo vencido da competência atual, em vez de confundir
  todo valor ainda não recebido com atraso. O contrato guarda a
  fotografia cadastral da vinculação. Para carteiras de até 100 clientes, as
  telas de contratos e inquilinos usam uma fila operacional compacta por
  padrão, com inadimplentes primeiro, busca por pessoa/imóvel/contato/documento,
  filtros de situação, ordenação, atalhos de ação e paginação de 12 registros.
  O diretório de **Inquilinos** abre como tela própria, com cabeçalho e
  navegação de retorno, sem manter as abas e indicadores de Aluguéis na mesma
  superfície. Isso separa a consulta dos locatários da operação dos contratos
  sem duplicar cadastros ou regras de negócio.
  Clicar num inquilino (linha ou cartão, não só o lápis de editar) abre o
  **detalhe do inquilino** — sub-página própria dentro de Inquilinos, mesmo
  padrão de "Voltar" já usado pela tela (tela cheia no celular, sem modal
  cortado): cabeçalho com situação financeira e valor em atraso, atalho de
  WhatsApp, dados de contato completos (antes só existiam dentro do
  formulário de edição) e a lista de contratos do inquilino, cada um com
  acesso direto ao **Controle mensal** e ao **Diário do contrato** — antes
  só alcançáveis a partir de um contrato na aba Aluguéis. A linha/cartão da
  lista ficou mais enxuta (nome, imóvel atual, situação financeira, valor em
  atraso) porque o detalhe passou a concentrar o resto. Um
  trigger impede relacionar inquilino e contrato de contas diferentes. A
  automação financeira exige, cumulativamente, a flag global, geração e régua
  ligadas na conta e piloto ligado no contrato. Backend, scheduler e agenda
  revalidam a flag global. O **Diário do contrato** oferece **Testar WhatsApp**:
  mensagem identificada e limitada que valida a saída UAZAPI sem criar boleto,
  PIX, competência ou avanço da régua.
- **Lançamentos:** empreendimentos, unidades, simulador, reserva operacional,
  documentos privados e venda. O PIX de sinal está desativado por padrão.
  Exclusão de unidade/empreendimento só é bloqueada quando existe reserva
  com pagamento confirmado (`paid_at`); reservas sem pagamento real são
  removidas em cascata junto (documentos no Storage e no banco inclusos).
- **Financeiro:** consolidação de locação e vendas; valores grandes possuem
  quebra de linha para não vazar do card.
- **Equipe:** convites, membros, metas, ranking, permissões, opção de
  WhatsApp compartilhado ou próprio e revogação de convite pendente ainda não
  aceito (`GET`/`DELETE /api/equipe/invites/:id`, só o titular). O limite de
  WhatsApp próprio (`member_limit`) é self-service desde 17/07 —
  `GET`/`PATCH /api/equipe/whatsapp-slots`, só o titular altera, cobrado como
  add-on por slot (`MEMBER_WHATSAPP_SLOT_PRICE`, valor ainda fictício) — não
  se aplica a corretor (não tem Equipe). Selecionável já no checkout
  (`PaymentPending.tsx`) ou depois em Config.
  Em contas `experimentacao`, a cota efetiva vem de
  `trial_whatsapp_member_limit`, definida pelo voucher, não é editável pelo
  titular e não gera cobrança durante o teste. O add-on pago volta a ser a fonte
  da cota após a contratação.
- **Divulgação:** links e vitrines públicas + **prévia ao vivo da vitrine**
  (`iframe` da própria página `/vitrine/:brokerId`, same-origin, permitido pela
  CSP `frameAncestors 'self'`) — o corretor vê exatamente o que o cliente vê ao
  abrir o link. O card antigo "Ainda não disponível" (portais/campanha em massa)
  foi removido em favor da prévia.
- **Relatórios:** métricas determinísticas de 3, 6 ou 12 meses.
- **Config:** perfil, WhatsApp, plano, uso/excedentes, termos, chave Asaas para
  imobiliária/incorporadora e saída.
- **Tema:** o seletor Cristal Dia/Noite está habilitado; a preferência é local
  e as áreas móveis usam tokens de tema em vez de cores fixas sempre que já
  migradas.

## 6. Fluxos ponta a ponta importantes

### Cadastro, pagamento e ativação

1. O cadastro cria o usuário no Supabase Auth e a linha `imf_brokers`, com a
   persona escolhida e status inicial `pendente`. Desde 27/07/2026 a Etapa 1
   do wizard (`src/pages/Signup.tsx`) apresenta os 3 tipos de conta como
   cards de plano (preço real de `GET /api/config/plan`, checklist de
   features, destaque "mais popular" no Corretor autônomo, toggle
   Mensal/Anual decorativo) — mecanismo de escolha continua sendo
   `account_type`, sem preço diferenciado por plano ainda. QA em produção
   confirmou três colunas no desktop e cards empilhados sem overflow em
   viewport móvel de 360 px; o fluxo não foi submetido para evitar criar uma
   conta de teste desnecessária.
2. Usuário pendente é enviado para `/payment`.
3. Checkout e assinatura usam a conta Asaas global da Criate.
4. O webhook Asaas valida idempotência, atualiza a assinatura e ativa a conta.
5. Ativação por pagamento ou pelo Admin dispara a autocura do WhatsApp.
6. O acesso ao cockpit depende de sessão válida e status de assinatura.

O billing possui trava, idempotência, fila `imf_billing_reconciliations` e job
de reconciliação para operações externas que não concluíram de forma atômica.

### WhatsApp nativo UAZAPI

- Cada conta possui uma instância UAZAPI; um membro pode compartilhar a da
  conta ou ter instância própria.
- `ensureBrokerInstance` e `ensureMemberInstance` fazem autocura quando não há
  token e usam trava comparar-e-trocar para evitar provisionamento duplicado.
- O status e o connect chamam a autocura; a ativação manual do Admin também.
- A instância recebe webhook direto em
  `/api/wpp-shim/inbound/:instanceId`; não há intermediário de mensagens.
- É possível conectar por QR code ou código de pareamento. O telefone completo
  brasileiro é normalizado sem remover o nono dígito nesse fluxo.
- Desconectar chama `/instance/disconnect` sem apagar a instância, permitindo
  parear outro número e preservar token/webhook.
- Falhas de provisionamento são expostas à UI com retry, em vez de deixar o
  usuário indefinidamente no estado “configurando”.
- Não existe rota de envio por API externa de terceiro. O N8N responde por
  `/api/wpp-shim/ai-reply`, autenticado com `INTERNAL_PROXY_TOKEN`, e o backend
  envia diretamente pela instância UAZAPI correta.
- A neutralização da V2 usa a migration aditiva `20260721e`: adiciona e
  preenche `source_ticket_id` e cria `claim_due_followups_v2`. A função e as
  colunas compartilhadas anteriores não são alteradas, preservando a V1.

### Ciclos de ticket e histórico de conversas

O sistema publicado usa um ID nativo por atendimento:

- `imf_conversation_tickets.id` é um UUID único por ticket;
- mensagens, tags e notas apontam para `ticket_id`, evitando misturar ciclos
  diferentes do mesmo telefone;
- enquanto o ticket estiver `pending` ou `open`, novas mensagens reutilizam o
  mesmo UUID;
- depois de `closed`, o corretor pode **reabrir** o mesmo ticket (botão
  "Reabrir" na tela Conversas, decisão de produto 2026-07-23 — antes era
  imutável de propósito). Se o cliente mandar mensagem antes de ser reaberto
  manualmente, `ensureConversationTicket` abre outro UUID em `pending` do
  mesmo jeito; os dois caminhos (reabertura manual e automática) nunca
  colidem porque o endpoint de status só permite sair de `closed` quando não
  existe outro ticket ativo (`pending`/`open`) pro mesmo telefone — a mesma
  checagem que já existia pra evitar 2 tickets ativos simultâneos;
- `followup_conversations` continua como ponte operacional do ticket atual por
  telefone, para preservar o scheduler de follow-up;
- a tela Conversas lista tickets ativos e históricos e mostra um código curto
  derivado do UUID; o UUID completo permanece no banco/API;
- respostas atrasadas da IA são recusadas se o ticket estiver encerrado ou em
  atendimento humano.

A migration `20260717_conversation_ticket_cycles.sql` faz o backfill. Como não
é possível inferir com segurança os limites de ciclos históricos antigos, todo
o conteúdo legado de um telefone é associado a um ticket inicial. A separação
exata por ciclo passa a valer a partir da publicação desta implementação.

### Redesign da área de Conversas (2026-07-23)

Pedido do usuário (3 screenshots do app real no mobile): lista e thread
apareciam **empilhadas verticalmente** (dois blocos de altura fixa, um
embaixo do outro) — o grid `md:grid-cols-[320px_1fr]` colapsava pra 1 coluna
no mobile sem esconder nenhum dos dois lados. Junto: 3 pills de status
redundantes (Pendente/Em atendimento/Encerrado) dentro do cabeçalho da
conversa (a lista já categoriza isso por IA atendendo/Aguardando você/
Encerrado), "Sem fila"/Notas/+Tag soltos como botões desconectados, e um
painel de Notas separado que abria ACIMA das mensagens.

- **Decisão de arquitetura** (perguntada ao usuário antes de implementar):
  **inbox reorganizado** (estilo Zendesk/Intercom/Chatwoot — lista + thread),
  **não** um Kanban literal de arrastar cards. Motivo: uma conversa recebe
  mensagem nova a cada poucos segundos (poll de 3-5s) e precisa de resposta
  rápida — arrastar esse tipo de card ao vivo é incomum pro gênero e mais
  arriscado no mobile. A referência a "Kanban/pipeline" do pedido é atendida
  na linguagem visual (pills de categoria, badges), não em drag-and-drop.
- **Mobile: lista OU thread, nunca as duas** — condicionado a `selected`
  (`hidden md:block`/`hidden md:flex`, resolvido corretamente pelo
  `tailwind-merge` do `cn()` — testado direto com o pacote real antes de
  confiar). Seta "voltar" no cabeçalho da thread no mobile.
  Header/tabs de categoria da tela de lista somem no mobile quando uma
  conversa está aberta (`selected` truthy).
- **Menu hambúrguer no mobile**: "Gerenciar tags"/"Nova conversa" (sempre
  visíveis lado a lado no desktop) viram um dropdown de 2 itens no mobile.
  Renomeado pros dois tamanhos: "Gerenciar tags" → **"Tags"**.
- **Textos**: "Criar lead" → **"Criar CRM"**; "Já é lead" → **"CRM criado"**
  (só string — mesmo ícone/handler/endpoint `create-lead`).
- **Cabeçalho da thread simplificado**: removidas as 3 pills de status
  (redundantes com a categorização da lista). Adicionado botão "Detalhes"
  (ícone `MoreVertical`) e um ícone de nota interna direto no cabeçalho.
  Se `closed`: faixa "Atendimento encerrado" + botão **"Reabrir"**.
- **Modal "Detalhes do atendimento"** (mesmo padrão visual do
  `TagsManagerModal` já existente — sem componente novo de drawer/sheet):
  concentra Responsável e Fila (agora `<select>` nativo, no lugar dos 3
  dropdowns customizados com estado próprio que existiam antes) + Tags
  (add/remove) + "Reabrir atendimento" quando fechado.
- **Timeline única**: mensagens e notas mescladas num só array ordenado por
  `created_at` (com discriminante `kind` calculado no client, nada muda no
  backend — `GET /notes` já vinha ordenado ascendente). Nota renderiza como
  bolha visualmente distinta (âmbar, ícone `StickyNote`, "Nota interna — só
  o time vê") na posição cronológica real — resolve a queixa de "nota
  aparecia no topo" (não era ordenação errada, era um painel `showNotes`
  separado que abria acima de tudo). Adicionar nota agora é um campo inline
  curto (ícone na thread), não mais um painel.
- **Backend — reabrir ticket encerrado**: `server/routes/conversations.ts`
  `PATCH /api/conversas/:ticketId/status` — removido o bloqueio "Ticket
  encerrado é imutável"; a checagem de "outro ticket ativo pro mesmo
  telefone" (já existente, ver seção "Ciclos de ticket" abaixo) segue como o
  guarda-corpo real, e continua suficiente porque `ensureConversationTicket`
  já reaproveita o ticket ativo se o cliente mandar mensagem de novo.
- Checklist: tsc limpo, knip ok, build ok, diff --check limpo. QA visual ao
  vivo não rodada (mesma limitação de sempre — backend real dispara jobs de
  produção); mecânica de show/hide confirmada rodando `tailwind-merge` de
  verdade fora do browser, não só lida no código.

**Estado:** migration aplicada e verificada manualmente no Supabase em
17/07/2026. Tabela, colunas e índice retornaram `true`; conversas, mensagens,
tags e notas sem `ticket_id` retornaram zero. O código dependente foi publicado
no commit `d50e938` e na release Fly v88. Validação concluída com
`npx tsc --noEmit`, `npx knip`, `npm run build`, `git diff --check`, health
check e smoke HTTP 200 em `/`, `/login` e `/app`.

Depois desse redesign foram publicados ajustes adicionais de responsividade,
composer/teclado, menus do CRM, anexos, mídia recebida, auto-scroll, guardião
de webhook e backfill. O estado visual atual é o do commit `8aae185`; os
detalhes acima registram a decisão original de 23/07.

`UAZAPI_PLATFORM_SESSION` não é a instância individual do corretor. Ela é a
sessão da plataforma usada para mensagens como recuperação de senha por
WhatsApp e continua sendo uma credencial operacional pendente de confirmação
no Fly.

### CRM: pipelines e etapas (fase 1)

Transforma a área visualmente chamada "Leads" em "CRM". A chave interna
`negocios`, o componente `NegociosArea.tsx`, a tabela `leads` e os endpoints
`/api/leads` continuam existindo — a mudança é de apresentação e de modelo de
estágios, não uma reescrita.

**Estado:** migration `20260717b_crm_pipelines.sql` aplicada manualmente no
Supabase da branch `v2` em 17/07/2026; código publicado no commit `77769f0`
e na release Fly **v94** (imagem
`registry.fly.io/imobiflow-v2:deployment-01KXS0VH92QETBWY6BGGY3ZQS5`,
manifesto `sha256:0928b4fe2ccf8b60a5652110680b3f9d26157eec8537b70098042d816bbff847`,
máquina `08075edf911368` em `gru`, health check 1/1). Validação:
`npx tsc --noEmit`, `npx knip`, `npm run build`, `git diff --check` e smoke
HTTP 200 em `/`, `/app` e `/login`. Ambiente sem clientes reais; QA
autenticado completo (isolamento entre dois tenants, comportamento de
`closed_at`) ainda pendente.

Em 20/07/2026 foi preparada e executada manualmente a migration corretiva
`20260720b_crm_security_hardening.sql` (execução informada pelo usuário;
verificação pós-migration aprovada). Ela fecha a
execução pública da RPC `SECURITY DEFINER` de reorder, rejeita listas
duplicadas/incompletas, preserva a ordem por ordinality, torna autocura/troca
de padrão/edição e remoção de etapa transacionais e impede associar lead novo
a etapa ou pipeline arquivado. O backend tem compatibilidade temporária quando
as RPCs novas ainda não existem, mas esta migration deve ser executada e
verificada antes do próximo commit/push que publique esse código.

**Bug crítico encontrado em 21/07/2026 (só agora, por falta do QA autenticado
citado acima):** `imf_crm_ensure_default_pipeline` (a autocura chamada por
`GET /api/crm/pipelines` antes de listar) declarava
`RETURNS TABLE (pipeline_id UUID, first_stage_id UUID)`, o que cria uma
variável de saída `pipeline_id` visível na função inteira. Uma consulta no
corpo usava `pipeline_id` sem alias — `imf_crm_pipeline_stages` também tem
coluna `pipeline_id` — e o Postgres recusa a ambiguidade (42702, "It could
refer to either a PL/pgSQL variable or a table column"). Essa consulta é a
própria condição de um `IF`, roda sempre, então a função falhava em 100% das
chamadas, pra qualquer broker: a tela Negócios/CRM inteira ficou fora do ar
desde que `20260720b` foi aplicada (20/07/2026) até a descoberta ao vivo
(21/07/2026). Corrigido em `20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql`
(mesma função, só qualifica a referência com o alias `stage`, já usado no
resto da própria função). Não precisa de deploy — é só a função no Postgres;
efeito imediato após aplicar a migration manualmente.

**Segundo bug, mesma função, achado em 06/08/2026:** mesmo depois de
`20260721d` aplicada e confirmada (via `pg_get_functiondef`), `GET
/api/crm/pipelines` continuava devolvendo 500 pra qualquer conta — usuário
reportou a tela "Negócios" inteira fora do ar de novo (não era específico da
conta convidado que reportou, afetava titular também). A correção anterior
só cobriu `WHERE`/`SELECT`; sobrou uma segunda ocorrência ambígua no
`INSERT ... ON CONFLICT (pipeline_id, position) DO NOTHING` do seed das
etapas padrão — o alvo de um `ON CONFLICT` aceita expressões (já que índices
podem ser sobre expressão), então o Postgres aplica ali a mesma resolução de
identificador, e `pipeline_id` bate tanto com a coluna quanto com a variável
de saída da função (42702 de novo). Diferente do `WHERE`/`SELECT`, o alvo de
conflito não aceita alias (`stage.pipeline_id` é sintaxe inválida ali), então
não dá pra qualificar — a correção troca o `ON CONFLICT DO NOTHING` por um
bloco `BEGIN...EXCEPTION WHEN unique_violation THEN NULL; END;`, mesmo padrão
de idempotência já usado na criação do pipeline, algumas linhas acima na
mesma função. Corrigido em
`20260806d_fix_crm_ensure_default_pipeline_on_conflict_ambiguous.sql`.
Verificado ao vivo: chamada direta da RPC (sem cache de processo) e
`GET /api/crm/pipelines` via HTTP pras duas contas de teste (titular e
convidado) — ambas passaram a devolver pipeline/etapas reais.

**O que existe agora:**

- `NegociosArea.tsx` ganhou duas abas: **Kanban** (o funil, agora com
  colunas dinâmicas) e **Pipelines** (`PipelinesManager.tsx` — CRUD de
  pipelines e etapas).
- As colunas do Kanban deixam de ser o array fixo `new/contato/visita/
  proposta/fechado` e passam a vir das etapas do pipeline selecionado
  (seletor no topo, pipeline padrão pré-selecionado). Drag-and-drop e
  botões de avançar/voltar continuam, agora sobre a lista dinâmica.
  Arrastar usa `@dnd-kit/core` (não mais a API nativa HTML5 Drag and
  Drop) — ver "Drag-and-drop cross-platform" abaixo.
- Cada broker pode ter vários pipelines; exatamente um é o padrão
  (`is_default`). Cada pipeline tem etapas ordenadas (`position`), cada
  etapa tem um `stage_type` semântico: `open` (em andamento), `won`
  (ganho) ou `lost` (perdido).
- Todo lead novo — interface, landing pública, agente de IA, "Criar lead"
  a partir de conversa — recebe automaticamente o pipeline padrão do
  broker e a primeira etapa ativa dele (`resolveNewLeadStage`/
  `ensureDefaultPipeline` em `server/services/crmPipelines.ts`). Contas
  criadas depois da migration (que não passaram pelo backfill) recebem o
  pipeline padrão na primeira chamada, por autocura — mesmo princípio do
  `getBrokerId`.
- A aba Pipelines é leitura para membros. Só o titular recebe na resposta
  `can_manage=true` e vê controles de criação, edição, reorder, arquivamento e
  exclusão; o backend continua sendo a barreira definitiva com
  `isBrokerOwner`.

**Modelo de dados novo** (`supabase/migrations/20260717b_crm_pipelines.sql`,
detalhada na seção 14): tabelas `imf_crm_pipelines` e
`imf_crm_pipeline_stages`; colunas `leads.pipeline_id` e
`leads.pipeline_stage_id`. Sem `ON DELETE CASCADE` em nenhuma FK que chegue
em `leads` — apagar pipeline/etapa com lead associado é sempre bloqueado
(409) tanto na API quanto, como reforço estrutural, pelo próprio Postgres
(RESTRICT).

**Endpoints novos** (`server/routes/crmPipelines.ts`, montado em
`server.ts`; todos atrás de `requireUser`, mutações exigem titular via
`isBrokerOwner`):

| Endpoint | Quem pode |
| --- | --- |
| `GET /api/crm/pipelines` | qualquer membro do broker (autocura o pipeline padrão antes de listar) |
| `POST /api/crm/pipelines` | só titular |
| `PATCH /api/crm/pipelines/:id` | só titular |
| `DELETE /api/crm/pipelines/:id` | só titular — 409 se for o padrão ou se tiver leads |
| `POST /api/crm/pipelines/:id/stages` | só titular |
| `PATCH /api/crm/stages/:id` | só titular — `active:false` com leads exige `reassign_to_stage_id` ou retorna 409 |
| `DELETE /api/crm/stages/:id` | só titular — mesma regra de 409, via `?reassign_to_stage_id=` |
| `PATCH /api/crm/pipelines/:id/stages/reorder` | só titular — RPC `imf_crm_reorder_stages`, reatribui posição de forma atômica |
| `PATCH /api/leads/:id/stage` (em `leads.ts`) | titular ou membro dono do lead — mesma regra de posse do `/status` |

`broker_id` nunca é aceito do corpo da requisição em nenhum destes — sempre
resolvido via `getBrokerId(userId)`. `pipeline_id` de um lead nunca é
aceito solto: é sempre derivado do `stage_id` pelo trigger no banco.

**Compatibilidade com `leads.status`/`closed_at`:** um trigger
(`trg_imf_sync_lead_pipeline_stage`, dispara em INSERT e em UPDATE que
toque `pipeline_stage_id`) mantém os dois campos legados em sincronia a
partir do `stage_type` da etapa atual:

- `won` → `status='fechado'`, `closed_at` preenchido só se ainda nulo;
- `lost` → `status='perdido'` (valor novo — nenhuma métrica existente lê
  `status==='fechado'` diretamente, todas usam `closed_at IS NOT NULL`,
  então isso não quebra relatórios/metas/ranking; o único efeito colateral
  conhecido é que o gráfico de distribuição por etapa de Relatórios, que
  não conhece `'perdido'`, bucketiza esses leads em "new" — cosmético,
  não afeta contagem de fechados);
- `open` → `closed_at` limpo ao trocar de etapa; `status` normalizado pra
  `new` se não for um dos 4 valores legados de "em andamento".

O endpoint legado `PATCH /api/leads/:id/status` continua existindo para
chamadores externos. Quando o lead já pertence ao CRM, ele também resolve uma
etapa ativa compatível dentro do mesmo pipeline e atualiza
`pipeline_stage_id`; assim o status legado não diverge da coluna do Kanban.
Para pipelines personalizados sem os nomes históricos, preserva a etapa
`open` atual (ou usa a primeira ativa). O Kanban atual usa `/stage`.

Consumidores revisados e confirmados sem regressão: `server/routes/
relatorios.ts` (funil, negócios fechados, conversão — tudo via `closed_at`
ou com fallback gracioso pra valor desconhecido), `server/routes/
equipe.ts` (meta do mês e ranking, 100% via `closed_at`), `server/
services/agent.ts` (snapshot da IA lê `status` cru, sem hardcode dos 5
valores), `server/routes/dashboard.ts` (Dashboard 1.0 legado, não tocado).

**Drag-and-drop cross-platform (20/07/2026):** a primeira versão do Kanban
usava a API nativa HTML5 Drag and Drop (`draggable`/`onDragStart`/
`onDragOver`/`onDrop`). Essa API nunca teve suporte a toque no Safari iOS —
lacuna do WebKit, não específica deste app — então arrastar funcionava no
desktop e no Chrome Android (que tem uma camada de compatibilidade própria),
mas não no iPhone. Substituída por `@dnd-kit/core`, que unifica mouse/toque/
caneta via Pointer/Touch Events:

- `MouseSensor` ativa por distância (8px — resposta imediata, como antes);
  `TouchSensor` ativa por delay (200ms + tolerância de 8px) — sem isso, um
  gesto de rolar a tela (a lista de colunas rola na horizontal, cada coluna
  pode rolar na vertical) seria interpretado como início de arrasto. Mesmo
  padrão do exemplo oficial "Multiple Containers" da biblioteca.
- `DragOverlay` mostra uma cópia do card seguindo o dedo/cursor durante o
  arrasto; o card original fica semitransparente no lugar.
- Toda a lane (não só os cards) é zona de soltar — inclui o vão vazio.
- Os botões de avançar/voltar/editar/apagar dentro do card continuam
  funcionando normalmente (um toque sem movimento nunca cruza o limiar de
  ativação, então nunca vira arrasto).
- Validado localmente: sensor de mouse testado ponta a ponta (evento real
  de `mousedown`+`mousemove` incremental+`mouseup`, via conta descartável) —
  moveu o lead e persistiu via `PATCH /api/leads/:id/stage`. `TouchSensor` é
  o mesmo mecanismo da biblioteca, só que ouvindo eventos de toque.
  **Confirmado pelo usuário em 20/07/2026: arrastar funciona em dispositivo
  Android e iPhone reais.** Bug considerado resolvido.

**Efeito colateral corrigido — exclusão de conta pelo admin:**
`DELETE /api/admin/brokers/:id` apaga a linha de `imf_brokers` confiando em
CASCADE pra limpar o resto (`server/routes/admin.ts`). `imf_crm_pipelines`/
`imf_crm_pipeline_stages` foram criadas sem CASCADE de propósito (proteger
contra apagar UM pipeline/etapa com leads ainda vinculados), o que quebrou
esse fluxo mais amplo — a exclusão da conta inteira passou a falhar com
violação de FK, e o código nem checava o erro desse delete (reportaria
sucesso mesmo assim). Corrigido em duas frentes: migration
`20260720_crm_pipelines_broker_cascade.sql` adiciona `ON DELETE CASCADE`
só nessas duas FKs (seguro especificamente pro caso "apagar o broker
inteiro", já que os leads dele já cascadeiam junto via `imf_properties`/
`leads` → `imf_brokers`, então nada fica órfão); e `admin.ts` agora verifica
o erro do delete antes de responder `success`. Migration aplicada e
verificada em 20/07/2026 (ver tabela de migrations).

**Retomado e fechado de vez em 06/08/2026** — o fix de 20/07 cobriu só
`imf_crm_pipelines`/`imf_crm_pipeline_stages`; usuário bateu de novo no
mesmo tipo de erro (`properties_broker_id_fkey`) ao tentar excluir uma
conta com imóvel cadastrado. Mapeamento completo do grafo de FKs (via
`information_schema`, já que o banco é compartilhado com outros projetos
e uma suposição errada podia tocar tabela de fora do ImobiFlow) achou
mais 8 tabelas do núcleo sem `ON DELETE CASCADE`
(`imf_broker_goals`, `imf_conversation_messages`, `imf_developments`,
`imf_properties`, `imf_rental_contracts`, `imf_reservation_documents`,
`imf_unit_reservations`, `leads`) e `imf_rental_payment_receipts`
travando o contrato via `RESTRICT`. Achado à parte: `imf_agenda.
broker_id` não tem FK NENHUMA pra `imf_brokers` — não bloqueava a
exclusão, mas deixava eventos de agenda órfãos pra sempre, sem erro
nenhum. Em vez de espalhar mais `ON DELETE CASCADE` pelo schema,
`20260806e_admin_delete_broker_cascade.sql` criou uma função
transacional `admin_delete_broker_cascade(p_broker_id)` que apaga essas
tabelas na ordem certa (recibos antes do contrato; documentos de reserva
antes da reserva, por causa de uma FK composta — achado ao vivo numa
primeira versão da função que tinha essa ordem trocada) antes do `DELETE
FROM imf_brokers` final; `admin.ts` passou a chamar essa RPC em vez do
delete direto. Testado ao vivo com conta populada em todas as 10 tabelas
relevantes — exclusão 100% limpa, zero linha órfã, confirmado tabela por
tabela.

**Limitações da fase 1:** sem Dashboard/Calendário/Ações do CRM (fica pra
depois, conforme pedido); reorder de etapa é por botões ↑/↓ na aba
Pipelines, não drag-and-drop; mover lead entre pipelines diferentes é
permitido tecnicamente (mesmo broker, sem risco de isolamento) mas não tem
UI dedicada; o gráfico de distribuição por etapa em Relatórios não
distingue "perdido" de "novo" (ver acima).

**Risco a confirmar com o usuário antes de aplicar a migration:** o
backfill (seção 7.3 do SQL) associa cada lead existente à etapa
correspondente ao `status` atual. Para qualquer lead com `status='fechado'`
mas `closed_at` historicamente nulo (inconsistência pré-existente, se
houver), o trigger preenche `closed_at = now()` no momento da migration —
mesma estratégia de estimativa já usada em `imf_units.sold_at`
(migration `20260716d`). Isso pode fazer relatórios de períodos passados
passarem a contar esse negócio como fechado "hoje" em vez de silenciosamente
ignorado como antes. Não é possível recuperar a data real retroativamente;
sinalizando aqui em vez de decidir sozinho, conforme pedido.

### Assistente IA e Follow-Up

- A V2 usa a área `assistente-ia` nas três personas.
- Nome e instruções vêm de `imf_brokers`/`broker_agents`; Follow-Up usa sua
  configuração própria.
- O Follow-Up tem toggle, três intervalos e três mensagens, enviados em ordem
  por um scheduler de 60 segundos.
- A UI nova foi implementada dentro de `AssistenteIAArea`. Os componentes
  `AISettings.tsx` e `FollowUpSettings.tsx` permanecem para o Dashboard 1.0.
- O proxy LLM usa chave OpenRouter do tenant quando configurada e fallback
  global da Criate. Segredos por tenant são criptografados com
  `LLM_PROXY_ENC_KEY`.
- Modelos vigentes no código: Assistente interno `xiaomi/mimo-v2.5`; agente
  externo do WhatsApp `N8N_AGENT_MODEL`, padrão
  `google/gemini-2.5-flash`; transcrição/visão
  `google/gemini-2.5-flash-lite`; melhoria de texto
  `openai/gpt-4o-mini`. O ambiente auditado não possui secret
  `N8N_AGENT_MODEL`, portanto usa o padrão versionado.

**Fix — áudio (iOS) e anexo de foto (Android) no Assistente IA (20/07/2026):**
Dois bugs distintos, um por plataforma, no `CommandBar.tsx`:

1. *iOS — transcrição rejeitava com "Dados inválidos.":* `POST
   /api/ai/transcribe` validava o `mimeType` do navegador com um regex
   estrito de allowlist. O Safari iOS reporta o formato de jeito
   imprevisível (`audio/mp4;codecs="mp4a.40.2"`, às vezes com espaço após
   o `;`), caindo direto na falha de schema. A validação estrita de
   formato não protegia nada de real — a proteção efetiva é o payload
   base64 válido + o limite de tamanho. Reescrito `server/routes/ai.ts`:
   o `mimeType` virou dica opcional (sem regex de allowlist); a validação
   passou a ser "é um data URL de áudio + base64 válido"
   (`AUDIO_DATA_URL_HEADER`); e o `format` enviado ao provedor é derivado
   do tipo real do áudio (`resolveAudioFormat`), preferindo o declarado no
   próprio data URL. Não-áudio continua barrado.
2. *Android — seletor de foto não abria (confirmado resolvido em aparelho
   real após 3 tentativas):* o problema tinha duas frentes distintas.
   - **Chrome Android real:** o `<input type="file">` estava com
     `display:none` (acionado por um botão via `.click()` programático, e
     depois por um `<label>`). Testado em campo, o Chrome Android **não
     abre** o seletor de um input `display:none` por nenhum desses
     caminhos. Solução final que funcionou: o input fica **transparente
     por cima do ícone** de clipe (`absolute inset-0 opacity-0`, ícone
     como irmão num wrapper `relative`) — o toque cai direto no próprio
     input, sem `<label>`, sem `.click()`, sem `display:none`. É o padrão
     canônico de upload da web. **Usar o mesmo padrão em qualquer upload
     mobile futuro.**
   - **Navegador embutido do WhatsApp (WebView Android):** não implementa
     o seletor de arquivo — nenhum código abre a galeria lá (no iOS o
     WebView implementa, por isso funcionava no iPhone). O `CommandBar`
     detecta esse ambiente (`/Android/` + marcador `; wv)` no user agent —
     Chrome/Samsung/Firefox/iOS reais não têm) e, ao tocar no clipe,
     mostra a dica "abra no Chrome" em vez de um toque sem efeito.

**Fix — microfone abrindo a galeria no iOS (21/07/2026, resolvido em DUAS
tentativas):** efeito colateral do overlay transparente acima. Relatado
pelo usuário num iPhone 11: tocar no microfone abria o seletor de foto
(menu "Photo Library / Take Photo / Choose Files") em vez de gravar —
falhava ~6 de cada 7 toques.

- *1ª tentativa (errada, mantida por ser inócua):* a hipótese era retenção
  de foco no controle nativo após abrir o seletor uma vez, "corrigida" com
  `key={fileInputResetKey}` remontando o input após cada uso. O usuário
  retestou: continuou falhando (7 tentativas, 1 sucesso) — inclusive SEM
  foto anexada, o que derrubou a hipótese (a correlação "só com foto"
  do primeiro relato era coincidência).
- *Causa real (geométrica):* no iOS, o controle nativo do
  `<input type="file">` ("Choose File" + nome do arquivo) tem **largura
  intrínseca (~110px+)** que o WebKit **não encolhe** pra caber no wrapper
  de 32px — `w-full h-full` define a caixa do elemento, mas o conteúdo
  nativo transborda. O wrapper não tinha `overflow-hidden`, então o
  excedente invisível (opacity-0) cobria o botão de microfone ao lado
  (só 8px de gap) — e, por ser posicionado (`absolute`), o input pinta e
  recebe toque ACIMA do botão estático. O "1 em 7" era o dedo acertando
  além da borda do transbordo.
- *Correção em duas camadas:* `overflow-hidden` no wrapper do clipe (clipa
  pintura E hit-test no limite dos 32px — comentário ⚠️ no código marca
  como obrigatório) + `relative z-10` no botão de microfone (mesmo se
  algum engine vazar hit-area, o mic posicionado com z-index fica acima).
  Zero impacto no padrão Android (sem display:none, sem label, sem
  .click() — tudo preservado).
- *Lição:* overlay `absolute + opacity-0` de input file SEMPRE precisa de
  `overflow-hidden` no wrapper — o controle nativo do iOS não respeita a
  caixa. Validar no iPhone real.

**Fix — campo de mensagem de uma linha só e barra superior sobrepondo no
mobile (21/07/2026):** dois bugs de UI relatados pelo usuário via print.

1. *Campo de mensagem ilegível ao digitar/ditar texto longo:* `CommandBar.tsx`
   usava `<input>` (uma linha, rola na horizontal). Trocado por
   `<textarea rows={1}>` com auto-grow: um `useEffect` em `[value]` lê
   `scrollHeight` e ajusta `style.height`, até `MAX_INPUT_HEIGHT_PX` (144px),
   depois vira scroll interno (`overflowY:auto`). Enter sozinho continua
   enviando (`onKeyDown` com `preventDefault` só quando `!e.shiftKey`);
   Shift+Enter quebra linha. Ditado por voz (`POST /api/ai/transcribe`) grava
   no mesmo estado `value`, então também aciona o auto-grow.
2. *Barra superior sobrepondo (só admin, "ver como" ativo, mobile):* as
   pílulas de persona (Corretor/Imobiliária/Incorporadora) e o botão de
   autonomia ("Piloto automático") não tinham `shrink-0`/`whitespace-nowrap`
   — a soma do conteúdo não cabe na largura de um celular, então o texto
   quebrava linha dentro dos próprios botões e as duas "linhas" resultantes
   se sobrepunham visualmente. Corrigido em `ExperienceShell.tsx`: pílulas
   ganharam `shrink-0 whitespace-nowrap`, o container delas
   `overflow-x-auto` (rola por dentro se ainda não couber), e o botão de
   autonomia esconde o rótulo de texto abaixo de `sm` (`hidden sm:inline`,
   mostra só a bolinha verde + seta no mobile) — nenhuma função foi
   removida, só o texto por extenso.

Sem migration, sem mudança de backend. Confirmação visual real (mobile,
sessão admin) depende do usuário — sem credenciais não há como reproduzir
login nem a visão de admin.

**Autocura do webhook UAZAPI:** `setUazapiWebhook(token, instanceId)` monta o
endpoint exclusivamente com `PUBLIC_APP_URL`. `resolveManagedInstance` devolve
o `instanceId` existente e `POST /api/brokers/whatsapp/connect` reafirma o
webhook canônico a cada conexão. Não existe fallback de origem pública por
secret; links, redirects e webhooks usam a configuração versionada no
`fly.toml`.

**Suporte — áudio e imagem recebidos do cliente no WhatsApp (20/07/2026):**
o inbound `POST /api/wpp-shim/inbound/:instanceId` descartava de propósito
qualquer mensagem cujo `message.type` não fosse `text`. A investigação
read-only de amostras reais em `webhook_logs` confirmou que a UAZAPI entrega
áudio e imagem como `type="media"`, com subtipo em `mediaType` (`ptt` ou
`image`), tipo técnico em `messageType` (`AudioMessage`/`ImageMessage`) e
metadados em `content`. A `content.URL` aponta para mídia criptografada do
WhatsApp e não deve ser usada diretamente.

O caminho confirmado contra a API real é `POST /message/download`, autenticado
com o token da instância e `message.messageid`, pedindo `return_base64=true` e
`return_link=false`. O teste read-only devolveu áudio `audio/mpeg` e imagem
`image/jpeg` em base64. O backend agora:

1. classifica somente áudio/PTT e imagem, mantendo texto e a trava `fromMe`
   intactos e continuando a ignorar recibos e tipos ainda não suportados;
   mídia de grupos também é ignorada para evitar automação/custo fora de uma
   conversa privada de atendimento;
2. baixa e descriptografa a mídia pela UAZAPI, com limites por tipo, sem
   persistir base64 bruto; quando suportado, armazena uma cópia no Storage e
   grava `media_url` para reprodução no chat;
3. reutiliza em `server/services/mediaAi.ts` a mesma transcrição OpenRouter
   usada por `/api/ai/transcribe`; imagens são descritas pelo mesmo modelo
   multimodal, incluindo a legenda quando existir;
4. grava em `imf_conversation_messages` uma representação textual marcada com
   `media_type`, depois repassa ao N8N somente texto (`input_type` informa
   `audio`, `image` ou `text`);
5. em falha de download, formato, cota ou timeout, ainda grava a ocorrência e
   envia ao N8N uma instrução gentil de fallback, evitando silêncio;
6. consulta `provider_message_id` antes do processamento para não cobrar IA
   nem disparar resposta novamente em webhooks repetidos;
7. executa backfill periódico best-effort para mídia histórica que ficou sem
   URL reproduzível e reafirma os webhooks UAZAPI por um guardião separado.

O contrato textual com o N8N continua válido. O QA real deve repetir texto,
áudio, imagem e documento suportado em conversa privada; vídeo, sticker e
mídia de grupos continuam fora do processamento do agente.

**Fix — assistente interno narrando a própria ação em mensagens ao cliente
(21/07/2026):** ao pedir "faça um follow pro X" no Assistente IA
(`server/services/agent.ts`, ação `send_message` — o agente INTERNO do app,
que atende comando do corretor; diferente do agente externo do WhatsApp
documentado acima, que roda no N8N), o texto gerado para o CLIENTE vinha com
metacomentário ("Estou fazendo um follow-up sobre as fotos que você
pediu"), soando robótico e expondo o mecanismo interno pro cliente final. O
system prompt já pedia "natural e cordial" mas não proibia frases
auto-referentes. Adicionada regra explícita + exemplo negativo/positivo no
prompt (linha da ação 6, `send_message`). Validado com chamada real ao
modelo em `autonomy=manual` (ação só proposta, nunca enviada de verdade):
pedido "faça um follow para o hunter" passou a gerar "Oi Hunter, tudo bem?
Estou passando aqui pra saber se você precisa de alguma informação ou se
tem alguma dúvida sobre os imóveis. Estou à disposição!" — sem
metacomentário.

### Divulgação pelo Assistente IA: link da vitrine + envio pra vários contatos

**Implementado em 2026-07-22.** Resolve o caso "envie a minha divulgação/imóveis
pros meus contatos", que antes saía errado (mandava pra 1 contato só, com texto
sem sentido — "minha área de divulgação" — e sem link).

- **Link da vitrine no contexto do assistente (`vitrineUrl`).** `buildSnapshot`
  passou a incluir `vitrineUrl = PUBLIC_APP_URL/vitrine/:brokerId` (mesma URL da
  aba Divulgação) no `Snapshot`. Uma **regra de divulgação** no system prompt
  manda o modelo, quando o corretor pede pra divulgar/compartilhar os imóveis,
  compor uma mensagem-convite ao cliente que **inclui esse link** — e proíbe
  explicitamente falar "minha área de divulgação" ou descrever telas internas.
- **Ação `broadcast_message`** (`server/services/agent.ts` + schema em
  `agentGuardrails.ts`, nas duas uniões). Envia UMA mensagem pra TODOS os
  contatos salvos da conta de uma vez. Sem `phone` no contrato: o destino é
  resolvido no servidor (re-busca `imf_contacts` por `broker_id`), o modelo
  nunca fornece números. Trava anti-abuso: recusa acima de **50 contatos**
  (envio em massa de verdade continua no roadmap, depende do transporte nativo).
- **Confirmação com contagem real.** A UI de confirmação (CommandBar) só mostra
  o `reply`, então para `broadcast_message` o backend **sobrescreve o `reply`**
  em `runAgent` com a contagem verdadeira de contatos (do snapshot) + a prévia
  do texto — o corretor sempre vê pra quantos vai e o quê antes de confirmar.
  Registrada em `CONFIRMABLE_ACTIONS` (`server/routes/agent.ts`).
- **Não pausa a IA.** Diferente de `send_message` (que faz handover), o
  broadcast grava cada envio com `senderType:"ai"` e **não** chama
  `pauseAiForHumanTakeover` — divulgação é disparo proativo; se o contato
  responder, a IA de atendimento continua trabalhando o lead (mesmo espírito do
  follow-up agendado), em vez de jogar todo retorno na fila "aguardando você".

### Ações agendadas do Assistente IA interno (lembrete e follow-up ad-hoc)

**Implementado e publicado em 2026-07-21.**

Duas ações novas em `server/services/agent.ts`, complementares a
`send_message` (que já manda uma mensagem real na hora):

- **`create_reminder`** — "me lembra em 48h/2 dias de fazer follow-up pro
  fulano". Não manda nada ao cliente: cria um evento normal em `imf_agenda`
  (mesma tabela/tela de visitas), com `title` prefixado `"Lembrete: ..."`,
  sem imóvel vinculado e `duration_minutes=15`. Reaproveita 100% a Agenda
  existente — o corretor confere e marca como realizado do mesmo jeito que
  uma visita comum; não existe hoje nenhum sistema de notificação/sino no
  app (confirmado por investigação direta do código), então esta foi a
  forma de o lembrete aparecer pro corretor sem construir um mecanismo novo
  do zero.
- **`schedule_followup`** — "envie em 24h um follow-up pro fulano". Ao
  contrário do lembrete, precisa de execução autônoma de verdade (ninguém
  precisa estar com o app aberto), então grava em
  `imf_agent_scheduled_followups` (tabela nova, migration
  `20260721_agent_scheduled_followups.sql`, aplicada e verificada em
  21/07/2026) e um job de 60s
  (`server/services/agentScheduledFollowups.ts::runScheduledAgentFollowupsTick`,
  registrado em `server.ts` junto dos demais jobs) manda de verdade pelo
  WhatsApp quando o prazo vence, reaproveitando exatamente o mesmo par
  `resolveOutboundInstanceToken`/`sendUazapiText` de `send_message` e do
  Follow-Up Inteligente.
- O texto da mensagem agendada é composto pelo modelo no momento do PEDIDO,
  não no momento do envio — mesmo princípio de segurança de
  `notify_message` (cancelamento/remarcação de visita): o corretor vê
  exatamente o que vai sair antes de confirmar (em autonomia copiloto/
  manual), em vez de uma geração posterior sem revisão humana possível.
- As duas ações aceitam DOIS formatos de "quando", nunca calculados pelo
  modelo — sempre determinístico em código (`resolveDueAt` em `agent.ts`),
  mesmo princípio já usado em `queryAgendaRange` (nunca deixar o modelo
  fazer aritmética de tempo, que ele erra com frequência): (a) prazo
  relativo — `delay_value` (número, ex.: "24", "2", "5") + `delay_unit`
  (`"minutos"|"horas"|"dias"`), calculado por `computeDueAt`; (b) horário
  absoluto — `date`+`time` (o mesmo par de `create_visit`/`update_visit`),
  convertido por `brDateTimeToISO` e validado como estando no FUTURO antes
  de aceitar. `resolveDueAt` tenta (b) primeiro; cai pra (a) se `date`/`time`
  não vierem os dois.
- O job de follow-up agendado reaproveita o lock distribuído genérico
  `try_billing_lock`/`release_billing_lock` (o mesmo mecanismo dos jobs de
  billing e de expiração de reserva PIX — ver `20260630_billing_lock_and_rls.sql`)
  para concorrência segura entre as 2 VMs do Fly. Não precisou de uma RPC de
  claim dedicada como `claim_due_followups` do Follow-Up Inteligente, porque
  aqui não há estado de máquina por conversa pra avançar atomicamente — só
  "está vencido, ainda não foi tentado".
- O envio grava `sender_type='ai'` e **não** chama `pauseAiForHumanTakeover`
  depois — decisão deliberada: trata como um follow-up automático (mesmo
  espírito do Follow-Up Inteligente), não como uma intervenção manual do
  corretor, então não pausa o atendimento da IA pra esse cliente depois do
  envio. Isso é diferente de `send_message` (envio imediato), que grava
  `sender_type='broker_manual'` e pausa a IA, porque ali é literalmente o
  corretor falando na hora através do assistente.
- **Migration aplicada e verificada em 21/07/2026** — consulta pós-migration
  confirmou tabela presente, RLS ativo e a policy criada (as três condições
  retornaram `true`). `schedule_followup` e `create_reminder` estão publicados;
  o segundo usa `imf_agenda`, já existente e com RLS/índices próprios.
- **Bug encontrado e corrigido em produção (21/07/2026):** `delay_unit`
  originalmente só reconhecia `"dias"` explicitamente em `computeDueAt`;
  qualquer outro valor (inclusive `"minutos"`, que o modelo extrai
  corretamente quando o corretor diz "em 5 minutos") caía num `else` que
  tratava como `"horas"`. Relatado pelo usuário ao vivo: pediu "faça um
  follow para o hunter em 5 minutos" às 11:22 e o sistema agendou para
  16:22 (exatamente +5 horas em vez de +5 minutos). Corrigido: `"minutos"`
  virou uma unidade de primeira classe (branch explícito, 60\*1000ms) e
  qualquer `delay_unit` não reconhecido agora faz `computeDueAt` devolver
  `null` — `executeAction` recusa com mensagem honesta em vez de adivinhar
  errado, mesmo princípio já usado no resto do agente (nunca escolher um
  id "parecido" ou uma unidade "provável"). Correção isolada em
  `server/services/agent.ts`; publicada nos commits `7a1db57`+`2378cc3`
  (GitHub Actions run `29839683334` aprovado, smoke HTTP 200).
- **Bug encontrado e corrigido em produção (21/07/2026): horário do relógio
  virava prazo relativo chutado.** Antes de `resolveDueAt` existir,
  `create_reminder`/`schedule_followup` só tinham `delay_value`/
  `delay_unit` — nenhum campo pra uma hora do relógio. Relatado pelo
  usuário ao vivo: pediu "agendar um follow pro Hiago às 16:00" e o sistema
  agendou pra 19:39 (o modelo, sem campo pra hora absoluta, inventou um
  prazo relativo a partir da hora pedida — mesma categoria de erro do bug
  de "minutos" acima, mas por falta de capacidade, não por bug de código).
  Corrigido reaproveitando o par `date`+`time` que `create_visit` já usa
  (nenhum campo novo no `AgentAction`/`JSON_SHAPE_HINT`): `resolveDueAt`
  tenta absoluto primeiro, cai pro relativo se não vier os dois, e sempre
  valida que o resultado é no futuro (a hora do relógio atual nunca é
  exposta no prompt — só a data — então o modelo não tem como saber
  sozinho se um horário de hoje já passou). Durante a implementação, um
  discriminated union por boolean (`{ok:true;...}|{ok:false;...}`) não
  narrava sob este `tsconfig.json` (sem `strict`/`strictNullChecks`) —
  redesenhado pra `{date: Date|null; reason?: ...}`, sem depender de
  narrowing de union.
- As duas ações são acionadas só por linguagem natural no Assistente IA
  (`CommandBar.tsx`, sem novo botão/formulário ali), mas ganharam tela
  própria pra visualizar/gerenciar o resultado: área **Lembretes**
  (`src/experience/LembretesArea.tsx`, registrada em `engine.ts`/
  `ManualRail.tsx`/`ExperienceShell.tsx` e em `AREAS_BY_PERSONA` de
  `agent.ts`, 3 personas). Decisão explícita do usuário (2026-07-21): separar
  de Agenda, não misturar lembrete/follow-up com visita real na mesma tela.
  Lista os lembretes (com "Concluir" — `PATCH .../status:'realizado'` — e
  apagar, reaproveitando os endpoints já existentes de
  `PATCH`/`DELETE /api/agenda/visits/:id`, já que lembrete é só uma linha de
  `imf_agenda`) e os follow-ups agendados (com cancelar enquanto `pending`,
  endpoints novos `GET`/`DELETE /api/agent/scheduled-followups`, ver seção
  10). `create_reminder`/`schedule_followup` passaram a devolver
  `navigate:'lembretes'` (antes: `'agenda'`/nenhum).
- **Sincronização externa da Agenda (2026-08-10):** a Agenda oferece uma
  assinatura privada no padrão iCalendar (`.ics`), compatível com **Google
  Agenda** e **Calendário do iPhone/iCloud**. O endereço é individual por
  usuário: proprietários da conta recebem a agenda consolidada; membros
  recebem somente registros com seu `owner_user_id`. O calendário externo é
  somente leitura — alterações continuam sendo feitas no ImobiFlow e são
  refletidas na próxima atualização do provedor. O token possui 256 bits, é
  localizado por SHA-256 e só possui cópia recuperável criptografada por
  AES-256-GCM; pode ser rotacionado ou revogado na interface. A rota pública
  valida formato e hash, aplica rate limit, retorna somente visitas e limita a
  janela a um ano anterior e três anos futuros. Migration:
  `20260810c_agenda_calendar_feed.sql`.
- Nova coluna `imf_agenda.event_type` (`'visita'|'lembrete'`, `DEFAULT
  'visita'`, migration `20260721c_agenda_event_type.sql`, aplicada e
  verificada) separa lembrete de visita real no banco. Sem isso, todo
  consumidor que assume "toda linha de imf_agenda é uma visita" contaria
  lembrete errado: `buildSnapshot` do Assistente IA ("Próximas visitas" e
  "Visitas neste mês"), `queryAgendaRange`, o resumo de Relatórios
  (`visitsQueryFactory`), o card de KPI do Dashboard 1.0 e
  `GET /api/agenda/n8n/list` (usado pelo agente externo de WhatsApp pra
  decidir horário ocupado/livre) — todos os 5 ganharam
  `.eq('event_type','visita')`. `create_reminder` grava
  `event_type:'lembrete'` explicitamente; nenhum outro INSERT precisou
  mudar (cai no `DEFAULT`). Endpoints por id (`PATCH`/`DELETE
  /api/agenda/visits/:id`, `PATCH`/`DELETE /api/agenda/n8n/:id`,
  `cancel_visit`/`update_visit`) não precisaram de filtro — já operam sobre
  um id específico. `GET /api/agenda/visits` ganhou o parâmetro opcional
  `?event_type=lembrete` (padrão continua `'visita'`, mantendo o
  calendário de sempre sem lembretes).
- **Alerta visual no sino (2026-07-21):** o corretor pediu um jeito de ser
  avisado de lembrete vencido sem precisar entrar na aba. `ManualRail.tsx`
  ganhou `useDueReminderCount` — busca `GET /api/agenda/visits?
  event_type=lembrete` a cada 60s (mesmo intervalo dos jobs de fila) e conta
  quantos têm `status:'pendente'` com `scheduled_at` no passado — e mostra
  um badge vermelho sobre o ícone de sino (desktop e drawer mobile) quando
  a contagem é maior que zero. Falha de rede é silenciosa (o badge é um
  extra cosmético, nunca pode travar a navegação). Reaproveita o endpoint
  já existente — nenhuma rota nova. Só cobre `create_reminder`; não conta
  `schedule_followup` com falha de envio.
- **Alerta por WhatsApp pro próprio corretor (2026-07-21):**
  `server/services/reminderAlerts.ts` — `runReminderWhatsappAlertTick`, job de
  60s registrado em `server.ts` junto dos outros. Busca `imf_agenda` com
  `event_type='lembrete'`, `status='pendente'`,
  `whatsapp_alert_sent_at IS NULL` e `scheduled_at` no passado (até 20 por
  tick), manda `sendUazapiText` (`server/services/uazapi.ts`) usando
  `imf_brokers.notification_phone` (número pessoal, com fallback pro `phone`
  desde 2026-07-21 — evita auto-envio) a partir do `uazapi_instance_token` e
  marca `whatsapp_alert_sent_at` pra não reenviar. Lock com `try_billing_lock`/
  `release_billing_lock` (mesmo padrão de `agentScheduledFollowups.ts`).
  Falha não marca nada — tenta de novo no próximo tick; sem estado "failed"
  separado (escopo baixo risco, complementar ao badge visual).
  Migration `20260721f_reminder_whatsapp_alert.sql` adiciona a coluna.
  **Limitação conhecida:** sempre usa o telefone/instância da CONTA, nunca a
  instância própria de um membro (`imf_broker_members.whatsapp_mode='own'`) —
  não existe telefone do membro salvo no schema (só o instance_token, usado
  historicamente só pra decidir de qual instância RESPONDER um cliente).
  Numa conta com membro em modo "own", o alerta cai no titular, não em quem
  criou o lembrete.
- **Notificação de visita marcada pela IA de atendimento (2026-07-21):**
  quando o cliente agenda uma visita conversando com a IA no WhatsApp
  (`POST /api/agenda/n8n/create`, autenticado por `INTERNAL_PROXY_TOKEN`), o
  corretor não está no loop e precisa ser avisado. Duas vias, escolhidas pelo
  usuário: badge dentro do app **e** WhatsApp num número pessoal.
  Migration `20260721g_visit_broker_notification.sql` (aplicada manualmente)
  adiciona `imf_agenda.booked_by_chatbot` (bool), `broker_seen_at`,
  `whatsapp_notified_at` e `imf_brokers.notification_phone`, mais um índice
  parcial pro job.
  - `booked_by_chatbot` é coluna própria em vez de reaproveitar `source`
    (que já grava `'ia'` tanto pra visita do N8N quanto pra do Assistente
    IA in-app) — assim os filtros/relatórios que agrupam por `source` não
    mudam. Só `POST /api/agenda/n8n/create` seta `true`; o Assistente in-app
    e a criação manual não setam (ali o corretor já vê a visita na tela).
  - **Badge in-app:** `ManualRail.tsx` ganhou `useNewChatbotVisitCount(active)`
    — busca `GET /api/agenda/visits` a cada 60s e conta as com
    `booked_by_chatbot && !broker_seen_at`, mostrando badge vermelho no ícone
    da Agenda (desktop + drawer). Ao abrir a Agenda (`active==='agenda'`) chama
    `POST /api/agenda/visits/mark-chatbot-seen` (novo, seta `broker_seen_at`
    em lote, respeitando escopo titular/membro) e zera o badge na hora. Falha
    de rede silenciosa. `badgeFor(key)` centraliza a escolha lembrete×agenda.
  - **WhatsApp:** `server/services/visitAlerts.ts` —
    `runVisitWhatsappAlertTick`, job de 60s em `server.ts`. Busca
    `booked_by_chatbot`, `whatsapp_notified_at IS NULL`, `scheduled_at >= now()`
    (até 20/tick), manda `sendUazapiText` pro `imf_brokers.notification_phone`
    a partir da instância da conta, marca `whatsapp_notified_at`. Sem
    `notification_phone` configurado, marca como resolvida (o badge cobre) em
    vez de reprocessar toda hora; falha de ENVIO não marca (retry no próximo
    tick). Lock `visit_whatsapp_alerts` (mesmo padrão dos outros jobs).
  - **Por que um número pessoal separado:** a instância UAZAPI é o número
    comercial que a IA usa pra falar com o cliente; um número não notifica a
    si mesmo de forma confiável pelo WhatsApp. `notification_phone` (novo
    campo em Config → Seu perfil, `GET /api/brokers/me` +
    `POST /api/brokers/settings`, whitelisted e normalizado, vazio→NULL) é o
    número pessoal de destino. A UI avisa pra usar um número diferente do
    comercial. Vazio = só badge in-app. Mesma limitação titular×membro do
    alerta de lembrete.

### Asaas e limite do escopo financeiro

O produto separa dois fluxos financeiros:

1. **Assinatura do ImobiFlow:** sempre usa `ASAAS_API_KEY` global da Criate.
   O valor não é mais fixo: `SUBSCRIPTION_VALUE` + `member_limit × MEMBER_WHATSAPP_SLOT_PRICE`
   (WhatsApp próprio de equipe, self-service — ver seção 5/Equipe). O job
   horário de excedente (`prepareOverageBilling`) resincroniza esse valor no
   Asaas antes de cada renovação, então mudar `member_limit` não precisa
   chamar o Asaas na hora — a cobrança nova entra sozinha no próximo ciclo.
2. **Dinheiro do cliente da imobiliária/incorporadora:** a implementação
   histórica de aluguel e sinal PIX permanece preservada, mas bloqueada no
   backend e escondida no frontend por padrão.

Não existe fallback para a conta global da Criate nesse segundo fluxo. Se as
flags forem habilitadas futuramente, o backend exige uma conta Asaas própria
válida da imobiliária/incorporadora; sem ela responde
`CLIENT_ASAAS_ACCOUNT_REQUIRED` e não cria cobrança. A interface também oculta
os comandos financeiros. O ImobiFlow apenas poderia sincronizar o status da
cobrança externa, sem custodiar saldo ou executar repasses.

`CLIENT_FINANCIAL_OPERATIONS_ENABLED` e
`VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED` precisam ser explicitamente `true`
para reativar os dois lados. No estado normal, novas cobranças de aluguel,
reservas PIX e alterações da chave Asaas do cliente recebem bloqueio de
produto. Leitura histórica, contratos, reservas sem cobrança, documentos e
billing da assinatura continuam funcionando.

Em 17/07/2026, esta desativação foi publicada na produção V2 pelo commit
`e63ce86` e pela release Fly **v87**. A imagem ativa é
`registry.fly.io/imobiflow-v2:deployment-01KXR5C1SYXWKKWDFH6ZW8RYZ8`, com
manifesto `sha256:e731425d992d2ba1bc0ddc26c6ae2eea2804d1fd07f09485be8a7c5201688e4c`.

A estrutura de chave própria continua criptografada no banco apenas para
compatibilidade/reversibilidade; ela não aparece na Config enquanto a flag do
frontend estiver desligada.

### Landing page pública do imóvel (`src/pages/PropertyLanding.tsx`)

Página pública em `/p/:slug` (sem autenticação). Até 5 seções alternadas
foto+texto (`sectionMeta`: Sobre o Imóvel/Detalhes/Diferenciais/Experiência/
Exclusividade), uma por foto destacada (`featuredImages`, até 5). O texto de
cada seção vem de `descParagraphs` — a `description` do imóvel dividida por
quebra dupla de linha (ou quebra simples seguida de maiúscula).

O modal "Agendar Visita" grava um lead (`POST /api/leads`, status
`visita`) com o horário de preferência do cliente na nota. Esse campo de
horário usa `<input type="datetime-local">` (calendário + relógio nativos,
desktop e mobile) com `min` = agora (bloqueia passado); antes era texto
livre. O valor (`"YYYY-MM-DDTHH:mm"` no fuso local do cliente) é formatado
pra pt-BR ("22/07/2026 às 15:00") antes de ir pra nota. O lead NÃO agenda
nada em `imf_agenda` automaticamente — é só a preferência do cliente pro
corretor combinar depois.

**Fix — foto falsa de corretor na landing (21/07/2026):** a seção "Seu
Corretor" (e o modal "Saiba Mais") usava uma foto de banco de imagens
(Unsplash, um homem aleatório) como fallback quando o corretor não tinha
foto configurada no perfil — apresentava o rosto de um estranho como se
fosse o corretor real (relatado pelo usuário via print). O fallback agora
é um monograma com a inicial do nome, no mesmo estilo visual da seção
(gradiente escuro + serifa), nos dois pontos de render. Foto real continua
sendo configurada no perfil do Dashboard 1.0 ("Carregar Foto" →
`broker_address.photoUrl`); quando existe, aparece normalmente. Os textos
padrão de bio/título ("Principal Broker" etc.) foram mantidos — são
genéricos, não identificam ninguém; só a foto era enganosa.

**Fix — dados cadastrados (quartos, banheiros, piscina...) sumidos da
landing (21/07/2026):** relatado pelo usuário via print: a landing mostrava
só título/preço/descrição — a faixa de specs, as tags de característica e
os mini-stats não apareciam, mesmo com o formulário de edição exibindo tudo
preenchido. Causa: desde a modularização do backend (`8443173`),
`GET /api/properties/:slug` separa o bloco `---DETALHES-GERADOS---` da
descrição NO SERVIDOR e devolve o JSON já parseado no campo `details` — mas
a landing (que nasceu antes disso) continuava parseando o bloco de dentro
da `description`, que passou a chegar sempre limpa → `extraData` ficava
`{}` → quartos/banheiros/área viravam 0 e toda a UI condicionada a `> 0`
sumia. O formulário de edição não sofria porque `CarteiraArea.tsx` espalha
`...details` ao abrir (`{...editing, ...(editing.details || {})}`).
Correção: a landing agora usa `property.details` como fonte primária e
mantém o parse inline da description só como fallback pra resposta antiga
que ainda embuta o bloco. Verificado contra o payload real de produção do
imóvel do print (`details` presente com `quartos:4, banheiros:4,
piscina:"Sim", varanda_gourmet:"Sim"` — confirmando de quebra que a
extração estruturada do `create_property` ditado por voz já funcionava; o
elo quebrado era só a exibição).

**Fix — texto duplicado em todas as seções (21/07/2026):** relatado pelo
usuário via print (a mesma descrição aparecia em "Sobre o Imóvel",
"Detalhes", "Experiência" e "Exclusividade", palavra por palavra). Causa: o
fallback era `descParagraphs[i] || descParagraphs[0] || cleanDescription` —
quando a descrição não tem quebra de parágrafo (`descParagraphs.length ===
1`, o caso mais comum: descrição ditada por voz pro Assistente IA sai como
um bloco de fala contínuo, sem `\n\n`), TODA seção sem parágrafo próprio
caía pro parágrafo 0 inteiro, repetindo o texto completo 4-5 vezes.
Corrigido: só a seção 0 ("Sobre o Imóvel") usa esse fallback; as seções 1-4
só mostram texto se tiverem parágrafo PRÓPRIO (`descParagraphs[i]`), senão
ficam sem parágrafo de corpo — heading, tag e o conteúdo extra que já
existia por seção (tags de característica na seção 0, mini-stats na seção
1, botões de CTA nas seções 2+) continuam aparecendo normalmente. Sem
mudança de backend, sem migration. Verificado simulando a transformação com
o texto real do print do usuário (fora do repo, não parte do código); não
foi possível abrir o Browser pane nesta sessão pra QA visual ao vivo.

## 7. Lançamentos — fases entregues

### Fase 1 — simulador

- cadastro de empreendimento e unidades;
- simulação de entrada, prazo e parcelas;
- estados de disponibilidade da unidade.

### Fase 2 — reserva financeira (implementada, atualmente desativada)

- reserva de unidade com sinal PIX no Asaas;
- unicidade de reserva ativa por unidade;
- idempotência e expiração automática;
- webhook confirma pagamento;
- cobrança usa a credencial Asaas resolvida para o broker.

O fluxo acima foi preservado para histórico, mas novas chamadas são bloqueadas
pela flag de operações financeiras de clientes. O caminho vigente é **Reservar
unidade**, sem criação de cobrança.

### Fase 3 — documentos e gate de venda

- checklist de documentos por reserva;
- upload em bucket privado `imf-reservation-documents`;
- status `pendente`, `enviado`, `aprovado` e `rejeitado`;
- download por URL assinada após autorização;
- trilha de envio e revisão;
- venda bloqueada quando existem documentos não aprovados;
- compatibilidade: reserva sem nenhum documento continua vendável.

As migrations `20260716c_reservation_documents.sql`,
`20260716d_report_period_metrics.sql` e
`20260716e_broker_asaas_key.sql` foram registradas como aplicadas manualmente.
Mesmo assim, o QA autenticado da Fase 3 ainda precisa cobrir isolamento entre
tenants e todo o ciclo rejeitar → reenviar → aprovar → vender.

## 8. Relatórios — definição das métricas

O endpoint é `GET /api/relatorios/summary?months=3|6|12`. A janela começa em
00:00 de São Paulo no primeiro dia do primeiro mês incluído e termina no
instante da consulta.

| Métrica | Definição |
| --- | --- |
| Leads captados | `created_at` dentro da janela |
| Leads por mês | mesma coorte agrupada pelo mês de criação |
| Distribuição no funil | estágio atual da coorte, não histórico de transições |
| Negócios fechados | `closed_at` na janela, mesmo se captado antes |
| Conversão | captados na janela que fecharam na janela ÷ captados na janela |
| VGV vendido | soma de `imf_units.price_cents` com `sold_at` na janela |
| Aluguéis recebidos | pagamentos `paid` com `paid_at` na janela; titular apenas |
| Carteira mensal ativa | soma atual dos contratos ativos; é snapshot, não acumulado |
| Visitas realizadas | agenda com status `realizado` na janela |
| Visitas válidas | eventos não cancelados e não futuros na janela |

O resumo é determinístico e não é calculado por LLM. Para membros, leads,
fechamentos, vendas e visitas são filtrados pelo usuário. `sold_at` é mantido
por trigger e pelos caminhos da interface/agente; o backfill histórico usa
`updated_at`/`created_at` como estimativa para vendas anteriores à migration.

## 9. Modelo de dados essencial

| Domínio | Tabelas principais |
| --- | --- |
| Conta/equipe | `imf_brokers`, `imf_broker_members`, `imf_broker_invites` |
| Imóveis/leads | `imf_properties`, `leads`, `imf_contacts` |
| CRM (pipelines) | `imf_crm_pipelines`, `imf_crm_pipeline_stages` (+ `leads.pipeline_id`/`pipeline_stage_id`) — schema-base e hardening `20260720b` aplicados e verificados |
| Agenda | `imf_agenda` (coluna `event_type` `'visita'|'lembrete'` — migration `20260721c` aplicada e verificada) |
| Conversas | `imf_conversation_tickets`, `followup_conversations`, `imf_conversation_messages`, `imf_conversation_tags`, `imf_conversation_tag_links`, `imf_conversation_notes` |
| Locação | `imf_rental_tenants`, `imf_rental_contracts`, `imf_rental_payments`, `imf_rental_payment_receipts` |
| Lançamentos | `imf_developments`, `imf_units`, `imf_unit_reservations`, `imf_reservation_documents` |
| Billing SaaS | assinaturas, uso/excedentes, `imf_billing_lock`, `imf_billing_reconciliations` |
| Agente | `broker_agents`, `imf_agent_log` (histórico do assistente interno) e `imf_agent_scheduled_followups` (follow-up ad-hoc agendado — aplicada e verificada, código publicado) |
| Auditoria | `webhook_logs` com retenção operacional de 90 dias |

O schema real inclui estruturas históricas criadas antes das migrations
versionadas. Antes de escrever uma migration, conferir tanto os SQLs do repo
quanto o schema efetivo no Supabase.

## 10. Superfície da API

Os routers são montados diretamente em `server.ts`. Grupos principais:

- `/api/auth/*`: cadastro, login, refresh, reset e entrada em equipe;
- `/api/brokers/*`: perfil, agente, termos, WhatsApp, Asaas e foto;
- `/api/properties/*`, `/api/leads/*`, `/api/agenda/*`, `/api/contacts/*`;
- `/api/crm/*`: pipelines e etapas do CRM (schema-base e hardening aplicados e verificados, ver seções 6/14);
- `/api/conversas/*` e `/api/wpp-shim/*`;
- `/api/followup/*`, `/api/ai/*`, `/api/agent/*`, `/api/proxy/llm`;
- `/api/locacao/*`, `/api/lancamentos/*`, `/api/financeiro/*`;
- `/api/equipe/*`, `/api/relatorios/*` e `/api/dashboard/*`;
- `/api/checkout`, `/api/subscription`, `/api/billing/*` e webhooks Asaas;
- `/api/admin/*`: administração global protegida por `requireAdmin`;
- `/api/vitrine/*` e páginas públicas de imóveis/lançamentos.

Rotas destinadas a N8N ou webhooks não usam o JWT de usuário, mas devem
validar o segredo/tipo de autenticação próprio da integração. Ao criar endpoint
novo, não copiar uma rota pública como modelo para uma operação autenticada.

## 11. Segurança e operação

Controles existentes:

- JWT Supabase validado no backend, com cache curto de 60 segundos;
- `requireUser`, `requireAdmin`, resolução de tenant e checagens de posse;
- RLS e policies nas tabelas migradas, além do filtro explícito do servidor;
- Helmet, HSTS, frame protection, `nosniff` e Permissions-Policy;
- CSP em **report-only**, reportando em `/api/csp-report`;
- `Cache-Control: no-store` em toda `/api`;
- limite global de JSON/urlencoded em 10 MB;
- rate limit em autenticação, checkout, IA e webhooks;
- Redis ativo para rate limit distribuído entre as Machines web; a integração
  usa PING real, timeouts curtos, preferência IPv6 no host Upstash/Fly e
  fail-open para uma indisponibilidade não derrubar a API;
- validação Zod em fluxos críticos;
- Assistente interno com dados variáveis fora do `system prompt`, encapsulados
  em `UNTRUSTED_ACCOUNT_CONTEXT`; saída do modelo e confirmação passam por
  schema Zod discriminado/estrito em `server/security/agentGuardrails.ts`;
- nenhuma mutação proposta pela IA é autoexecutada: mesmo o modo piloto exige
  confirmação humana; leitura, navegação e consulta de agenda continuam
  automáticas;
- criptografia AES-256-GCM para chaves OpenRouter/Asaas por tenant;
- Storage privado e URL assinada para documentos de reserva;
- idempotência e reconciliação nos fluxos de cobrança;
- Sentry ativo com `sendDefaultPii: false`, sem variáveis locais ou tracing;
  antes do envio são removidos usuário, extras, corpo, query, cookies,
  cabeçalhos, IP e breadcrumbs de console. Logs de webhook têm retenção de
  90 dias.

Pendências de segurança/infraestrutura:

- dependências corrigidas em 20/07/2026 com upgrades compatíveis no lockfile e
  `tsx` 4.23.1; `npm audit` online passou com **0 vulnerabilidades**. Repetir o
  audit periodicamente e antes de lançamento;
- observar relatórios reais da CSP e, após QA, decidir a passagem de
  `reportOnly: true` para bloqueio;
- testar em staging o rate limit distribuído, o fail-open do Redis e a
  capacidade real das três Machines web;
- confirmar rotação, mínimo privilégio e presença de todos os secrets no Fly;
- fazer testes de isolamento com dois tenants reais e titular/membro;
- ampliar a suíte automatizada recém-criada para rotas, isolamento multi-tenant
  e integrações; o gate inicial cobre concorrência/lifecycle dos jobs e
  invariantes de topologia.
- persistir propostas de ação no servidor e confirmar por ID de uso único/TTL,
  em vez de confiar no objeto devolvido pelo navegador;
- restringir o proxy LLM do N8N por rota/modelo/campos e executar corpus de
  prompt injection em staging com OpenRouter, UAZAPI e N8N simulados.

## 12. Jobs em background

| Job | Intervalo | Função |
| --- | --- | --- |
| Inbox/outbox do WhatsApp | 1 s (configurável) | processa mensagens e entrega eventos ao N8N no process group `worker` |
| Follow-Up | 60 s | dispara a sequência configurada |
| Follow-up agendado (Assistente IA) | 60 s | manda o WhatsApp de `schedule_followup` cujo prazo já venceu |
| Alerta de lembrete | 60 s | notifica o corretor sobre lembrete vencido |
| Alerta de visita da IA | 60 s | notifica o corretor sobre visita marcada pelo chatbot |
| Preparação de excedentes | 1 h + boot | prepara cobrança do próximo ciclo |
| Reconciliação financeira | 5 min + boot | reprocessa intenções monetárias pendentes |
| Expiração de reserva PIX | 60 s + boot | libera reservas vencidas e cancela cobrança |
| Retenção de webhook logs | 24 h + boot | remove logs com mais de 90 dias |
| Cobrança de aluguel — geração | 1 h + boot | gera competência idempotente no D-5 |
| Cobrança de aluguel — régua | 30 min | executa a comunicação configurada com o inquilino |
| Alerta de chave em atraso | 15 min + boot | avisa sobre devolução de chave vencida |
| Retenção das filas | 6 h + boot | remove linhas resolvidas para conter índices e histórico operacional |
| Guardião de webhook | 3 min + boot | reafirma os webhooks UAZAPI das instâncias |
| Expiração de ação do WhatsApp Pai | 60 s + boot | remove confirmação pendente vencida |
| Expiração de fotos do WhatsApp Pai | 5 min + boot | remove staging de foto abandonado |
| Expiração de documentos do WhatsApp Pai | 5 min + boot | remove contexto documental abandonado |
| Backfill de mídia recebida | 30 min + boot | recupera URL reproduzível de mídia histórica incompleta |

A inbox/outbox roda exclusivamente em `webhook-worker.ts` e pode usar múltiplas
Machines porque os claims usam `FOR UPDATE SKIP LOCKED`, lease e partição por
conversa. Os 17 jobs rodam em `scheduler-worker.ts`, numa Machine singleton,
com prevenção local de sobreposição e drenagem no SIGTERM. `server.ts` não
registra schedulers. A produção possui três web; o grupo worker tem uma ativa
e uma standby parada. Ver `SCALABILITY_TEST_PLAN.md` antes de alterar escala.

## 13. Variáveis de ambiente

### Obrigatórias para o servidor

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_ANON_KEY` no build do frontend
- `PUBLIC_APP_URL` (origem pública única e canônica)

### Por integração

- Asaas: `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`,
  `SUBSCRIPTION_VALUE`, `PLAN_INCLUDED_TICKETS`, `PLAN_OVERAGE_PRICE`;
- limite de produto: padrão genérico com
  `CLIENT_FINANCIAL_OPERATIONS_ENABLED=false` e flag Vite `false`; o deploy V2
  de homologação usa ambas `true` com `CLIENT_FINANCIAL_SANDBOX_ONLY=true`;
- UAZAPI: `UAZAPI_HOST`, `UAZAPI_TOKEN`, `UAZAPI_PLATFORM_SESSION`;
- N8N/IA: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `N8N_AGENT_MODEL`,
  `OPENROUTER_N8N_MODELS`, `INTERNAL_PROXY_TOKEN`,
  `INTERNAL_PROXY_TOKEN_PREVIOUS`, `LLM_PROXY_ENC_KEY`,
  `OPENROUTER_API_KEY`;
- fila: `WEBHOOK_INBOX_BATCH_SIZE`, `WEBHOOK_OUTBOX_BATCH_SIZE`,
  `WEBHOOK_QUEUE_MAX_ATTEMPTS`, `WEBHOOK_WORKER_POLL_MS`;
- operação: `REDIS_URL`, `SENTRY_DSN`, `NODE_ENV`.

Em 27/07/2026, os nomes de secrets do Fly confirmaram Supabase, UAZAPI, Asaas,
N8N, proxy LLM, criptografia, `REDIS_URL` e `SENTRY_DSN`. Não havia
`N8N_AGENT_MODEL` nem `N8N_WEBHOOK_TOKEN`; o agente N8N usa o modelo padrão do
código e o token da entrada do webhook usa o fallback temporário
`INTERNAL_PROXY_TOKEN`. A origem pública permanece somente no
`PUBLIC_APP_URL` versionado. O valor do DSN nunca deve ser documentado.

`server/config.ts` aceita a URL Supabase pública como fallback conhecido, mas
recusa iniciar sem `SUPABASE_SERVICE_ROLE_KEY`. Não criar fallback `VITE_*`
para a service role: prefixos Vite podem ser expostos ao navegador.

## 14. Migrations e estado do banco

Migrations mais recentes confirmadas manualmente no histórico:

| Migration | Estado registrado | Dependência funcional |
| --- | --- | --- |
| `20260716a_billing_reconciliation.sql` | aplicada | reconciliação de billing |
| `20260716b_performance_indexes.sql` | aplicada | índices e retenção |
| `20260716c_reservation_documents.sql` | aplicada | Fase 3 e bucket privado |
| `20260716d_report_period_metrics.sql` | aplicada e verificada | `sold_at`, índice, trigger e Relatórios |
| `20260716e_broker_asaas_key.sql` | aplicada | chave Asaas por conta |
| `20260717_conversation_ticket_cycles.sql` | aplicada e verificada | UUID por ticket e histórico separado por ciclo |
| `20260717b_crm_pipelines.sql` | aplicada | pipelines/etapas do CRM; código dependente (`/api/crm/*`, `PATCH /api/leads/:id/stage`) deployado na release v94 |
| `20260720_crm_pipelines_broker_cascade.sql` | aplicada e verificada | corrige exclusão de conta pelo admin (CASCADE em `imf_crm_pipelines`/`imf_crm_pipeline_stages`) — ver seção 6 |
| `20260720b_crm_security_hardening.sql` | aplicada e verificada | restringe RPCs à `service_role`, valida reorder e torna mutações críticas do CRM transacionais |
| `20260721e_prepare_native_whatsapp_schema.sql` | aplicada e verificada em 21/07/2026 | adiciona/backfill `source_ticket_id` e cria a RPC exclusiva `claim_due_followups_v2`, preservando o contrato compartilhado da V1 |
| `20260721_agent_scheduled_followups.sql` | aplicada e verificada | tabela `imf_agent_scheduled_followups` do follow-up ad-hoc agendado (ação `schedule_followup` do Assistente IA interno) |
| `20260721c_agenda_event_type.sql` | aplicada e verificada | coluna `imf_agenda.event_type` (`'visita'|'lembrete'`) — separa lembrete de visita real pra não contaminar contagens (ver seção "Ações agendadas do Assistente IA interno") |
| `20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql` | aplicada e verificada | corrige coluna ambígua em `imf_crm_ensure_default_pipeline` que derrubava 100% das chamadas de `GET /api/crm/pipelines` (ver seção "CRM: pipelines e etapas") |
| `20260721f_reminder_whatsapp_alert.sql` | aplicada e verificada em 22/07/2026 | coluna `imf_agenda.whatsapp_alert_sent_at` — marca lembrete já alertado por WhatsApp |
| `20260721g_visit_broker_notification.sql` | aplicada e verificada em 22/07/2026 | flags de visita do chatbot, one-shot do WhatsApp e telefone pessoal de notificação |
| `20260722a_n8n_agenda_guardrails.sql` | versionada; aplicação não confirmada nesta auditoria | reduz exposição e restringe operações de agenda usadas pelo N8N |
| `20260724_scale_hot_path_indexes.sql` | versionada; aplicação não confirmada nesta auditoria | índices dos hot paths de escala e filas |
| `20260803_account_capability_overrides.sql` | aplicada e verificada pelo usuário em 03/08/2026 | combinações de Locação/Lançamentos/Financeiro/Equipe por conta |
| `20260803b_rental_contract_management.sql` | aplicada manualmente pelo usuário em 03/08/2026 | termos completos de locação, competências mensais e recebimentos externos transacionais |
| `20260803c_rental_tenants.sql` | aplicada manualmente pelo usuário em 03/08/2026 | cadastro reutilizável de inquilinos, backfill de contratos e defesa de vínculo entre contas |
| `20260804_rental_autopilot.sql` | aplicada e verificada em 10/08/2026 | cobrança autônoma, eventos, configurações da IA e tabela de controle de chaves |
| `20260807e_whatsapp_pai_staged_documents.sql` | aplicada e verificada | contexto temporário e isolado de documentos recebidos pelo WhatsApp Pai |
| `20260807f_whatsapp_pai_release_hardening.sql` | aplicada e verificada | recuperação idempotente de confirmação, mídia e ativação explícita do webhook |
| `20260807g_whatsapp_phone_verification_conflict_fix.sql` | aplicada e verificada | remove ambiguidade da RPC de verificação do telefone Pai |
| `20260807h_whatsapp_pai_internal_conversation.sql` | aplicada e verificada | mantém o número Pai apenas no Assistente IA e recupera mídia no histórico |
| `20260810a_agent_conversation_reset.sql` | aplicada e verificada em 10/08/2026 | reset transacional do histórico/contexto pessoal do Assistente IA |
| `20260810c_agenda_calendar_feed.sql` | pronta para aplicação | link privado e revogável de assinatura da Agenda no Google/iPhone |
| `20260810d_property_keys_hardening.sql` | aplicada e verificada em 10/08/2026 | RLS, revogação do acesso direto e integridade dos novos registros de retirada/devolução |

A verificação de `20260716d` confirmou coluna, índice e trigger presentes e
zero unidades vendidas sem `sold_at`. A execução manual do SQL não substitui a
checagem do ambiente antes de um novo deploy.

`20260717b_crm_pipelines.sql` foi aplicada manualmente no Supabase da branch
`v2` em 17/07/2026, antes da release v94. O código de criação de lead ainda
degrada com segurança (cai no fluxo antigo, sem pipeline) caso as tabelas do
CRM não existam num ambiente futuro — ver `resolveNewLeadStage` em
`server/services/crmPipelines.ts`.

`20260720_crm_pipelines_broker_cascade.sql` foi aplicada manualmente no
Supabase da branch `v2` em 20/07/2026. Verificada com um teste descartável
(broker + pipeline + etapa criados via service_role, depois `DELETE FROM
imf_brokers` — mesma chamada que `admin.ts` faz): sem erro de FK, e
pipeline/etapa confirmados removidos junto, atomicamente. `DELETE
/api/admin/brokers/:id` está restaurado pra qualquer conta, inclusive as
que já têm pipeline criado.

`20260720b_crm_security_hardening.sql` foi executada manualmente pelo usuário
em 20/07/2026. A consulta pós-migration confirmou as seis funções presentes,
`search_path=public`, cinco RPCs `SECURITY DEFINER`, `EXECUTE=false` para
`anon`/`authenticated`, `EXECUTE=true` para `service_role` nas RPCs e trigger
`trg_imf_sync_lead_pipeline_stage` instalado; todas as seis linhas retornaram
`resultado=OK`. O código foi publicado no commit `84497c3` pelo workflow
automático da branch `v2`; o QA funcional autenticado do CRM permanece
pendente. O
arquivo usa `BEGIN`/`COMMIT`: qualquer erro durante a aplicação desfaz o bloco
completo, evitando hardening parcial.

`20260721_agent_scheduled_followups.sql` foi executada manualmente pelo
usuário em 21/07/2026. A consulta pós-migration confirmou as três condições:
tabela `imf_agent_scheduled_followups` presente, RLS ativo
(`relrowsecurity=true`) e a policy `broker_own_agent_scheduled_followups`
criada. O código dependente (`schedule_followup`) já foi publicado e o job
correspondente roda no scheduler singleton.

## 15. Pendências e critérios de lançamento

### Bloqueadores antes de credenciais reais

- Confirmar operacionalmente a `UAZAPI_PLATFORM_SESSION`; sem ela,
  recuperação de senha por WhatsApp não envia mensagem.
- Separar `N8N_WEBHOOK_TOKEN` de `INTERNAL_PROXY_TOKEN` e confirmar Header Auth,
  credenciais, isolamento de memória e deduplicação no workflow N8N.
- Confirmar manualmente a aplicação das migrations `20260722a` e `20260724`.
- Não trocar `ASAAS_ENV`/chaves reais antes do QA completo em sandbox.
- Repetir a conferência de commit/release antes do lançamento; em 27/07/2026 o
  baseline funcional estava no commit `4ee40d6`, release `v185`.

### QA autenticado obrigatório

1. Repetir os fluxos nas três personas: corretor, imobiliária e incorporadora.
2. Usar pelo menos dois tenants e, em um deles, titular + membro.
3. Provar ausência de vazamento em imóveis, leads, agenda, conversas, contatos,
   relatórios, equipe, locação, financeiro, lançamentos e documentos.
4. Validar WhatsApp: autocura, QR, código, disconnect, troca de número,
   compartilhado e instância própria de membro.
5. Validar Assistente IA separado da Config, os três Follow-Ups e o inbound
   WhatsApp com texto, áudio/PTT, imagem e fallback de falha de mídia.
6. Em Conversas, encerrar um ticket e enviar nova mensagem pelo mesmo número;
   confirmar UUID novo, histórico separado e impossibilidade de reabrir ou
   responder no ticket encerrado.
7. Validar Asaas próprio em sandbox: salvar, mascarar, trocar, remover e
   confirmar que aluguel/reserva usam exclusivamente a conta própria; sem ela,
   devem responder `CLIENT_ASAAS_ACCOUNT_REQUIRED`. A assinatura deve continuar
   na conta global da Criate.
8. Validar Lançamentos Fase 3: upload, autorização, URL assinada, rejeição,
   reenvio, aprovação e bloqueio/liberação da venda.
9. Conferir manualmente cada métrica de 3/6/12 meses com dados conhecidos para
   titular e membro.
10. Fazer smoke de `/`, `/app`, login, pagamento, admin, páginas públicas e
   responsividade desktop/mobile.
11. Inspecionar logs, CSP reports, Sentry, jobs e webhooks sem erro.

O Sentry deixou de ser pendência de implantação em 27/07/2026: o secret está
ativo na Fly, o evento artificial sem dados de clientes chegou ao painel, foi
inspecionado e marcado como resolvido. A tela `is:unresolved` ficou vazia após o
teste, como esperado.

### Testes funcionais da IA — planejados (roteiro definido em 20/07/2026)

Cenários ponta a ponta pra validar o agente de IA em uso real. O recebimento
de texto e a captura dos webhooks reais de áudio/imagem foram confirmados; a
resposta multimodal abaixo precisa de repetição após o novo deploy:

- [ ] **Teste 1 — cadastro assistido por IA:** usuário manda fotos e fala a
  descrição do imóvel; o app cadastra o imóvel e gera o site; IA responde
  corretamente perguntas feitas sobre esse imóvel específico.
- [ ] **Teste 2 — atendimento a partir de anúncio:** cliente vê o anúncio,
  pergunta disponibilidade e manda print (imagem) do anúncio; IA precisa
  compreender o print e conduzir o atendimento.
- [ ] **Teste 2B — áudio no WhatsApp:** cliente envia PTT; Conversas deve
  registrar `[Áudio]` com a transcrição e a IA deve responder ao conteúdo.
- [ ] **Teste 2C — fallback:** indisponibilidade simulada/real do provedor não
  pode deixar o cliente em silêncio; a conversa deve registrar a mídia e a IA
  pedir confirmação por texto.
- [ ] **Teste 3 — follow-up:** pedir pra IA lembrar de fazer follow-up, ou
  confirmar que ela mesma dispara sozinha (conforme configuração ativa).

### Checklist técnico por alteração

```powershell
npm test
npx knip
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Na branch `v2`, o checklist acima roda **antes do commit**: `git push origin
v2` publica sozinho via GitHub Actions (seção 1), sem revisão manual depois.
Migrations continuam exigindo aplicação manual à parte (nunca automática).
Depois do push: conferir o run em `gh run list --workflow=deploy-v2.yml` (ou
a aba Actions no GitHub) e o smoke HTTP, e guardar release/commit/smoke no
histórico.

## 16. Limpeza de código morto — 2026-07-17

Knip foi adicionado como dependência de desenvolvimento e configurado em
`knip.json` para analisar `server/**/*.ts` e `src/**/*.{ts,tsx}`. As raízes de
entrada continuam descobertas pelos scripts do pacote e pelo Vite.

Remoções de confiança alta, verificadas manualmente:

- arquivo legado `src/lib/supabase.ts`, sem importações;
- dependência `@anthropic-ai/sdk`, sem uso;
- `autoprefixer`, sem configuração PostCSS nem referência;
- cópia duplicada de `vite` em `devDependencies`; a dependência viva foi
  preservada em `dependencies`;
- export público desnecessário de `redisClient`, `verifyAccessToken`,
  `BR_LOCAL_MAX_LEN` e do tipo `User`; todos continuam vivos internamente;
- interface `BrokerSettings`, sem uso real.

O relatório final do Knip ficou limpo. TypeScript, build e whitespace também
passaram após as remoções.

### Itens duvidosos deliberadamente preservados

- `tailwindcss`: o Knip indicou como dependência não usada, mas ela é carregada
  por `@import "tailwindcss"` e pelo plugin `@tailwindcss/vite`;
- routers do Express: alcançados dinamicamente pelo bootstrap;
- páginas lazy do React e áreas selecionadas por string;
- migrations e tabelas históricas ainda necessárias ao schema atual;
- Dashboard 1.0 e `AISettings.tsx`/`FollowUpSettings.tsx`;
- colunas compartilhadas preservadas exclusivamente por compatibilidade com a
  V1 congelada; o código V2 não as lê nem grava.

## 17. Fontes de verdade e manutenção deste documento

Quando houver divergência, use esta ordem:

1. código e migrations da branch que será publicada;
2. schema/secrets efetivamente verificados no ambiente alvo;
3. este documento de estado atual;
4. `DECISIONS.md` para decisões vigentes;
5. `README.md` e `UX_MASTERPLAN.md` para visão de produto e experiência.

Após cada mudança funcional, atualize aqui somente a verdade vigente e evite
transformar esta referência em um changelog de integrações desativadas.

## 18. Prompt padrão e personalização do agente WhatsApp

O prompt-base revisado do atendimento está em
[`PROMPT-AGENTE-WHATSAPP.md`](./PROMPT-AGENTE-WHATSAPP.md). Ele deve ser
instalado manualmente no workflow N8N; manter o arquivo no repositório permite
versionar e auditar o texto que efetivamente orienta o agente.

O padrão separa duas camadas:

1. **regras protegidas do produto:** concisão, transparência, privacidade,
   catálogo como dado não confiável, proibição de inventar informações e fluxo
   seguro das ferramentas de agenda;
2. **instruções personalizadas do corretor:** tom, foco comercial, ordem das
   perguntas e regras específicas da imobiliária, desde que não contrariem a
   camada protegida.

As respostas devem ter normalmente de uma a três frases, uma pergunta por vez
e no máximo um emoji. O agente não simula erros de digitação, pausas ou uma
identidade humana. Se perguntado, identifica-se honestamente como assistente
virtual da imobiliária.

O nome público configurado na tela Assistente IA continua salvo em
`imf_brokers.ai_name`. O endpoint interno `GET /api/brokers/:id/agent`, usado
pelo N8N, passa a devolver esse valor em `agent_name`; `broker_agents.agent_name`
é apenas fallback legado e `Juliana` é o fallback final. Assim a expressão
`$('Buscar Agente IA').item.json.agent_name` do prompt acompanha o nome que o
corretor escolheu na interface.

Nenhuma migration é necessária apenas para o texto do prompt. A auditoria de
27/07/2026 não confirmou qual revisão está ativa dentro do N8N; comparar o
workflow com este arquivo antes de declarar a instalação concluída. O modelo
do agente vem do endpoint (`N8N_AGENT_MODEL`, padrão
`google/gemini-2.5-flash`) e não deve ficar divergente em nodes isolados.

### CRM automático (05/08/2026)

Até 04/08/2026 o agente externo de vendas não tinha nenhuma integração com o
CRM — qualificava o cliente e agendava visita, mas o lead nunca era criado
nem movia de etapa. Agora:

- `POST /api/crm/n8n/sync-lead` (`server/routes/crmSalesAgent.ts`,
  `requireInternalToken`) — ferramenta nova pro agente chamar (`{broker_id,
  phone, client_name, property_id?, qualification_note?}`) sempre que souber
  nome/interesse/imóvel do cliente. Cria lead (dedupe por telefone, mesmo
  padrão de `POST /api/conversas/:ticketId/create-lead`) ou atualiza o
  existente; nunca aceita `property_id` sem validar que pertence ao broker;
  qualificação vai pra `leads.notes` (sobrescrita, sem histórico).
- `advanceLeadToVisitStage` (`server/services/crmPipelines.ts`), chamada
  automaticamente por `POST /api/agenda/n8n/create` (`agenda.ts`) após uma
  visita ser agendada de verdade — move o lead pra etapa cujo nome contém
  "visita" (case-insensitive) no pipeline dele, só pra frente (nunca regride,
  nunca pula won/lost). Não depende de nenhuma ferramenta nova no n8n.
- Requer adicionar no workflow do n8n um node HTTP Request Tool novo
  (`sincronizar_lead`, mesmo formato de `agendamento1`) conectado como
  `ai_tool` do agente, e um trecho novo no system prompt instruindo quando
  chamá-lo — entregue pronto, não aplicado direto via API por ser o
  workflow de produção em atendimento real.
