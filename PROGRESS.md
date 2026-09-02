# Estado do projeto

## V1 decomissionada — app Fly e código legado removidos (2026-09-02)

- Decisão explícita do usuário: V1 é legada, remover da Fly e do código. Ver
  `DECISIONS.md` (seção "Projeto e entrega") para o registro completo.
- App Fly `imobiflow` (separada de `imobiflow-v2`, 2 machines rodando desde
  maio/junho, último deploy 07/07/2026, sem volume) destruída via `flyctl
  apps destroy imobiflow`. Nenhum dado foi perdido — a app não tinha volume
  próprio, só falava com o Supabase compartilhado (o mesmo que a V2 usa).
- No código (branch `v2`): removidos `src/pages/Dashboard.tsx` (UI antiga,
  servida em `/`), `src/components/CorretoraSettings.tsx`,
  `src/components/AISettings.tsx`, `src/components/FollowUpSettings.tsx` e
  `server/routes/corretora.ts` (rota morta — nem estava montada corretamente
  de um jeito que a V2 usasse). `/` agora redireciona para `/app`.
- Verificado com `knip` antes e depois de cada remoção que nada disso era
  usado pela V2 — vários componentes do Dashboard antigo (`AgendaCalendar`,
  `MagicWandTextarea`, `PropertyForm`) são compartilhados com a V2 e **não**
  foram tocados. `AssistenteIAArea.tsx` (V2) já tinha sua própria
  reimplementação independente do que `AISettings`/`FollowUpSettings`
  faziam — o comentário no código que dizia "componente legado... segue
  existindo pro Dashboard 1.0" foi atualizado.
- Suíte integral (224 testes), TypeScript, Knip e build aprovados em
  02/09/2026; `/` testado ao vivo no dev server local (redireciona pra
  `/app`, que por sua vez manda pra `/login` sem sessão).
- **Concluído no mesmo dia, com autorização do usuário**: o clone local
  congelado `C:\Users\Criate\imob.criate` foi apagado do disco (2 stashes
  presentes eram só diff de `package-lock.json` de uma sincronização antiga,
  nenhum branch local tinha commit não enviado ao GitHub — conferido antes de
  apagar). O branch `main` remoto (mesmo repositório GitHub) também foi
  apagado, depois de trocar o branch padrão do repositório para `v2`
  (não dava pra apagar o branch default direto).

## Nome comercial definitivo "PANTUS Real Estate" + favicon (2026-09-02)

- Decisão completa em `DECISIONS.md` (entrada do topo). O nome provisório
  "Real Estate" (11/08) vira **PANTUS Real Estate** — "PANTUS" é a marca,
  "Real Estate" continua junto como categoria.
- Aplicado localmente: `<title>`/`description` de `index.html`;
  `public/favicon.svg` (ícone recortado/vetorizado a partir da imagem que o
  usuário enviou por WhatsApp — não é o vetor original do designer; branco
  sobre degradê azul, mesmo estilo do mockup de ícone de app que ele mandou);
  as 51 ocorrências de "Real Estate" já espalhadas no código pelo Grupo 1 do
  Codex (12/08) viraram "PANTUS Real Estate" por localizar-e-substituir
  direto — eram sempre nome de marca em comentário/mensagem/telemetria, nunca
  termo genérico (projeto 100% PT-BR).
- Dois assets crus salvos e ainda não conectados em nenhuma tela:
  `public/pantus-icon-black.png`, `public/pantus-logo-full-black.png` — o app
  não tem componente de header/logo hoje, só texto.
- Grupo 2/3 (Termos/Privacidade, páginas revisadas pelo Google, nome da
  agenda no Google/CalDAV, `imf_`, app Fly `imobiflow-v2`, razão social)
  continuam intocados — ver `NEXT_TASK.md`. Quando forem feitos, o alvo passa
  a ser "PANTUS Real Estate".
- Suíte integral (224 testes), TypeScript, Knip, build e `git diff --check`
  aprovados em 02/09/2026, mais checagem visual ao vivo no dev server local
  (título e favicon renderizando corretamente).

## Scheduler e alerta obsoleto do WhatsApp Pai (2026-08-11)

- O deploy `v266` atualizou a Machine singleton do scheduler, mas a deixou
  parada. A API seguia saudável enquanto os 20 jobs recorrentes não rodavam.
- A Machine foi iniciada e o guardião reafirmou 11 webhooks no domínio novo,
  inclusive `https://realestate.criate.online/api/wpp-pai/inbound`.
- O workflow agora encontra e inicia explicitamente o scheduler após a escala,
  falhando se o singleton não existir.
- O botão global **Atualizar** remonta a aba administrativa ativa; o WhatsApp
  Pai deixa de manter em tela um alerta antigo depois da autocorreção.
- A UAZAPI apresentou leitura intermitente do endpoint de webhook. O painel
  agora separa estado desconhecido de divergência confirmada e não recomenda
  mais desligar/ligar o recebimento por uma falha temporária do provedor.

## Domínio próprio e OAuth Google (2026-08-11)

- `realestate.criate.online` foi criado como CNAME isolado para o app Fly
  `imobiflow-v2`; nenhum registro DNS preexistente da Criate foi alterado.
- O certificado TLS está ativo e `/api/health`, `/sobre`, `/privacidade` e
  `/termos` respondem HTTP 200 no novo domínio.
- `criate.online` foi comprovado por TXT no Google Search Console. O cliente
  OAuth preserva origem/callback `fly.dev` e adiciona origem/callback do domínio
  próprio para uma migração sem interrupção.
- As URLs públicas do Branding apontam ao domínio próprio e a reavaliação da
  marca foi enviada ao Google. A origem canônica versionada passa a ser
  `PUBLIC_APP_URL=https://realestate.criate.online`.

## Logs movidos para o Painel Admin (local, 2026-08-11)

- A tela global de Logs deixou o menu operacional do `/app` e passou a ser uma
  aba do `/admin`, junto de Contas, Vouchers, Saúde do sistema e WhatsApp Pai.
- O bloqueio do backend continua exigindo `imf_brokers.is_admin`; a mudança é
  de organização da experiência e não amplia permissões.
- A navegação administrativa ganhou quebra responsiva para acomodar as cinco
  seções no celular. Não há migration.

## Revogação administrativa de vouchers (local, 2026-08-11)

- Voucher ativo pode ser revogado e o link deixa de funcionar imediatamente.
- Voucher utilizado pode ter o acesso concedido revogado enquanto a conta ainda
  estiver em `experimentacao`; os dados são preservados e a conta fica
  `inativo`, podendo seguir para contratação.
- A RPC transacional `imf_revoke_trial_voucher` trava voucher e conta, registra
  administrador/data da revogação e recusa afetar uma conta que já trocou de
  plano.
- Requer a migration `20260811c_trial_voucher_revocation.sql`.

## Resumo de conversa pelo WhatsApp Pai (local, 2026-08-11)

- Nova ação estrita e não mutável `summarize_conversation` no agente interno,
  disponível tanto no painel quanto no WhatsApp Pai.
- O contato é resolvido por nome ou telefone e o sistema consulta até as 80
  mensagens mais recentes do ticket atual para entregar resumo, pendência,
  próximo passo e modelo de follow-up.
- A consulta exige permissão `conversas:visualizar`; o acesso ao histórico é
  novamente limitado por titular, permissão de gerenciamento, atribuição do
  ticket ou propriedade do lead.
- Histórico do cliente entra no modelo como contexto não confiável. Pedidos de
  resumo nunca enviam mensagens; o envio requer solicitação explícita posterior.
- Ambiguidades não expõem a lista de contatos antes da autorização específica e
  pedidos de interrupção de contato eliminam a sugestão de mensagem.
- Cobertura adicionada a `conversationInsights.test.ts` e ao teste permanente
  do projeto. Não há migration.

## Piloto real, lote de fotos, logs administrativos e CRM pelo Pai (2026-08-11)

Revisão completa da cautela histórica confirmou que `runAgent` sempre devolvia
proposta e que o WhatsApp Pai forçava `autonomy: "copiloto"`; o seletor do topo
nem sequer era persistido. A decisão foi substituída: o painel autoexecuta no
Piloto e o Pai persiste primeiro a proposta/idempotência e a confirma
automaticamente. Copiloto/Manual continuam intactos.

O álbum do Pai agora abre um lote persistente, espera quatro segundos de
silêncio e entrega uma única confirmação ou um único comando com até 15 fotos.
Texto e áudio enviados logo após as imagens aguardam o mesmo lote. O erro real
“uma resposta por foto” deixa de existir no servidor, não apenas na interface.

Criada a área global de Logs, visível somente para `is_admin`, com filtros,
detalhe sanitizado e workflow operacional. Falhas do OpenRouter, execução do
agente, mídia, fila do Pai e lotes são registradas best-effort sem derrubar o
fluxo observado. Logs resolvidos têm retenção de 180 dias.

O agente ganhou `move_lead_stage`. O snapshot inclui leads recentes, pipelines
e etapas ativas; a execução revalida conta, autoria do membro e destino antes de
mover. Como painel e Pai chamam o mesmo cérebro, a ferramenta vale nos dois.

Migration criada e ainda pendente de aplicação:
`20260811b_agent_autonomy_media_batches_and_system_logs.sql`.

Os secrets oficiais do Google Agenda foram instalados no Fly e as três classes
de máquina voltaram saudáveis. O projeto Google incorreto foi encerrado e ficou
agendado para exclusão após o prazo de recuperação do provedor.

## Controle de chaves auditável e protegido (2026-08-10)

A auditoria da aba **Aluguéis → Para alugar** confirmou que as retiradas eram
gravadas, mas a interface mostrava somente a chave em aberto e escondia todo o
histórico após a devolução. O texto clicável **Devolvida** também parecia um
status, embora executasse imediatamente a baixa: os 7 registros encontrados no
banco tinham sido marcados como devolvidos em menos de um minuto, 3 deles em
até 10 segundos. Quatro registros legados continham telefone inválido porque o
formulário não possuía limite nem validação.

O cartão agora separa estado e ação: mostra **Em posse** ou **Em atraso**,
exibe pessoa, finalidade, telefone e prazo, e oferece **Registrar devolução**
com confirmação explícita. Cada imóvel ganhou um histórico completo de
retiradas e devoluções. Nome, telefone brasileiro e previsão futura são
validados no navegador e novamente no backend. Falhas ao consultar a tabela de
chaves deixaram de ser convertidas silenciosamente em listas vazias.

Correção posterior no mesmo fluxo: o número **Visitas** do cartão consultava
somente eventos futuros de `imf_agenda`, embora o usuário estivesse registrando
as visitas pelo controle de chaves. O cartão agora mostra **Visitas feitas** e
conta retiradas com finalidade `visita` já devolvidas; o KPI **Visitas
marcadas** permanece restrito à Agenda futura e ignora eventos cancelados.

Refino visual posterior: o modal de entrega deixou de usar o `select` nativo,
que abria claro e quebrava o tema escuro. A finalidade agora usa botões
segmentados responsivos; data e hora ocupam uma linha completa; cabeçalho,
aviso e rodapé possuem separação visual; no celular, campos e ações empilham
sem colisão ou texto sobreposto.

A migration `20260810d_property_keys_hardening.sql` foi aplicada e verificada:
RLS ativo, acesso direto do navegador recusado com HTTP 401 e acesso do backend
preservado. As restrições `NOT VALID` protegem novos INSERTs/UPDATEs sem apagar
ou reescrever os registros de teste anteriores. Integração refeita sobre o
deploy do Claude (`f4bd194`) sem conflito funcional. TypeScript, 192 testes,
build de produção e `git diff --check` aprovados.

## Inquilinos (Locação) — visão de detalhe (Etapas A e B) (2026-08-10)

Pedido do usuário: a aba Inquilinos precisa escalar pra 100+ cadastros e
"ainda não ficou clara, organizada e funcional", apesar do trabalho recente
do Codex (tiles de estatística, busca+filtros, alternância lista/cartões,
paginação — tudo já sólido). Investigação encontrou a lacuna real: **não
existia visão de detalhe do inquilino**. "Editar" só abria o formulário de
dados pessoais (`TenantModal`) — nunca contratos nem boletos. Pra ver
"Controle mensal" (`PaymentLedgerModal`) ou "Diário e piloto"
(`ContractDiaryModal`), o usuário precisava sair de Inquilinos, voltar pra
"Imóveis alugados" e caçar manualmente o contrato certo — apesar dos dois
modais já existirem prontos e funcionais. Proposta apresentada e aprovada
via plan mode antes de qualquer edição.

**Achado no caminho**: o checkout local estava 10 commits atrás de
`origin/v2` — a tela que o usuário mostrou em print já existia lá (commits
do Codex do próprio dia 10/08), só não na cópia local. Sincronizados
cirurgicamente só os arquivos de Locação (`git checkout origin/v2 -- <lista>`,
~24 arquivos, incluindo dependências entrelaçadas como sandbox Asaas e
régua de cobrança) — **sem tocar em nenhum arquivo com edição local
pendente** (a feature de reset do Assistente/WhatsApp Pai que o Codex tinha
em andamento na mesma árvore de trabalho: `agent.ts`, `whatsappPaiQueue.ts`,
`CommandBar.tsx`, `package.json`, `agentConversationReset.ts`).

**Etapa A — visão de Detalhe**: `TenantDetailPanel` novo em
`LocacaoArea.tsx`, abre como sub-página ao clicar na linha/cartão (não só no
lápis), reaproveitando o padrão "Voltar" que a própria tela já tinha
("Voltar para Inquilinos", mesmo mecanismo de "Voltar para Aluguéis") — no
celular isso já garante tela cheia em vez de modal cortado, sem inventar
navegação nova. Mostra cabeçalho (nome/status/situação financeira/valor em
atraso/link de WhatsApp/editar), contato completo (telefone/e-mail/CPF/
contato de emergência — hoje só existiam dentro do formulário de edição,
nunca como leitura) e a lista de contratos, cada um com botões "Controle
mensal" e "Diário e piloto" que abrem os modais **existentes tal como
são** — zero mudança de backend, já que tudo que os modais precisam
(`id`/`tenant_name`/`property`/`rent_amount_cents`/`status`) já vem no
`contract_history` que `GET /api/locacao/tenants` já retorna. `GlassCard`
(`src/experience/ui.tsx`) ganhou passthrough opcional de `role`/`tabIndex`/
`onKeyDown` — mudança aditiva pequena, usada pelos cartões clicáveis daqui
mas disponível pra qualquer outro card no app que precisar da mesma
acessibilidade de teclado.

**Etapa B — paridade e enxugamento**: a visão em cartões (que empilhava
bloco financeiro + contato completo + histórico rolável de 3 itens, porque
não tinha pra onde mandar isso) ficou só com nome/imóvel atual/badge de
situação financeira/telefone — o resto mora no detalhe agora. A visão em
lista ganhou o botão "Apagar" que só existia nos cartões (paridade de ações
entre os dois modos).

**Bug achado e corrigido durante o teste**: `tests/rentalTenants.test.ts`
(teste já existente, sincronizado do `origin/v2`) assert a presença literal
do texto "Situação financeira" no código-fonte — minha simplificação do
cartão removeu esse rótulo. Não era regressão de comportamento (o badge
"Adimplente/Inadimplente/Sem cobrança" continuava lá), mas o rótulo
explícito é uma melhoria de clareza genuína — devolvido, só que dentro do
novo `TenantDetailPanel` em vez do cartão.

**Testado ao vivo**: conta descartável, 13 inquilinos via API real
(`POST /api/locacao/tenants`+`/contracts`+`/contracts/:id/payments`) cobrindo
os 4 estados (inadimplente/adimplente/sem_cobrança/inativo) — a inadimplência
foi produzida criando uma competência com vencimento no passado (o cálculo
`overdue` é 100% dinâmico no servidor, não um campo salvo). Confirmado na
tela real: os 5 tiles batendo exato (13 cadastrados, 1 em atraso, 1 em dia,
11 sem cobrança, 1 inativo), clique na linha E no cartão abrindo o detalhe,
"Controle mensal" carregando a competência real ("Agosto de 2026,
vencimento 05/08/2026, ATRASADO, R$ 1.800,00"), "Diário e piloto" carregando
o contrato certo, "Editar cadastro" abrindo o formulário pré-preenchido,
clique em "Editar"/"Apagar" dentro do cartão SEM abrir o detalhe por trás
(stopPropagation funcionando), paginação (13 resultados, página 1 de 2),
mobile 375px sem overflow horizontal e com o detalhe em tela cheia.
`npx tsc --noEmit`, `npx knip`, `npm test` (179/179) e `npm run build`
limpos.

**Publicado**: a visão de detalhe entrou no commit `2a7114b` e foi integrada
ao estado completo da V2 pelo merge `f4bd194`; o workflow de deploy terminou
com sucesso em 10/08/2026. Etapa C (opcional, ver plano): usar o `tenant_profile` que
`GET /api/locacao/contracts` já devolve mas nunca usa, pra linkar de volta
de um contrato em "Imóveis alugados" pro detalhe do inquilino correspondente.

## Agenda — sincronização com Google e iPhone pronta localmente (2026-08-10)

A Agenda agora oferece uma assinatura privada compatível com **Google Agenda**
e **Calendário do iPhone/iCloud**. O usuário gera o endereço dentro da própria
tela, copia para o Google ou abre a assinatura no iPhone. Criações, edições e
cancelamentos feitos no ImobiFlow aparecem no calendário externo conforme a
frequência de atualização definida pelo Google ou pela Apple.

A integração é deliberadamente somente leitura no calendário externo. O link
é individual, usa token aleatório de 256 bits, é guardado por hash e cópia
criptografada, respeita o escopo do membro, possui rate limit e pode ser trocado
ou desativado. A migration necessária é
`20260810c_agenda_calendar_feed.sql`. Publicação pendente até a aplicação da
migration.

## Agenda — sincronização bidirecional Google + iPhone implementada localmente (2026-08-11)

O update deixou de ser apenas roadmap. Foram adicionados:

- OAuth Google com `state` aleatório de uso único, acesso offline, tokens
  AES-256-GCM e escopo restrito `calendar.app.created`;
- agenda secundária Google “ImobiFlow”, importação incremental por `syncToken`,
  exportação idempotente por vínculo local↔externo e ciclo no scheduler a cada
  dois minutos;
- lease atômico no Postgres para o botão manual e o scheduler nunca criarem o
  mesmo evento simultaneamente;
- servidor CalDAV gravável compatível com a configuração de conta do iPhone,
  usando credencial própria do ImobiFlow, hash SHA-256 de uma senha aleatória
  de 192 bits e sem pedir Apple ID/senha do iCloud;
- discovery, `PROPFIND`, `calendar-query`, `calendar-multiget`, leitura,
  criação, edição e exclusão de `VEVENT`, com ETag para bloquear sobrescrita
  concorrente;
- interface separando Google bidirecional, iPhone bidirecional e `.ics` legado
  somente leitura.

O fuso `America/Sao_Paulo` e a conversão ISO validados pelo usuário foram
preservados. A migration nova é
`20260811a_agenda_bidirectional_sync.sql`, aplicada e verificada em 11/08/2026:
as três tabelas e as duas RPCs de lease responderam sem erro. Para ativar o
Google ainda faltam as credenciais OAuth do projeto Google Cloud; secrets e
deploy não foram executados nesta implementação local. Suíte integral,
TypeScript, Knip, build e `git diff --check` aprovados em 11/08/2026.

## Locação — diretório de inquilinos separado (2026-08-10)

**Inquilinos** agora abre como uma tela própria e focada dentro do módulo de
Locação. Ao entrar no diretório, o cabeçalho, os indicadores e as abas da gestão
de Aluguéis deixam de competir com a consulta dos locatários. A tela apresenta
somente o cadastro, contatos, contratos e situação financeira dos inquilinos,
com ações próprias para criar e editar registros e um botão explícito de
**Voltar para Aluguéis**.

A mudança preserva a mesma fonte de dados e as regras já existentes, sem criar
cadastros paralelos. É uma alteração somente de interface e não exige migration.

## Locação — operação escalável para até 100 clientes pronta localmente (2026-08-10)

As abas **Imóveis alugados** e **Inquilinos** agora abrem em uma fila compacta,
ordenada por prioridade operacional: inadimplentes primeiro, depois cadastros
sem cobrança e clientes em dia. Foram adicionados busca por nome, imóvel,
proprietário, telefone, e-mail e CPF/CNPJ; filtros rápidos por situação;
ordenações; alternância entre lista e cartões; contagem de resultados; estados
vazios orientativos; e paginação de 12 registros. Assim, uma carteira de 10 a
100 locatários permanece escaneável sem uma rolagem contínua de cartões.

A lista mantém em um clique as ações de controle mensal, diário/piloto e edição;
os cartões detalhados continuam disponíveis para cobranças e histórico. A
implementação é somente de interface e não exige migration.

## Locação — adimplência por inquilino publicada (2026-08-10)

A aba **Locação → Inquilinos** agora mostra a situação financeira consolidada
de cada locatário: **Adimplente**, **Inadimplente** ou **Sem cobrança**. Em caso
de atraso, exibe quantidade de cobranças e saldo vencido. O cartão de cada
contrato ativo também apresenta o indicador para consulta rápida.

O backend calcula o resultado a partir das competências dos contratos ativos,
incluindo pagamentos parciais e acordos ainda não pagos. Cobranças futuras não
geram falso atraso e a virada do dia respeita `America/Sao_Paulo`. O KPI
superior de inadimplência usa somente o saldo vencido do mês, não todo valor
ainda aguardando o vencimento. Não exige migration. Validação local aprovada:
  TypeScript, 181 testes, Knip, build de produção e `git diff --check`.
  Publicada e validada em produção no workflow **Deploy V2 to Fly.io #143**.

## Locação — controle híbrido de pagamento pronto localmente (2026-08-10)

Implementado o fluxo de ponta a ponta para cobranças Asaas e externas. O Asaas
continua usando webhook e agora também possui conciliação de recuperação a
cada 10 minutos. Pagamento confirmado muda a competência para **Pago** e a
remove da consulta da régua; pendente/atrasado continua elegível.

O **Controle mensal** ganhou consulta imediata ao Asaas, baixa/reabertura
manual, importação de boleto PDF, link temporário para visualização e envio
pontual pelo WhatsApp. A cobrança externa segue a régua sem exigir chave Asaas.
O envio manual tem confirmação e rate limit de 5 por 15 minutos. Todas as
operações validam conta + contrato + cobrança e registram eventos no diário.

Migration aplicada e verificada em produção em 10/08/2026:
`supabase/migrations/20260810b_rental_payment_control.sql`. Ela adiciona
auditoria do status, estado da última consulta Asaas e o bucket privado
`imf-rental-bills` (PDF, 6 MB). A verificação confirmou 8 colunas, bucket
privado e índice de conciliação. Publicação e aceite funcional permanecem
pendentes.

Validação local aprovada: TypeScript, 176 testes, Knip, build de produção e
`git diff --check`.

## Locação — chave individual nas mensagens da régua (2026-08-10)

Os cartões da régua agora exibem uma chave acessível **Envia / Não envia** ao
lado de **Editar**. A preferência é salva imediatamente por etapa, reflete na
linha do tempo e recarrega a agenda de 14 dias sem fechar a tela. Durante o
salvamento a chave mostra progresso; em erro, a interface restaura o estado
anterior. A etapa de entrega humana continua obrigatória e aparece como tal.

Não exige migration: o campo `enabled` por conta e por etapa já existia em
`imf_rental_message_templates` e já era respeitado pelo scheduler.

## Locação — piloto financeiro sandbox pronto para publicação (2026-08-10)

O fluxo de aluguel foi preparado para gerar cobranças reais apenas dentro do
Asaas sandbox. O build do frontend e o backend do deploy V2 passam a habilitar
o módulo, enquanto `CLIENT_FINANCIAL_SANDBOX_ONLY=true` bloqueia qualquer chave
de produção. A restrição é revalidada nas rotas de configuração, no piloto do
contrato, nas flags da conta, na geração e na régua do scheduler.

A conexão financeira mostra de forma explícita o modo de validação e oferece
somente **Sandbox (teste)**. O cartão do contrato identifica a cobrança como
teste. Antes de emitir, o backend cria ou atualiza de forma idempotente o
webhook autenticado da conta Asaas própria; sem retorno confirmado, nenhum
cliente ou boleto é criado. Não há migration nova: foram reutilizadas as flags
por conta e por contrato, ambas desligadas por padrão.

Alterações ainda locais, aguardando push/deploy e aceite no contrato **casa
teste** / inquilino **antonio**.

## Locação — validação segura dos disparos e contraste dos selects (2026-08-10)

O contrato de teste **casa teste** / inquilino **antonio** apareceu corretamente
na agenda de 14 dias, mas com `0 de 1` contrato no piloto e todos os itens como
**Simulação**. Nesse estado nenhum WhatsApp é enviado. A auditoria também
encontrou que a flag global `CLIENT_FINANCIAL_OPERATIONS_ENABLED` era exibida
na interface, porém não era revalidada dentro dos dois jobs do scheduler.

Os jobs de geração de cobrança e régua agora falham fechado quando a flag
global está desligada; as rotas impedem ligar conta/contrato nesse estado, mas
continuam permitindo desligar uma configuração antiga. A agenda também marca
o item como bloqueado em vez de programado quando a trava global está fechada.

Para validar o canal sem gerar boleto ou PIX, o **Diário do contrato** ganhou o
botão **Testar WhatsApp**. Ele exige confirmação humana, limita cinco tentativas
por usuário a cada 15 minutos, valida contrato/conta/telefone, envia uma mensagem
com o prefixo `[TESTE ImobiFlow]` e registra o resultado no diário. O seletor
nativo recebeu cores sólidas de opção nos temas claro e escuro, corrigindo o
“Sim/Não” transparente observado no Chrome/Windows.

Validação local aprovada: 170 testes, TypeScript, Knip, build e
`git diff --check`. O aceite externo ainda exige um clique manual no botão de
teste e confirmação do recebimento no WhatsApp do inquilino.

## Assistente IA — comando pessoal `@reset` (2026-08-10)

Implementado um reset único para o histórico compartilhado entre WhatsApp Pai
e Assistente IA do painel. Quando a mensagem inteira é exatamente `@reset`
(sem texto adicional), o backend não chama o modelo: apaga `imf_agent_log`,
cancela a proposta ainda não executada e remove fotos/documentos temporários do
mesmo `user_id` + `broker_id`. Leads, imóveis, agenda, ações já executadas,
conversas comerciais e a inbox técnica do webhook não são alterados.

A limpeza usa a RPC transacional `imf_reset_agent_conversation`, criada pela
migration `20260810a_agent_conversation_reset.sql` e exclusiva da
`service_role`. Se uma mutação estiver em `executing` ou `executed` aguardando
entrega da resposta, o reset retorna 409 e preserva a trava de idempotência; o
usuário deve aguardar e tentar novamente. O botão **Nova conversa** do painel
passou a usar a mesma limpeza. Digitar `@reset` no painel também limpa a tela.

No WhatsApp, as bolhas antigas continuam visíveis fisicamente no aparelho — a
integração não pode apagar retroativamente o histórico do aplicativo — mas o
conteúdo deixa de existir na memória da IA e some do painel ao recarregar.

Validação local aprovada: TypeScript, 167 testes, Knip, build e
`git diff --check`. A migration foi aplicada em produção pelo SQL Editor em
10/08/2026 e verificada com UUIDs inexistentes: `ok=true`, quatro contagens
iguais a zero. Publicado no commit `31c2b93` pelo GitHub Actions run `#139`;
os jobs **Validate V2** e **Deploy imobiflow-v2** concluíram com sucesso. O Fly
publicou a imagem `deployment-01KZNWFBXDY55ZP94QF33TJV3K`, as seis Machines
atingiram estado saudável e o smoke pós-deploy confirmou HTTP 200 em `/`,
`/login` e `/app`. O comando não foi executado automaticamente na conta real:
o aceite funcional pelo usuário permanece deliberadamente pendente.

## WhatsApp Pai — aceite de produção e isolamento concluído (2026-08-10)

As Fases 1–7 estão publicadas no commit `4c525f2` (Fly release 234). A
migration `20260807h_whatsapp_pai_internal_conversation.sql` foi aplicada pelo
usuário e os registros comerciais antigos do número Pai foram removidos.
Hunter e demais canais comerciais agora bloqueiam `556299982218`; sua conversa
permanece somente no Assistente IA.

Auditoria read-only de produção: instância central com webhook ativo e
provisionamento concluído; 22 entradas da inbox do Pai em `completed`, zero
`dead`, zero ação pendente, staging de fotos/documentos vazio, 6 mídias
permanentes no log do agente e 2 vínculos de equipe verificados. Isso também
confirma que a limpeza por TTL executou corretamente depois dos testes.

O aceite visual não foi concluído nesta auditoria porque a nova sessão do
navegador abriu em `/login`. Assim que houver login, confirmar as 6 fotos no
Assistente IA e a ausência do Pai em Conversas. O único smoke funcional ainda
pendente é um PDF pequeno pela Fase 7. O branch `v2` estava limpo e sincronizado
com `origin/v2` no início desta retomada; conferir novamente antes de qualquer
novo commit porque outro desenvolvedor também trabalha no projeto.

## WhatsApp Pai — pareamento oficial e hardening do webhook (2026-08-07)

A migration `20260807e_whatsapp_pai_staged_documents.sql` foi aplicada
manualmente pelo usuário e confirmada por consulta read-only. O número oficial
`6299982218` foi pareado na instância central pelo Admin local; a UAZAPI reportou
perfil `Criate` e owner normalizado `556299982218`.

Como não havia um segundo número disponível para enviar comandos, nenhum smoke
real foi executado. Um Quick Tunnel temporário foi validado atrás de um proxy
local que aceitava exclusivamente `POST /api/wpp-pai/inbound`; raiz e demais
rotas respondiam 404. Em seguida o webhook temporário foi desativado e o túnel
encerrado. O número continua pareado, mas o inbound permanece desativado até a
retomada controlada ou o deploy.

A revisão encontrou e corrigiu uma lacuna: a conexão administrativa não
reafirmava o webhook central e o guardião periódico cobria apenas brokers e
membros. `setUazapiPlatformWebhook` agora valida origem HTTPS pública, monta a
rota fixa do Pai, é chamada antes de `/instance/connect` e também pelo guardião
para `imf_platform_instances(key='pai')`. Localhost, loopback e HTTP falham
fechados. Testes específicos cobrem normalização, ordem da conexão e guardião.

## WhatsApp Pai — Fase 7: documentos como contexto temporário (2026-08-07)

Pedido do usuário: concluir a última fase e preparar a troca controlada para o
número oficial do WhatsApp Pai. Como o plano original não definia a qual
objeto um documento deveria ser anexado, foi adotada a opção reversível e de
menor privilégio: o documento alimenta somente o próximo comando do usuário;
não é anexado silenciosamente a imóvel, lead, contrato ou reserva.

Migration nova `20260807e_whatsapp_pai_staged_documents.sql`, já aplicada, cria
`imf_whatsapp_staged_documents`, isolada por `user_id` e `broker_id`, RLS
ativa e acesso exclusivo da `service_role`. O arquivo bruto não é persistido.
Ficam apenas nome sanitizado, MIME, tamanho, SHA-256 e até 2.000 caracteres de
texto extraído. Há dedupe por usuário+hash, no máximo 3 documentos staged,
consumo único pelo próximo comando e expiração automática em 60 minutos.

Formatos suportados: PDF, TXT, CSV, JSON, Markdown e XML, até 8 MB. Texto é
decodificado localmente em UTF-8; PDF usa o tipo `file` da API do OpenRouter
com parser `cloudflare-ai`, sem ativar OCR pago silenciosamente. Arquivos
Office são rejeitados com orientação explícita para converter em PDF.

`whatsappPaiQueue.ts` reconhece documento, baixa pela UAZAPI, extrai e faz o
staging. Se vier sem legenda, confirma o recebimento e aguarda o comando; se
vier com legenda, executa a interpretação na mesma mensagem. `runAgent`
recebe `attachedDocuments` dentro de `UNTRUSTED_ACCOUNT_CONTEXT`; instruções
embutidas no arquivo nunca expressam intenção autenticada nem removem a
confirmação humana. O contexto é apagado depois do comando, inclusive quando
a ação fica pendente, porque a própria ação validada já contém os campos que
serão confirmados.

Também foram corrigidos três bloqueios de qualidade encontrados na retomada:
o hint JSON do agente agora inclui `query_leads`/`query_report`, a tipagem de
`GlassCard` aceita `key` nas listas JSX e o whitespace antigo de
`NEXT_TASK.md` foi removido. Seis testes específicos da Fase 7 passaram e o
TypeScript ficou limpo. Nenhuma chamada real de WhatsApp/OpenRouter e nenhum
envio de mensagem real ou chamada real ao OpenRouter foram feitos nesta
validação.

## WhatsApp Pai — Fase 1: permissão granular no agente de IA (2026-08-07)

Pedido do usuário: número de WhatsApp central onde qualquer usuário da
plataforma manda comando em linguagem natural e a IA executa a ação real
na conta correta — "controle remoto inteligente da plataforma", nativo,
sem n8n. Investigação prévia (3 agentes Explore em paralelo + 1 agente
Plan validando a arquitetura contra os arquivos-fonte reais) mapeou toda
a stack de mensageria/webhooks, o cérebro de IA já existente
(`server/services/agent.ts`) e as APIs de domínio. Plano completo de 7
fases em `.claude/plans/zany-forging-curry.md`. Achado central: o app já
tem um assistente de IA nativo completo (hoje só exposto no chat do
painel) cujo `runAgent()`/`executeAction()` já são funções puras sem
acoplamento a req/res — prontas pra receber uma porta de entrada nova
(WhatsApp) sem reconstruir nada.

**Fase 1, concluída**: achado durante a investigação — o motor de
permissões granulares por membro (`hasPermission`/`imf_member_permissions`,
construído mais cedo nesta mesma sessão, ver seção abaixo) nunca era
consultado em `agent.ts`/`routes/agent.ts`. Um membro sem `carteira:criar`
já conseguia, hoje, cadastrar um imóvel só pedindo pro assistente de IA do
painel — a grade de permissões não protegia essa porta. O pedido do
WhatsApp Pai é explícito sobre isso ("se não tiver autorização... a IA
também não pode"), então fechar essa lacuna virou pré-requisito, não
opcional — e beneficia o assistente do painel hoje mesmo, não só o
WhatsApp futuro, já que os dois vão compartilhar o mesmo `executeAction`.

Implementado em `server/services/agent.ts`: `AGENT_ACTION_PERMISSION`,
mapa das 12 ações mutantes + `query_agenda` pro par módulo:ação
correspondente em `permissions.ts` (ex. `create_property→carteira:criar`,
`send_message/broadcast_message/schedule_followup→conversas:gerenciar`).
Dois pontos de checagem: gate **soft** em `runAgent` (nem propõe a ação se
o membro não pode — evita "vou fazer X, confirma?" pra só negar na
confirmação) e gate **hard** em `executeAction` (nunca executa, mesmo que
a proposta já tenha sido recebida antes de uma permissão ser revogada —
fecha o cenário de corrida propor→revogar→confirmar). Titular sempre passa
(`hasPermission` atalha por `isBrokerOwner`), zero mudança de comportamento
pra quem já é dono da conta.

Teste novo `tests/agentPermissions.test.ts` (registrado em
`package.json`): garante que toda ação mutante tem entrada em
`AGENT_ACTION_PERMISSION` (deriva a lista direto do schema Zod existente,
não duplica em texto solto) e que todo módulo/ação mapeado existe de
verdade em `permissions.ts`.

**Testado ao vivo** (conta descartável, titular + 1 membro, servidor real
+ Supabase real + chamada real ao OpenRouter): membro sem grade nenhuma
pede "cadastra um imóvel" → negado sem propor nada. Titular aplica perfil
"corretor" (tem `carteira:criar`) → fluxo normal de proposta + confirmação.
Titular sempre passa, testado em paralelo. Revoga `carteira:criar` →
volta a negar na hora (cache de 60s não atrapalha, invalidado no PUT).
Cenário de corrida (propõe com permissão, revoga, tenta confirmar a ação
já recebida) → gate hard em `executeAction` bloqueia com 400. `npx tsc
--noEmit` e `npx knip` limpos nos arquivos tocados (2 erros de TS
pré-existentes em `LocacaoArea.tsx`/`LocacaoPanels.tsx`, de outra sessão,
não relacionados). `npm test`: 143/144 no momento (1 falha pré-existente
sem relação, flagueada separadamente, task `task_77366054` — depois da
Fase 2 a suíte já estava 144/144, possivelmente aquela task já corrigiu).

## WhatsApp Pai — Fase 2: vínculo de telefone com verificação (2026-08-07)

Continuação da Fase 1 acima. Objetivo: staff prova, dentro do painel já
autenticado, que um número de WhatsApp é dele — pré-requisito pra
qualquer inbound futuro (Fase 4) resolver quem está mandando comando.

**Schema** (`supabase/migrations/20260807_whatsapp_pai_staff_links.sql`,
aditiva, aplicada pelo usuário): `imf_whatsapp_staff_links` — PK é o
telefone normalizado (não `user_id`), porque o caminho quente futuro é
"esse telefone bate com quem", busca direta O(1); sem `broker_id`,
derivado em tempo de leitura via `getBrokerId` (já cacheado).

**Backend**: `server/security/whatsappVerificationCode.ts` (código de 6
dígitos + hash sha256, espelha `trialVoucherCode.ts` — nunca o código em
texto puro é persistido). `server/services/whatsappStaffLinks.ts` —
`startPhoneVerification` (recusa se o número já está VERIFICADO por
OUTRA conta, nunca sobrescreve um vínculo confirmado; permite reiniciar
um vínculo ainda não confirmado, sem risco), `confirmPhoneVerification`
(expira em 10 min, máx. 5 tentativas, sempre confirma a tentativa mais
recente do próprio usuário), `listVerifiedPhones`/`unlinkPhone` (filtra
por `user_id` — ninguém desvincula o número de outra pessoa). Rotas
`GET/POST/DELETE /api/me/whatsapp-link*` (`requireUser`, rate limit novo
`whatsappLinkLimiter`: 8/15min por usuário). Frontend: card novo em
`ConfigArea.tsx` (telefone → código → confirmar, lista de vínculos com
botão de desvincular).

**Achado real de infraestrutura durante o teste ao vivo** (não um bug
introduzido agora, pré-existente): o envio original copiava o mesmo
padrão que `auth.ts`'s recuperação de senha via WhatsApp já usa
(`POST /message/text/:session`) — mas testando ao vivo, esse endpoint
devolve 405 pra QUALQUER valor, e o próprio `uazapi.ts` já documentava
desde 03/07 que essa hipótese foi "testada e descartada". Corrigido pra
reusar `sendUazapiText` (`server/services/uazapi.ts`), o `/send/text`
comprovado ao vivo e usado em todo o resto do app. Separado disso,
`UAZAPI_PLATFORM_SESSION` no `.env` LOCAL nunca tinha sido preenchido de
verdade — ficou o texto de placeholder `"COLE_O_NOME_DA_SESSAO_AQUI"`
(não necessariamente afeta produção, que usa secrets do Fly, não o
`.env` do repo). Provisionada uma instância UAZAPI temporária
("WhatsApp Pai - TESTE TEMPORARIO"), pareada por código com o número
pessoal do usuário só pra validar o fluxo local — token real salvo no
`.env`, com comentário explícito marcando como temporário até a Fase 3
trazer o número oficial.

**Testado ao vivo**: telefone inválido rejeitado; código errado rejeitado
(incrementa `otp_attempts`); código expirado rejeitado; bloqueio após 5
tentativas mesmo com código novo válido; outro usuário sem verificação
pendente própria não confirma nada — tudo via script contra o servidor
real. O fluxo feliz completo (enviar → receber no WhatsApp de verdade →
digitar → confirmar) foi validado pelo próprio usuário direto na tela
real do navegador (`+55 6299982218` apareceu verificado com sucesso).
`npx tsc --noEmit`, `npx knip` e `npm test` limpos (144/144).

**Pendente**: autorização de commit/push.

## WhatsApp Pai — Fase 3: instância central gerenciada pelo admin (2026-08-07)

Continuação das Fases 1+2. Enquanto o vínculo de telefone (Fase 2) prova
"esse número é de fulano", a Fase 3 resolve o outro lado: qual número
CENTRAL recebe os comandos de todo mundo. Pedido explícito do usuário no
meio da implementação: *"quando um corretor entrar na plataforma o
whatsapp pai já deve estar cadastrado, caso ele se desconecte, na conta
de super admin deve ter a opção de colocar o whatsapp pai pra todos os
tenants"* — confirma exatamente o desenho já em andamento (instância
única, compartilhada, gerenciada só pelo admin).

**Schema** (`supabase/migrations/20260807b_whatsapp_pai_platform_instance.sql`,
aditiva): `imf_platform_instances`, linha única `key='pai'`. Diferente de
`imf_brokers`/`imf_broker_members` (1 linha = 1 instância própria), aqui é
literalmente UMA instância pra plataforma inteira — daí tabela própria em
vez de reaproveitar a de broker.

**Backend** (`server/services/provisioning.ts`): `setUazapiWebhookUrl`
extraído como núcleo puro (POST `/webhook` sem montar URL), reaproveitado
tanto por `setUazapiWebhook` (broker/membro, URL com `:instanceId`) quanto
pela nova `provisionUazapiInstanceForPlatform` (URL fixa
`/api/wpp-pai/inbound`, sem identificador — resolvido por telefone do
remetente na Fase 4, não por instância). `ensurePlatformInstance`
replica o mesmo padrão de comparar-e-trocar já provado em `ensureInstance`
(broker/membro), adaptado pra chave de texto (`key='pai'`) em vez de UUID.
Rotas novas em `admin.ts`: `GET /api/admin/whatsapp-pai/status`, `POST
.../connect` (QR ou código de pareamento, mesma lógica de
`brokers.ts`'s conexão de corretor), `POST .../disconnect` — todas
`requireAdmin`.

**Frontend**: nova aba "WhatsApp Pai" no Painel Admin
(`src/components/AdminWhatsappPai.tsx`, lazy-loaded como as outras abas),
mesmo padrão visual/de polling de `WhatsAppConnectCard` (QR ↔ código de
pareamento, com refresh automático), mas com aviso explícito na tela de
que conectar/desconectar aqui **afeta todos os tenants de uma vez**.

**Reaproveitamento em vez de reprovisionar do zero**: a instância
temporária de teste da Fase 2 (já pareada com o número pessoal do
usuário) foi inserida direto na tabela nova via script, em vez de deixar
`ensurePlatformInstance` criar uma instância nova do zero — evitaria
perder o pareamento já feito e forçar escanear QR de novo à toa. Trocar
pelo número oficial mais tarde é só usar a mesma tela (desconectar →
conectar com o número novo), zero mudança de código.

Testado ao vivo: usuário sem `is_admin` recebe 403 no status; conta admin
vê `provisioned=true, connected=true` com dados reais (perfil "Hunter",
número) da instância já conectada; UI validada de ponta a ponta com uma
sessão de admin descartável injetada no navegador — a aba renderiza
exatamente o status ao vivo, texto e tudo. `npx tsc --noEmit`, `npx knip`
e `npm test` limpos (144/144).

**Commitado** (Fases 1-3 juntas, commit `d5a0818`, local, sem push ainda).

## WhatsApp Pai — Fase 4: pipeline de inbound + confirmação persistida (2026-08-07)

Continuação das Fases 1-3. Objetivo: o WhatsApp central passa a RECEBER
comando de verdade — texto apenas nesta fase (áudio/foto ficam pra Fase 5,
`inboundMedia.ts` já tem o pipeline de download/transcrição pronto pra
reusar).

**Schema** (`supabase/migrations/20260807c_whatsapp_pai_inbox_and_pending_actions.sql`,
aditiva): `imf_pai_inbox` — fila durável própria (não estende
`imf_webhook_inbox`, que está entrelaçada com despacho pro n8n/debounce,
irrelevantes aqui), mesmo padrão SKIP LOCKED comprovado em
`claim_imf_webhook_inbox`, particionada por `sender_phone` em vez de
`broker_id` (o Pai não sabe de quem é a mensagem até resolver o telefone)
— garante que mensagens da MESMA pessoa nunca processam fora de
ordem/concorrentes. `imf_whatsapp_pending_actions` — PK em `user_id`
(já garante "1 ação pendente por remetente" de graça, já que
`imf_broker_members.user_id` é `UNIQUE`). `imf_agent_log` ganha `channel`
e `provider_message_id` (índice único parcial = trava de idempotência).

**Backend**: `server/services/whatsappPaiQueue.ts` (novo) —
`enqueuePaiWebhook`/`runPaiInboxTick` (worker) resolvem
telefone→`imf_whatsapp_staff_links` (só verificado)→`userId`→
`getBrokerId`; número não vinculado recebe orientação, nada é tocado.
Ação pendente existente e não vencida: classifica a resposta por
palavra-chave determinística em PT-BR (sim/confirma/pode→confirma,
não/cancela→cancela, qualquer outra coisa→abandona a pendência em
silêncio e trata como comando novo). Confirma → `parseConfirmedAgentAction`
+ `executeAction` (o MESMO `executeAction` da Fase 1, com o gate de
permissão já embutido). Sem pendência: monta `history` das últimas 8
linhas de `imf_agent_log` (qualquer canal) e chama `runAgent` (o MESMO
cérebro do assistente do painel). `server/routes/whatsappPai.ts` (novo)
— `POST /api/wpp-pai/inbound`, autentica por `body.token` contra o token
da instância central (1 instância só, sem lookup por id). Ciclo novo
`cycles.pai` em `webhook-worker.ts`; job novo `expirePaiPendingActions`
(60s) em `scheduler-worker.ts`/`maintenance.ts`; `imf_pai_inbox` entrou na
retenção de filas existente (`purgeResolvedQueueRows`).

**2 bugs reais achados testando ao vivo** (não hipotéticos — só
apareceram rodando contra o servidor real com múltiplas mensagens em
sequência):
1. `runPaiInboxTick` não tinha a mesma trava anti-sobreposição que
   `runWebhookInboxTick` já tem (`inboxTickRunning`) — duas mensagens
   próximas no tempo (o caso comum, já que `runAgent` leva alguns
   segundos) disparavam ciclos concorrentes que colidiam entre si
   ("lease da linha não pertence mais a este worker", FK violation
   tentando logar num broker de um teste anterior já limpo). Corrigido
   com o mesmo padrão `paiTickRunning` boolean.
2. `classifyReply` não tirava pontuação antes de comparar a primeira
   palavra — "sim, pode confirmar" virava `firstWord` `"sim,"` (com
   vírgula), não batia com `"sim"` da lista de confirmação, e a
   pendência era abandonada em silêncio (tratada como "other") em vez de
   confirmada — o imóvel nunca era criado, sem erro nenhum aparecer.
   Corrigido tirando pontuação final da palavra antes de comparar.

**Testado ao vivo**: servidor real, contas descartáveis, payload
sintético no formato exato da UAZAPI (`message.chatid`/`fromMe`/`id`/
`text`), com *polling* do status da fila em vez de espera fixa (mais
confiável que `runAgent` — a chamada real à IA varia de ~5 a ~10s).
Telefone não vinculado → orientação, nada tocado. Comando mutante
("cadastre um imóvel...") → proposta + pendência persistida. "Não" →
cancela, nada criado. Comando de novo + "sim" → imóvel REAL criado
(`imf_properties` com o título/preço certos). Reenvio da EXATA mesma
mensagem (mesmo `id`) → bloqueado pelo `dedupe_key` único, sem duplicar
execução. Log de conversa com `channel='whatsapp'` em todas as linhas.
Membro sem `carteira:criar` → negado explicitamente através do WhatsApp
Pai, mesma mensagem de negação da Fase 1 — prova viva de que o gate de
permissão funciona igual não importa a porta de entrada. `npx tsc
--noEmit`, `npx knip` e `npm test` limpos (144/144).

**Pendente**: autorização de commit/push (Fases 1-3 já commitadas
localmente, `d5a0818`; Fase 4 ainda não). Próximas fases (5-6): mídia
(voz + fotos de imóvel antes do texto), novas consultas (leads hoje,
relatório do mês). Fase 7 (documentos) fora de escopo por falta de
conceito de anexo em qualquer objeto de domínio hoje.

## WhatsApp Pai — Fase 5: mídia (voz + fotos de imóvel antes do texto) (2026-08-07)

**Contexto importante desta fase**: entre a Fase 4 e esta, o número de
teste (`62994381279`, o número pessoal do usuário, usado deliberadamente
"só pra teste" com o plano de trocar pelo oficial depois) foi BANIDO pelo
WhatsApp ("This account can no longer use WhatsApp due to spam") — efeito
colateral direto do volume de mensagens automatizadas dos testes das
Fases 2 e 4 num número recém-pareado, gatilho clássico de detecção de
spam contra clientes não-oficiais tipo UAZAPI. Confirmado direto contra
`GET /instance/status`: `connected:false, loggedIn:false`. Isso bloqueou
teste ao vivo com WhatsApp real de verdade nesta fase — o download de
mídia (`/message/download`) exige uma instância conectada de fato. A
implementação seguiu normalmente; a verificação foi adaptada (ver
"Testado" abaixo). Fica registrado como risco real de produto: TODO envio
automatizado da plataforma (não só o Pai) passa pela mesma UAZAPI
não-oficial — merece conversa separada sobre número novo + volume alto
logo na entrada.

**Schema** (`supabase/migrations/20260807d_whatsapp_pai_staged_media.sql`,
aditiva): `imf_whatsapp_staged_media(id, user_id, broker_id, url,
created_at)` — mesmo papel do array em memória da `CommandBar.tsx` no
painel, só que persistido (o WhatsApp entrega cada foto numa mensagem
separada, sem estado de sessão entre elas).

**Backend**:
- `server/services/propertyImages.ts` (novo) — `uploadPropertyImageBase64`
  extraída de `POST /api/properties/upload-image`
  (`server/routes/properties.ts`), que virou um wrapper fino em cima,
  comportamento idêntico (mesmo 413 pra imagem >8MB).
- `server/services/inboundMedia.ts` — `detectInboundMediaKind`,
  `mediaMessageId`, `declaredFileLength` exportadas (eram privadas) pra
  reuso no pipeline do Pai, evitando duplicar a extração de id/tamanho do
  payload da UAZAPI.
- `server/services/whatsappPaiQueue.ts` — `handleIncomingPhoto` (baixa
  via `downloadUazapiMedia`, sobe pro bucket via
  `uploadPropertyImageBase64`, grava em `imf_whatsapp_staged_media` — SEM
  `describeImageWithOpenRouter`: foto vira anexo puro, igual ao painel,
  zero dado extraído dela, conforme o plano) e `handleIncomingAudio`
  (baixa + `transcribeWithOpenRouter`, mesma IA já usada no pipeline do
  cliente, texto vira a `message` do `runAgent`). `fetchStagedPhotoUrls`
  busca as fotos staged do usuário e alimenta `opts.imageUrls` do
  `runAgent` — `create_property` já sabia carimbar isso sozinho desde a
  Fase 1 original do agente (`agent.ts:1068-1070`), zero mudança lá.
  Staging é limpo em `handlePendingAction` assim que um `create_property`
  é confirmado e executado.
- `server/services/maintenance.ts` — `expireStagedWhatsappMedia` (TTL
  60min, rede de segurança pro staging abandonado — usuário manda foto e
  some); job novo em `scheduler-worker.ts` (5 em 5 min).

**1 bug real de TypeScript achado e corrigido** (mesma causa-raiz já
documentada na Fase 2 desta sessão): `handleIncomingPhoto`/
`handleIncomingAudio` originalmente devolviam união discriminada
`{ok:true,...}|{ok:false,error}`, e `staged.ok ? ... : staged.error`
falhava a compilar ("Property 'error' does not exist on type '{ok:true}'
"). Isolado com repro mínimo: com `strictNullChecks` desligado neste
`tsconfig.json` (confirmado — não tem `"strict"` nem `"strictNullChecks"`
setados), `!x.ok`/`if(!x.ok)` NÃO estreita o tipo, só `x.ok === false`
estreita. Corrigido do mesmo jeito que da vez passada: as duas funções
passaram a lançar exceção em vez de devolver `{ok,error}`, call sites
usando try/catch.

**Testado**: como a instância central está banida/desconectada (ver
Contexto acima), o download real de mídia (`/message/download`) não
funciona neste momento — não dá pra testar o caminho feliz completo de
foto/áudio de verdade. O que FOI testado ao vivo, contra o servidor real
com conta descartável: (1) 2 fotos inseridas diretamente em
`imf_whatsapp_staged_media` simulando envio prévio → mensagem de texto
"cadastra um imóvel..." → a ação proposta (`imf_whatsapp_pending_actions`)
chega com `image_urls` contendo as 2 URLs staged, confirmando que
`fetchStagedPhotoUrls`→`runAgent`→`create_property.image_urls` funciona
de ponta a ponta; (2) "sim" → imóvel REAL criado em `imf_properties` com
as 2 fotos no campo `image_url`; (3) staging confirmado vazio depois
(limpeza funcionou); (4) mensagem de foto sintética contra a instância
desconectada → `downloadUazapiMedia` falha com HTTP 503 da UAZAPI → capturado,
logado, resposta amigável enviada ("Não consegui processar essa foto: ..."),
linha da fila termina `completed` (não trava, não vira `dead`, não
derruba o worker) — prova que a degradação graciosa funciona mesmo sem
conexão real. O caminho de download bem-sucedido em si (que já é uma
função comprovada, reusada do pipeline do cliente) fica pendente de
validação ao vivo pra quando houver um número pareado de novo. `npx tsc
--noEmit`, `npx knip` e `npm test` limpos (144/144), `npm run build` OK.

**Pendente**: autorização de commit/push (Fases 1-3 commitadas localmente,
`d5a0818`; Fases 4 e 5 ainda não). Fase 6 (novas consultas: leads hoje,
relatório do mês) segue disponível pra implementar sem depender de
WhatsApp real (mesmo padrão de teste da Fase 4/5 via payload sintético).
Fase 7 (documentos) fora de escopo.

## WhatsApp Pai — Fase 6: novas consultas (leads e relatório) — beneficia os dois canais (2026-08-07)

Duas ações novas, determinísticas em código (o modelo só decide QUANDO
chamar e extrai o parâmetro — nunca calcula o número, mesmo princípio já
usado em `query_agenda`): `query_leads` (leads captados num período,
opcionalmente só os "sem atendimento") e `query_report` (relatório de
desempenho — leads/visitas/vendas/locação do mês/trimestre/semestre/ano).
Como as duas vivem em `runAgent`/`executeAction`, o assistente do painel
ganha essas perguntas de graça, ao mesmo tempo que o WhatsApp Pai — não é
uma feature exclusiva de um canal.

**Backend**:
- `server/routes/relatorios.ts` — `buildRelatoriosSummary(brokerId,
  months, owner, targetUserId, scope)` extraída da rota `GET
  /api/relatorios/summary` (mesmo corpo, resposta idêntica); a rota virou
  wrapper fino que resolve `targetUserId`/`scope` (inclusive o
  drill-down por membro, que continua exclusivo da rota HTTP) e chama a
  função pura.
- `server/security/agentGuardrails.ts` — `queryLeadsAction`
  (`date_from` obrigatório, `date_to` e `filter` opcionais) e
  `queryReportAction` (`period` opcional: mes/trimestre/semestre/ano),
  adicionadas aos dois schemas Zod discriminados e a `NON_MUTATING_ACTIONS`
  (nunca pedem confirmação, igual `query_agenda`).
- `server/services/agent.ts` — `queryLeadsSummary` (consulta `leads` por
  `created_at`, filtra `status='new'` quando `filter='nao_atendidos'`,
  formata lista em texto) e `queryReportSummary` (chama
  `buildRelatoriosSummary` com `months` derivado do `period` e formata em
  texto curto). `AGENT_ACTION_PERMISSION` ganhou `query_leads:
  negocios:visualizar` e `query_report: relatorios:visualizar` — mesmo
  gate soft da Fase 1 (nem propõe/executa sem a permissão). Prompt do
  sistema ganhou os itens 7 e 8 explicando quando usar cada ação.

**Testado ao vivo**, conta descartável com titular + 1 membro, dados reais
semeados (3 leads — 2 hoje em estágios diferentes, 1 de ontem — e 1
visita realizada este mês), tudo via payload sintético contra o
WhatsApp Pai (mesmo `runAgent` do painel):
"quantos leads chegaram hoje" → 2 leads (exclui o de ontem, inclui nome/
telefone/estágio de cada um); "quais leads de hoje não foram atendidos"
→ só o 1 ainda em "new"; "relatório do mês" → "Leads captados: 3",
"1 realizadas" batendo com os dados semeados. Comparado com `GET
/api/relatorios/summary` via sessão real (magic-link) — mesmo total de
leads/visitas, confirmando que a extração ficou byte-idêntica. Membro
sem `negocios:visualizar`/`relatorios:visualizar` (revogado
explicitamente via `imf_set_member_permission`) → negado nos dois casos,
mesma mensagem de negação da Fase 1, provando o gate funcionando pras
ações novas. `npx tsc --noEmit`, `npx knip` e `npm test` limpos
(144/144), `npm run build` OK.

**Status do WhatsApp Pai**: Fases 1-6 completas. Fase 7 (documentos) fica
fora de escopo (sem conceito de anexo em nenhum objeto de domínio hoje).
Pendente: autorização de commit/push (Fases 1-3 commitadas, `2eb0282`
adicionou 4-5; Fase 6 ainda não commitada) e resolução do número
WhatsApp banido (ver Fase 5) antes de qualquer teste ao vivo real com
mídia/pareamento.

## Permissões granulares por membro da equipe (2026-08-06)

Pedido do usuário: titular de conta Imobiliária/Incorporadora controla,
por membro, o que cada um pode acessar — grade módulo × ação, perfis
prontos, acesso básico automático, histórico de auditoria. Pedido
original citava "Contas Agregadas"/"contas filhas ou vinculadas" —
investigação achou dois sistemas candidatos no código: `imf_broker_
members` (Equipe, mesma conta/dados, ativo) e `server/routes/
corretora.ts`/`CorretoraSettings.tsx` (agrupamento de contas
INDEPENDENTES por CNPJ). Perguntado, usuário confirmou querer os dois
unificados — mas auditoria do sistema Corretora mostrou que ele é
praticamente morto: 3 rotas, zero política de RLS, nenhum acesso a dado
de negócio entre contas (só nome/telefone/email), e nem aparece mais em
`/app` (só sobrevive num Dashboard legado, `/`, que o login não usa mais
desde a virada pro `/app`). Apresentado esse achado, usuário escolheu
focar só em Equipe nesta rodada — repartilhar dado entre contas
independentes (o que "permissões" no Corretora exigiria do zero, incluindo
RLS cruzando tenants inexistente hoje) fica fora de escopo.

Modelo hoje era binário: `imf_brokers.user_id === userId` (titular,
acesso total) ou membro (mesmo acesso pra todo mundo — a própria migration
`20260708d_broker_members.sql` documentava isso como "decisão de produto
adiada"). Esta rodada constrói o motor completo + aplica a 8 rotas que já
eram hard-coded titular-only, deixando configurável o que antes era fixo.

**Schema** (`supabase/migrations/20260806f_member_permissions.sql`,
aditiva): `imf_member_permissions` (`broker_id, user_id, module, action` —
normalizada, só guarda linha quando concedido; ausência = negado; titular
real NUNCA tem linha aqui, acesso dele é implícito via `isBrokerOwner`) +
`imf_permission_audit_log` (append-only, `change_type` grant/revoke/
profile_applied + `diff` jsonb). Duas RPCs novas
(`imf_set_member_permission`, `imf_replace_member_permissions`), ambas
`RETURNS VOID` de propósito — evita o mesmo problema de coluna ambígua em
`ON CONFLICT` que `20260806d` documentou (aqui não há coluna de saída pra
colidir, então `ON CONFLICT` é seguro), ambas com `FOR UPDATE` na linha do
broker primeiro (mesmo padrão de `imf_set_account_capabilities`). Os 6
perfis prontos (Administrador/Gestor/Corretor/Atendente/Financeiro/Só
visualização) ficam fixos como constante TypeScript, não uma tabela —
aplicar um perfil é substituição TOTAL da grade do membro (nunca união),
com uma única linha de auditoria `profile_applied` contendo
`{added, removed}`.

**Backend**: `server/services/permissions.ts` (novo) espelha exatamente
`accountCapabilities.ts` — `hasPermission(userId, brokerId, module,
action)` atalha por `isBrokerOwner` primeiro (titular sempre passa),
senão consulta um `Set` cacheado 60s (reaproveita `cacheGet`/`cacheSet`,
que precisaram virar `export` em `auth.ts`). 5 endpoints novos em
`equipe.ts` pra gerenciar a grade — **hard-coded pro `isOwner()` local do
arquivo, nunca `hasPermission`**: gerenciar permissão de outro é ação só
do titular real, nunca delegável nem pelo perfil "Administrador" (se
desse, um membro poderia se auto-conceder qualquer coisa e furar o modelo
por dentro). 8 arquivos de rota tiveram o gate duro trocado:
`equipe.ts` (convidar/remover/reatribuir/suspender/reativar/ranking/
performance/whatsapp-slots), `locacao.ts` (era UM gate bloqueando tudo —
virou um classificador por verbo/rota: GET→visualizar, POST→criar, PATCH/
PUT→editar, DELETE→excluir, rotas de config/régua→gerenciar, já que
contrato de aluguel não tem autor por corretor, não dá pra filtrar "só os
meus"), `crmPipelines.ts`, `financeiro.ts` (resumo), `relatorios.ts`
(drill-down), `brokers.ts` (chave Asaas), `lancamentos.ts` (7 sub-rotas
financeiras) e `conversations.ts` (bypass de dono em `canAccessTicket`).
Como titular sempre passa (comportamento idêntico a antes) e nenhum
membro existente tem linha nenhuma até o titular conceder, **o acesso de
todo mundo fica bit-a-bit igual ao de antes no dia do deploy** — zero
regressão, sem backfill. Seed de acesso básico (replica exatamente o que
um membro já fazia sem checagem nenhuma) em `POST /api/auth/join`.

**Frontend**: `src/experience/PermissionsModal.tsx` (novo) — aba Grade
(14 módulos × colunas de ação, só as válidas por módulo, checkbox
otimista) + aba Histórico (auditoria paginada, nomes resolvidos igual ao
padrão já usado em `equipe.ts`) + seletor de perfil com confirmação
explícita ("substitui toda a grade atual"). Novo ícone `ShieldCheck` na
mesma fileira de ações por membro de `EquipeArea.tsx` — não criou item
novo no menu lateral, a tela já É "Contas Agregadas" com outro nome.

**Verificado ao vivo**: 27 asserções via HTTP contra conta de teste
descartável (titular + membro inserido direto sem seed, simulando membro
pré-existente) — confirmam bit-a-bit que as 8 rotas se comportam
IDÊNTICO a antes pro membro sem grant nenhum (Locação 403, CRM pipelines
200 com `can_manage:false`, Financeiro zerado, drill-down de relatório
403, chave Asaas `can_manage:false` e POST 403, ranking 403); conceder/
revogar com efeito imediato (sem esperar TTL de cache); combinação
inválida (`financeiro:criar`) rejeitada com 400; titular não tem grade
própria (400); membro NUNCA gerencia permissão nenhuma, nem a própria
(403); aplicar perfil substitui (não une) e o histórico registra os 3
tipos de mudança com o nome do ator resolvido certo; fluxo real de
convite→entrada popula o seed de acesso básico corretamente. Checagem
visual adicional na interface real (sessão injetada, navegador): grade
renderiza os 14 módulos com as colunas certas, toggle de checkbox dispara
o PUT real e persiste, aba Histórico mostra o registro em português
correto. `tsc`/`knip`/`build` limpos; `npm test` só o CRLF conhecido —
precisou ajustar `tests/accountCapabilities.test.ts`, que travava o
texto-fonte antigo de `locacao.ts` (esperava `isBrokerOwner` bloqueando
tudo; agora confere `hasPermission(userId, brokerId, "locacao", action)`).

**Fora de escopo desta rodada, registrado**: CRUD próprio (criar/editar/
excluir o PRÓPRIO registro) em Leads/Imóveis/Agenda — hoje sem checagem
nenhuma, revogar isso é mudança de comportamento maior e as mesmas rotas
também são chamadas pelo n8n agindo "como" um membro; perfis customizados
além dos 6 fixos; enforcement no módulo Contatos (catalogado, sem rota
gated ainda); sistema Corretora (continua só metadado, intocado).

## Fix: exclusão de conta (admin) falhava com FK ambígua (2026-08-06)

Usuário tentou excluir uma conta no painel admin (`imobiflow-v2.fly.dev/
admin`) e bateu em `Não foi possível excluir a conta: update or delete on
table "imf_brokers" violates foreign key constraint "properties_broker_
id_fkey"`. `DELETE /api/admin/brokers/:id` (`server/routes/admin.ts`) só
fazia `DELETE FROM imf_brokers`, com um comentário dizendo que o CASCADE
limpava propriedades/leads via FK — não limpa.

Pedi ao usuário uma query de diagnóstico (`information_schema` completo
de FKs do schema public) pra mapear com certeza, sem adivinhar, o que
precisava de limpeza explícita antes do broker sumir — dado que o banco é
compartilhado com outros projetos (CVV, Criate IA, Assistente Matheus
etc.), qualquer suposição errada poderia tocar tabela de fora do
ImobiFlow. Achado: 8 tabelas do núcleo ImobiFlow têm `broker_id ->
imf_brokers` SEM `ON DELETE CASCADE` (`imf_broker_goals`,
`imf_conversation_messages`, `imf_developments`, `imf_properties`,
`imf_rental_contracts`, `imf_reservation_documents`,
`imf_unit_reservations`, `leads`), mais `imf_rental_payment_receipts` que
trava o contrato via `RESTRICT` no `contract_id`. Achado à parte, mais
sério: `imf_agenda.broker_id` não tem FK NENHUMA pra `imf_brokers`
(coluna criada em `20260708e_member_data_isolation.sql` sem
`REFERENCES`) — não bloqueava a exclusão, mas os eventos de agenda
ficariam órfãos pra sempre, sem erro nenhum, silenciosamente.

Migration `20260806e_admin_delete_broker_cascade.sql`: função
transacional `admin_delete_broker_cascade(p_broker_id)` que apaga, na
ordem certa (recibos antes do contrato por causa do `RESTRICT`;
documentos de reserva antes da própria reserva por causa de uma FK
composta — achado ao vivo numa primeira versão da função que tinha essa
ordem trocada e falhava exatamente nesse ponto), todas as tabelas sem
CASCADE, incluindo `imf_agenda`, antes do `DELETE FROM imf_brokers`
final (que resolve o resto via CASCADE já cadastrado). `admin.ts` trocou
o `DELETE` direto por uma chamada RPC a essa função — se qualquer passo
falhar, tudo desfaz (mesmo comportamento seguro de antes quando dava
erro, só que agora funciona quando está tudo certo).

Testado ao vivo com conta de teste descartável populada em TODAS as 10
tabelas relevantes (incluindo dependências como `imf_rental_payments` e
`imf_units`, que não tinham FK direta pro broker mas eram necessárias pra
popular as que têm) — exclusão via `DELETE /api/admin/brokers/:id` real,
confirmado que cada uma das 10 tabelas + o broker + o usuário no Auth
ficaram vazios depois, zero linha órfã. Escopo confirmado só ImobiFlow
(`imf_`/núcleo sem prefixo como `leads`) — nenhuma tabela de outro
projeto do banco compartilhado é lida, escrita ou mencionada na função.

## Fix: CRM (aba Negócios) inteiro fora do ar por bug de coluna ambígua (2026-08-06)

Usuário reportou "Erro ao carregar pipelines." na conta convidado —
investigação mostrou que era um bug pré-existente (de sessão anterior,
não desta), afetando **qualquer conta**, não só convidado. `GET /api/crm/
pipelines` chama `ensureDefaultPipeline` primeiro, que chama a RPC
`imf_crm_ensure_default_pipeline()` — essa função já tinha um bug
conhecido de coluna ambígua (`RETURNS TABLE (pipeline_id UUID, ...)` cria
uma variável de saída chamada `pipeline_id`, que colide com a coluna
`pipeline_id` de `imf_crm_pipeline_stages`), e já existia uma migration
de correção no repo (`20260721d_fix_crm_ensure_default_pipeline_ambiguous_
column.sql`) — só que **nunca tinha sido aplicada** no Supabase.

Usuário aplicou essa migration antiga — o erro continuou idêntico. Achei
um SEGUNDO ponto ambíguo que aquela correção não cobriu: `ON CONFLICT
(pipeline_id, position) DO NOTHING` no INSERT das etapas seed. O alvo de
um `ON CONFLICT` aceita expressões (índices podem ser sobre expressões),
não só nomes de coluna puros, então o Postgres aplica a MESMA resolução
de identificador ali — e como o alvo de conflito não aceita alias
(`stage.pipeline_id` não é válido nessa posição), não dava pra corrigir
do mesmo jeito que o WHERE/SELECT.

Nova migration `20260806d_fix_crm_ensure_default_pipeline_on_conflict_
ambiguous.sql`: troca `ON CONFLICT DO NOTHING` por um bloco
`BEGIN...EXCEPTION WHEN unique_violation THEN NULL; END;` — mesmo padrão
de idempotência já usado na própria função, algumas linhas acima, pra
criar o pipeline padrão. Evita completamente a lista de colunas do alvo
de conflito.

**Testado ao vivo**: confirmei o bug persistindo com uma chamada direta
via `supabase-js` (conexão nova, sem cache), bypassando o servidor local,
antes de propor a segunda correção — descartou hipótese de cache de
conexão. Depois de aplicada, a mesma chamada direta funcionou
(`{pipeline_id, first_stage_id}` sem erro), e `GET /api/crm/pipelines`
via HTTP funcionou tanto pro titular quanto pro convidado. Nenhum código
TypeScript mudou — o bug era 100% no banco; só a migration nova precisa
ser commitada (documentação do fix, já aplicado em produção pelo usuário).

## Follow-Up Inteligente: fecha brecha de disparo com timing velho (2026-08-06)

Usuário pediu pra revisar a regra de cancelamento: follow-up só deve rodar
com a IA ativa e conduzindo; se um humano assume ou responde, cancela na
hora; com a IA desligada, nunca dispara. Auditoria em todos os lugares que
gravam `senderType: "broker_manual"` ou mexem em `ai_active` de
`followup_conversations` (`agent.ts` x2, `conversations.ts` reply x2,
`followup.ts` rota `/broker-reply` do N8N, `conversas/create`, `ai-toggle`):

- **Regra 1 (IA ativa) e regra 3 (IA desligada)** já funcionavam 100% —
  a RPC `claim_due_followups_v2()` sempre exigiu `ai_active = TRUE` e
  `cfg.enabled = TRUE` pra sequer considerar claimar uma conversa.
- **Regra 2 (assumiu/respondeu → cancela na hora)**: os 2 caminhos que
  passam por `pauseAiForHumanTakeover` (`agent.ts`, resposta manual em
  `conversations.ts`, `/broker-reply` do N8N) já setavam `ai_active=false`
  **e** `follow_sent=true` — corretos. Achei 2 que só setavam
  `ai_active=false`, sem `follow_sent=true`: `PATCH /api/conversas/
  :ticketId/ai-toggle` (pausar a IA numa conversa sem responder nada) e
  `POST /api/conversas/create` (corretor abre conversa nova manualmente).
  `ai_active=false` sozinho já bloqueia a RPC NA HORA (regra 2 cumprida
  no sentido estrito) — mas sem `follow_sent=true`, se o corretor religasse
  a IA depois (`ai-toggle` com `ai_active:true`) sem o cliente ter mandado
  mensagem nova, o `follow_message_index`/`last_customer_message_at`
  continuavam com timing de ANTES da pausa — podendo disparar um follow-up
  na próxima checagem (60s), do nada, sem relação com o silêncio real do
  cliente depois da IA voltar.
- **Fix**: os 2 endpoints passaram a gravar `follow_sent=true` também
  (só no ramo de desligar — religar não mexe nisso, fica travado até o
  cliente mandar mensagem nova de verdade, que aí sim reseta `follow_sent`
  via `/api/followup/inbound`, o mesmo caminho que sempre existiu).
- **Testado ao vivo**: criei ticket+conversa de teste com `ai_active=true`
  e horário de silêncio já vencido (1h atrás, delay configurado 30min).
  Desliguei a IA via `ai-toggle` (sem responder nada) → `follow_sent`
  virou `true`. Religuei a IA logo em seguida (sem o cliente mandar nada
  novo) → `follow_sent` continuou `true`. Chamei a RPC → não claimou essa
  conversa (confirmando que o disparo com timing velho foi bloqueado —
  sem o fix, essa mesma sequência dispararia o Follow 1 na hora). Limpeza
  feita depois. `tsc`/`knip`/`build`/`npm test` limpos (só o CRLF
  conhecido, não relacionado). Nenhuma outra parte do fluxo mexida, como
  pedido.

## Follow-Up Inteligente: de 3 passos fixos pra até 8 (2026-08-06)

Usuário pediu (via print da tela) expandir a régua de reativação de lead
de 3 pra até 8 passos, revelados um por vez com um "+" abaixo do último
bloco (não mostrar os 8 vazios de cara). Achado logo no início: a tela
existe em 2 lugares (Dashboard antigo `/` e `/app` novo) — perguntei ao
usuário, confirmou mexer só no `/app` (Dashboard antigo fica travado em
3, sem regressão).

- **Migration** `20260806c_followup_progressive_steps.sql` (aplicada pelo
  usuário no SQL Editor): `follow_count` (1-8, default 3) +
  `delay_minutes_4..8`/`message_4..8` em `followup_config`, e a RPC
  `claim_due_followups_v2()` reescrita pra 8 passos, limitada por
  `follow_count`. **Gotcha real**: a primeira tentativa deu erro `42P13`
  (Postgres não deixa `CREATE OR REPLACE FUNCTION` trocar o tipo de
  retorno de uma função existente) — corrigido adicionando `DROP FUNCTION
  IF EXISTS` antes do `CREATE`, dentro da mesma transação (sem janela em
  que a função "some"). Segunda tentativa aplicou limpo.
- **Backend**: `followup.ts` (rotas) ganhou os campos novos no GET/POST;
  `followup.ts` (serviço, `runFollowupTick`) trocou o único hardcode `< 3`
  do arquivo por `< row.follow_count` (campo novo que a RPC devolve).
- **Frontend** (`AssistenteIAArea.tsx`, `FollowUpCard`): `FOLLOWS` virou
  3 objetos originais + 5 gerados por loop (prazo semanal 14d/21d/28d/
  35d/42d); render em `FOLLOWS.slice(0, cfg.follow_count)`; botão "+"
  tracejado abaixo do último bloco (só até 8) soma `follow_count` no
  estado local, sem auto-save — persiste só ao clicar "Salvar Follow-Up".
  2 textos que citavam "3" viraram dinâmicos.
- **Testado ao vivo** (sessão real minerada, mesmo padrão de sempre):
  `GET /api/followup/config` de um broker existente devolveu
  `follow_count: 3` certo (sem quebrar quem nunca mexeu); UI revelou os 8
  blocos um a um clicando "+", "+" sumiu no 8; salvou Follow 4 preenchido,
  deu F5, continuou em 8 blocos com a mensagem do Follow 4 batendo com o
  banco (`GET` confirmou `follow_count:8, message_4:"..."`); RPC testada
  direto no banco com uma conversa de teste no índice 6 — 1ª chamada
  claimou certo (`message_index:7`, `message_7`, `follow_count:8`), 2ª
  chamada imediata não repetiu (atomicidade preservada); linha de teste e
  configuração apagadas depois. `tsc`/`knip`/`build` limpos; `npm test`
  (só o CRLF conhecido, não relacionado).

## Fix: Financeiro também vazava caixa de aluguel pro convidado (2026-08-05)

Usuário apontou (print do ícone "Financeiro" na sidebar do convidado): "se
não tem a parte de aluguel, não deve ter esse financeiro". Auditando
`server/routes/financeiro.ts` achei a mesma classe de bug do fix anterior:
o bloco de aluguel (`imf_rental_contracts`, inadimplência, recebimentos)
não tinha NENHUMA checagem de titularidade — qualquer convidado via a
receita mensal, contratos ativos, atraso e recebimentos da empresa
inteira via `GET /api/financeiro/summary`, mesmo sem acessar Locação
diretamente. Só o bloco de vendas de lançamento já era corretamente
escopado por `sold_by_user_id` pra quem não é titular (comentário original
"dono vê o total da conta, corretor só a própria" — desenhado de propósito
pra corretor de incorporadora ver a própria venda).

Fix (preserva esse self-service, só fecha o vazamento de aluguel):
- Backend: a query de `imf_rental_contracts` só roda se `isBrokerOwner` —
  não-titular recebe os campos de aluguel todos zerados; o bloco de
  vendas continua igual (própria venda pra não-titular, total pra titular).
- Frontend (`ManualRail.tsx`): a aba "Financeiro" só entra em
  `OWNER_ONLY_AREAS` pra quem não tem a capability `developments` — ou
  seja, some pra convidado de conta só-aluguel (nada sobra pra ele ver
  ali), mas continua aparecendo pra corretor de incorporadora (que ainda
  tem a própria venda pra conferir).
- Verificado: `curl` direto em `/api/financeiro/summary` como convidado
  não dá mais erro nem vaza contrato (campos de aluguel zerados). Na UI,
  convidado da conta de teste (só `rentals`, sem `developments`) parou de
  ver a aba Financeiro; titular continua vendo normal. `tsc`/`knip`/
  `build`/`npm test` (95/96, só o CRLF conhecido) limpos.

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
