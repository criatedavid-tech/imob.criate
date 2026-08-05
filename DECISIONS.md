# Decisões vigentes

## Conta administradora: titular gerencia a equipe, super admin fica intocado (2026-08-05)

- Super admin (`is_admin`) e titular de conta continuam sendo dois conceitos
  totalmente separados — não houve (e não precisou haver) nenhuma mudança
  na separação existente. O que mudou foi o poder do TITULAR sobre a
  própria equipe, não uma ponte nova entre os dois papéis.
- As 4 lacunas fechadas nesta rodada (reatribuir dados, suspender sem
  remover, drill-down de relatório, meta individual) foram escolhidas pelo
  usuário dentre as encontradas na auditoria — todas marcadas como "decisão
  de produto em aberto" no próprio código antes desta mudança.
- Reatribuição de dados não exige que a origem ainda seja membro ativo —
  decisão deliberada pra um único endpoint cobrir tanto "reatribuir antes
  de remover" quanto "limpar órfãos de quem já saiu".
- Suspender desconecta o WhatsApp próprio do membro (best-effort); reativar
  não reconecta sozinho — o membro usa o botão "Conectar" de sempre. Decisão
  pela opção mais simples/reversível quando havia dúvida, documentada como
  limitação conhecida, não como pendência obrigatória.
- Locação fica de fora do drill-down de relatório por membro (só aparece na
  visão consolidada da conta) porque não existe autoria de locação por
  corretor individual hoje — mostrar o caixa da empresa inteira atribuído a
  uma pessoa seria enganoso.
- Sistema paralelo `corretora.ts` (agrupamento por CNPJ de contas
  independentes) ficou fora desta rodada — o usuário não reconheceu o
  conceito ("não sei o que é isso"). Não foi tocado nem removido; fica como
  pendência a esclarecer antes de qualquer decisão sobre ele.

## CRM automático no agente de vendas: gatilhos deterministas, não julgamento do modelo (2026-08-05)

- O agente de vendas do WhatsApp cria/atualiza lead assim que sabe nome +
  telefone + interesse real — decisão do usuário: o BACKEND garante isso
  (idempotente, dedupe por telefone), a IA só relata fatos que já apurou,
  nunca "decide" se vale criar. Endpoint `POST /api/crm/n8n/sync-lead`
  (`server/routes/crmSalesAgent.ts`), token interno, nunca lança erro (é
  caminho crítico de atendimento real).
- Mover lead pra etapa "Visita" acontece automaticamente quando o agente
  agenda uma visita de verdade (hook em `POST /api/agenda/n8n/create`) —
  não é uma ferramenta que o modelo aciona por julgamento. Etapa é casada
  por nome ("visita", case-insensitive) porque pipelines são customizáveis
  por broker; se renomeada/apagada, a movimentação simplesmente não
  acontece (não quebra nada).
- Qualificação (região/quartos/orçamento/finalidade) vai pro `leads.notes`
  já existente, sobrescrito com o resumo mais recente — escolha explícita
  do usuário pra não precisar de migration nesta rodada. Filtro/relatório
  por campo estruturado fica pra quando for pedido.
- `property_id` vindo do modelo NUNCA é aceito sem validar que pertence ao
  broker (mesma checagem de `agenda.ts`) — testado ao vivo: um id de outro
  corretor foi rejeitado silenciosamente, um id real foi aceito.
- Escopo desta rodada é só o agente de **vendas**; o agente de **locação**
  já tem sistema equivalente próprio (contratos/régua de cobrança) e não
  foi tocado. Mover pra "Proposta"/"Fechado" automaticamente e tags/scoring
  de lead ficaram de fora (não pedidos, não construídos).

## WhatsApp adicional exige consentimento no convite (2026-08-04)

- Plano pago nunca recebe cobrança silenciosa: ao exceder a cota de WhatsApps
  próprios, o titular vê preço unitário, novo total mensal e vigência no próximo
  ciclo antes de confirmar.
- A confirmação, o aumento de `member_limit` e a criação do convite acontecem
  numa única RPC transacional. Falha em qualquer etapa reverte toda a operação.
- Cada tentativa leva `request_id` único; repetição por duplo clique ou perda de
  conexão devolve o convite original e não adiciona outra vaga.
- Voucher não compra add-on. Ao atingir a concessão administrativa, o usuário
  pode convidar com WhatsApp compartilhado ou solicitar nova condição à Criate.
- Convites pendentes continuam reservando vaga para impedir venda concorrente
  acima da cota; o teto comercial vem de `MEMBER_WHATSAPP_SLOT_MAX` no servidor.

## Vouchers são concessões de acesso, não pagamentos simulados (2026-08-04)

- Voucher é criado somente por administrador e tem uso único, modalidade,
  validade do link, duração do teste e limite de corretores convidados.
- O código bruto é mostrado uma vez e nunca salvo; persiste-se apenas SHA-256
  e uma dica parcial para auditoria.
- O resgate cria `plan='experimentacao'` sem cliente, assinatura ou cobrança no
  Asaas. Ao término, a conta fica inativa e deve contratar um plano real.
- O limite informado significa corretores adicionais além do titular. Para
  corretor autônomo ele é sempre zero.
- A quantidade total de convidados e a quantidade de convidados com WhatsApp
  próprio são cotas independentes. O titular continua na instância principal;
  o admin pode liberar de zero até o total de corretores do voucher para terem
  instância individual.
- Durante `plan='experimentacao'`, a autorização de WhatsApp próprio vem de
  `trial_whatsapp_member_limit`, nunca do add-on pago `member_limit`. Convites
  pendentes reservam a vaga para impedir sobrecontratação concorrente.
- Ao contratar depois do teste, a conta não pode selecionar menos slots pagos
  do que os corretores que já utilizam WhatsApp próprio.
- Resgate e controle de vagas ficam em RPCs transacionais com locks no banco;
  validação apenas no frontend não é considerada autorização.
- A migration deve preceder o deploy porque cadastro e convite de equipe passam
  a depender das novas RPCs.

## Projeto e entrega

- **V2 é o único produto ativo.** Branch `v2` e app Fly `imobiflow-v2`; V1/main
  permanece congelada como rollback.
- **Checkout canônico único.** Claude e Codex trabalham somente em
  `work/imob.criate-phase3`; `C:\Users\Criate\imob.criate` está congelado.
- **PMP v2.0.** `PROJECT.md`, `ARCHITECTURE.md`, `PROGRESS.md`, `DECISIONS.md` e
  `NEXT_TASK.md` formam a memória curta; `DOCUMENTACAO.md` mantém o detalhe.
- **Deploy automático.** Push em `v2` valida com `npm ci`, testes automatizados,
  TypeScript, Knip e build antes de publicar. Não há gate manual posterior.
- **Migrations manuais.** O usuário sempre executa SQL no Supabase; deploy não
  aplica banco.
- **Baseline operacional auditado em 27/07/2026.** O commit `8aae185` está na
  release Fly `v181`: três `web` ativas, um `scheduler` singleton ativo, um
  `worker` ativo e uma segunda Machine de worker em standby. Redis está ativo;
  Sentry não está configurado. Essa topologia é disponibilidade/capacidade
  potencial, não certificação de carga.

## Segurança e dados

- **Auditoria de dependências em 28/07/2026.** `body-parser` foi atualizado para
  `1.20.6` e `postcss` para `8.5.24`. O alerta restante do npm para
  `react-router@7.18.1` refere-se exclusivamente às APIs RSC instáveis, que o
  ImobiFlow não importa nem executa: a aplicação usa `BrowserRouter` como SPA.
  Não executar `npm audit fix --force` nem rebaixar para `7.11.0`; esse
  downgrade elimina o alerta RSC, mas reintroduz vulnerabilidades de XSS, open
  redirect e DoS aplicáveis ao roteamento tradicional. As alterações de
  dependências mantêm origem e integridade no registro oficial do npm e não
  adicionam endpoints, webhooks ou scripts de instalação ao projeto.
- **Tenant resolvido no backend.** `service_role` nunca confia em `broker_id`
  recebido do cliente.
- **CRM transacional.** RPCs `SECURITY DEFINER` são exclusivas da
  `service_role`; reorder, troca de padrão, autocura e transições são atômicos.
  A migration `20260720b_crm_security_hardening.sql` já foi aplicada e
  verificada.
- **Bug crítico na autocura do CRM, achado em 21/07/2026.**
  `imf_crm_ensure_default_pipeline` usava `RETURNS TABLE (pipeline_id UUID,
  ...)`, criando uma variável de saída com o mesmo nome de uma coluna real de
  `imf_crm_pipeline_stages`; uma referência sem alias no corpo da função virou
  coluna ambígua (42702) e derrubava 100% das chamadas de `GET /api/crm/
  pipelines`, pra qualquer broker, desde que `20260720b` foi aplicada — só
  descoberto agora por falta de QA autenticado ao vivo da tela Negócios/CRM.
  Corrigido em `20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql`
  (só qualifica a referência; mesma função, sem mudar assinatura/RPC). Lição:
  em função `RETURNS TABLE`, nunca reusar nome de coluna real como nome de
  saída sem qualificar toda referência a essa coluna no corpo.
- **Exclusão segura.** Leads não usam CASCADE com pipeline/etapa; pipelines e
  etapas usam CASCADE apenas ao excluir o broker inteiro.
- **Compatibilidade CRM.** Pipeline/etapa são fonte de verdade; trigger mantém
  `leads.status`/`closed_at` para relatórios e integrações legadas.

## Produto e experiência

- **Tipo principal não é pacote de funcionalidades (2026-08-03).**
  `account_type` continua definindo onboarding e cockpit inicial, preservando
  compatibilidade. Locação, Lançamentos, Financeiro e Equipe passam a ser
  entitlements combináveis por conta. A ausência de override mantém os três
  comportamentos históricos; o admin pode conceder ou retirar funções sem
  trocar o tipo principal. O plano comercial ainda não possui tiers formais:
  nesta etapa o ajuste é administrativo, e planos futuros devem provisionar a
  mesma camada de capabilities em vez de criar novas condicionais de persona.
- **Autorização de função é do servidor (2026-08-03).** O rail apenas reflete o
  acesso. Rotas especializadas e ações confirmadas da IA revalidam a capability
  efetiva. Clientes não podem elevar acesso alterando `persona` no request; só
  administradores mantêm o modo de visualização “ver como”.

- **Etapa 1 do cadastro vira cards de plano, sem preço diferenciado ainda
  (2026-07-27).** Pedido do usuário com referência visual (pricing estilo
  Zapier). Decisões confirmadas com o usuário (AskUserQuestion): preço fica
  "na sandbox" — os 3 planos (Corretor autônomo/Imobiliária/Incorporadora)
  mostram o mesmo valor real de `GET /api/config/plan`, sem cobrança
  diferente por tier ainda; o fluxo do wizard continua o mesmo (só a Etapa 1
  mudou de aparência); "mais popular" no Corretor autônomo; toggle
  Mensal/Anual é decorativo (Anual mostra "chega em breve", não muda preço
  nem ciclo de cobrança). Único diferencial real entre planos: o add-on de
  WhatsApp por membro da equipe (já existente, só pra imobiliária/
  incorporadora). Ajuste posterior: a largura do card do wizard (`max-w-3xl`)
  ficou constante nas 3 etapas — uma primeira versão alargava só a Etapa 1 e
  o usuário reportou que o salto de largura ao avançar de etapa prejudicava
  a UX; corrigido mantendo a largura fixa e centralizando os campos das
  Etapas 2/3 (`max-w-md mx-auto`) dentro do card largo.
- **Conversas é inbox, não Kanban de arrastar (2026-07-23).** Perguntado
  explicitamente ao usuário (AskUserQuestion) antes de reescrever a tela:
  Kanban literal (colunas + drag-and-drop, como `NegociosArea.tsx`) vs inbox
  reorganizado (Zendesk/Intercom/Chatwoot). Escolhido inbox — motivo: uma
  conversa recebe mensagem nova a cada poucos segundos (poll 3-5s) e precisa
  de resposta rápida; arrastar um card "ao vivo" é incomum pro gênero e mais
  arriscado no mobile. A referência a "Kanban/pipeline" do pedido original
  vira linguagem visual (pills de categoria/badges), não mecanismo de drag.
  Ticket "encerrado" agora pode ser reaberto (botão "Reabrir") — o bloqueio
  de imutabilidade em `PATCH /api/conversas/:ticketId/status` foi removido;
  a checagem de "outro ticket ativo pro telefone" já existente é o
  guarda-corpo real, e `ensureConversationTicket` já convergia reabertura
  manual e automática pro mesmo ticket_id com segurança.
- **Broadcast do assistente não pausa a IA + trava de 50 (2026-07-22).** A ação
  `broadcast_message` (enviar pra todos os contatos salvos) grava como
  `senderType:"ai"` e NÃO faz handover — divulgação é proativa, a IA deve
  continuar atendendo quem responder (ao contrário de `send_message`, que pausa).
  Destino sempre resolvido no servidor (nunca o modelo manda números); teto de
  50 contatos por vez — envio em massa real continua no roadmap (transporte
  nativo). Confirmação mostra contagem real + prévia porque o backend reescreve
  o `reply` (a UI só exibe o reply). Mensagem de divulgação SEMPRE inclui o
  `vitrineUrl` do contexto e nunca cita "área de divulgação"/telas internas.
- **Divulgação mostra a vitrine real, não promessa (2026-07-22).** O card "Ainda
  não disponível" (portais + campanha em massa) saiu; no lugar, uma prévia ao
  vivo via `iframe` da própria `/vitrine/:brokerId` (same-origin, CSP
  `frameAncestors 'self'`). Regra: preferir mostrar o que já funciona a listar o
  que ainda não existe. Portais/campanha continuam no roadmap, mas fora da tela.
- **CRM configurável.** As cinco colunas fixas foram substituídas por pipelines
  por broker; membros não administram a estrutura.
- **DnD mobile.** Kanban usa `@dnd-kit/core`, não HTML5 DnD nativo.
- **Upload mobile.** O padrão é input de arquivo transparente diretamente
  clicável; não usar `.click()` programático nem `display:none`.
- **Escopo financeiro.** O produto registra/exibe valores, mas não cobra
  aluguel, reserva ou pagamentos de clientes. Asaas serve à assinatura SaaS.
- **Sem custódia nem fallback financeiro.** A integração histórica de cobrança
  de clientes permanece desligada. Se reativada de forma explícita, aluguel e
  sinal só podem ser gerados na conta Asaas própria da imobiliária ou
  incorporadora. Sem conta própria, a operação é bloqueada; a conta global da
  Criate nunca recebe esses valores e o ImobiFlow não faz saldo ou repasse.
- **Locação registra, mas não recebe.** Competências mensais e recebimentos
  externos são registros declaratórios da imobiliária, com suporte a parcial,
  data e forma. Eles não disparam cobrança nem representam conciliação
  bancária. Havendo qualquer competência, o contrato deixa de admitir exclusão
  definitiva e deve ser encerrado para preservar o histórico.
- **Inquilino é cadastro, contrato é fotografia (2026-08-03).** O perfil do
  inquilino é reutilizável dentro da mesma conta e pode receber dados atuais de
  contato. Cada contrato preserva os campos cadastrais usados na vinculação e
  continua sendo o histórico jurídico/operacional. Inquilino com contrato não
  é apagado: deve ser marcado como inativo. Backend e trigger rejeitam vínculo
  entre contas diferentes.
- **Sistema de cores "Cristal" + tema Dia/Noite (2026-07-22).** A pedido do
  usuário, mudança APENAS de cores (layout/estrutura idênticos): paleta Cristal
  (grafite frio, acento azure->aqua, latão premium) via tokens CSS em
  `src/index.css` (`:root` = Noite, `:root[data-theme="light"]` = Dia). Duas
  alavancas evitam editar 30+ arquivos à mão: (a) `@theme` remapeia as famílias
  Tailwind antigas (violet/purple/blue->accent, indigo->accent-2, emerald/green/
  teal->success, amber/yellow->warning, red/rose->danger) pros tokens, que
  reagem ao tema; (b) um codemod trocou os neutros `text/bg/border-white/x` por
  tokens. Latão é reservado a dinheiro (R$/VGV) + selo premium, nunca área
  grande. O toggle (`src/lib/theme.ts` + `ThemeToggle.tsx`, padrão Noite,
  localStorage) está habilitado (`THEME_TOGGLE_ENABLED=true`) depois das
  rodadas de QA e correções de contraste/responsividade do modo Dia.
  ⚠️ `@theme` do Tailwind v4 não aceita comentário dentro do bloco, e cuidado
  com `*/` em comentários CSS (fecha cedo).

## WhatsApp e IA

- **Inbox/outbox antes de escalar máquinas (2026-07-21).** A UAZAPI só recebe
  ACK depois da persistência em `imf_webhook_inbox`; processamento e despacho
  ao N8N usam claims recuperáveis e `imf_webhook_outbox`. PostgreSQL é a fonte
  durável nesta primeira etapa, evitando introduzir Redis/BullMQ antes de
  existir medição de carga. A entrega ao N8N é at-least-once, com `event_id`
  estável para deduplicação do workflow.
- **Worker de webhook separado da API (2026-07-21).** O process group `web`
  não executa mais os ticks nem o gatilho local depois do ACK; o grupo
  `worker` faz polling da inbox/outbox e drena o ciclo ativo no desligamento.
  Isso isola CPU/memória de texto, áudio e imagem e permite escalar os workers
  sem aumentar a API. O n8n não foi alterado nesta etapa.
- **URL pública única e versionada (2026-07-21).** A V2 usa somente
  `PUBLIC_APP_URL`, definida no `fly.toml`. Links, redirects e webhooks não
  aceitam fallback para endereço externo armazenado em secret.
- **Scheduler dedicado antes de escalar a API (2026-07-22).** Os jobs
  periódicos saíram de `server.ts` e passaram a `scheduler-worker.ts`, com
  prevenção de sobreposição, recuperação após erro e drenagem no SIGTERM. O
  Fly mantém `scheduler=1`. Em 27/07/2026 há 11 jobs, três `web`, Redis
  compartilhado e um worker ativo; o `worker` continua escalável de forma
  independente conforme backlog medido.
- **Redis protege a escala, não carrega a fila (2026-07-24).** Redis Upstash é
  usado para rate limit distribuído entre as três web. Inbox/outbox continuam
  duráveis no PostgreSQL. A conexão usa timeouts curtos e fail-open: uma falha
  do Redis reduz temporariamente a proteção distribuída, mas não deve derrubar
  a plataforma. Para o endpoint Upstash/Fly, a implementação prefere IPv6.
- **Carga pesada nunca direto em produção (2026-07-22).** O harness bloqueia
  `imobiflow-v2.fly.dev` por padrão. Testes realistas usam staging/conta de
  teste com provedores isolados; produção recebe apenas smoke curto e
  controlado. Critérios estão em `SCALABILITY_TEST_PLAN.md`.
- **Modelo não autoriza mutação (2026-07-22).** Dados do snapshot e mensagens
  de clientes são contexto não confiável fora do `system`; JSON do OpenRouter
  passa por schema Zod estrito. Toda ação mutável exige confirmação humana,
  mesmo no modo piloto. O modo ausente/inválido falha para `copiloto`.

- **UAZAPI direta.** Não existe intermediário de mensagens; a reconexão
  reafirma o webhook canônico da V2.
- **Sem rota externa de compatibilidade.** Respostas automáticas usam
  `/api/wpp-shim/ai-reply` com `INTERNAL_PROXY_TOKEN`; envios manuais e jobs
  resolvem a instância UAZAPI diretamente. Endpoints órfãos e autenticação por
  credencial de terceiro foram removidos.
- **Política de privacidade atualizada.** A lista de operadores menciona apenas
  os fornecedores efetivamente usados. `TERMS_VERSION=2026-07-21` exige novo
  aceite dos usuários depois do deploy.
- **Mídia processada e reproduzível no backend.** PTT e imagem privados viram
  texto antes do N8N; áudio, imagem e documentos suportados podem persistir
  uma URL de Storage para reprodução no chat. Base64 bruto não é persistido,
  falhas geram fallback, `provider_message_id` evita duplicação e um job de
  backfill tenta completar mídia histórica sem URL.
- **Prompt em duas camadas.** `PROMPT-AGENTE-WHATSAPP.md` contém regras-base
  protegidas; `broker_agents.system_prompt` contém preferências complementares.
  Personalização não pode reduzir privacidade, veracidade ou segurança de tools.
- **Transparência.** O agente fala de modo humano e conciso, mas não afirma ser
  uma pessoa real quando perguntado.
- **Nome público único.** O N8N deve usar `imf_brokers.ai_name`, configurado na
  interface; `broker_agents.agent_name` é fallback legado e `Juliana` é o
  fallback final.
- **Assistente interno sem metacomentário.** Mensagens que o assistente
  interno do app (`server/services/agent.ts`, ação `send_message` — distinto
  do agente externo do WhatsApp acima) escreve para o CLIENTE nunca podem
  narrar a própria ação (proibido "estou fazendo um follow-up...", "isto é um
  lembrete automático..."); regra explícita + exemplo no prompt, validada com
  chamada real ao modelo.
- **Ações agendadas do assistente interno (2026-07-21).**
  `create_reminder` (lembrete) e `schedule_followup` (envio futuro real)
  resolvidas de duas formas diferentes por natureza: lembrete reaproveita a
  Agenda existente (nenhuma tabela nova — não existe hoje nenhum sistema de
  notificação/sino no app); follow-up agendado precisa de execução autônoma
  de verdade, então usa tabela nova (`imf_agent_scheduled_followups`) + job
  de 60s. Prazo relativo ("24h", "2 dias") nunca é calculado pelo modelo —
  só número+unidade, o resto é determinístico em código (mesmo princípio de
  `query_agenda`). O texto da mensagem agendada é composto no momento do
  PEDIDO, não regenerado na hora do envio — o corretor revisa o texto exato
  antes de confirmar (copiloto/manual), igual a `notify_message`. O envio
  agendado grava `sender_type='ai'` e não pausa o atendimento da IA depois
  (trata como automático, não como intervenção manual do corretor — ao
  contrário de `send_message`, que pausa).
- **create_reminder/schedule_followup também aceitam horário absoluto
  (2026-07-21).** Bug real relatado pelo usuário: pediu "às 16:00" e o
  sistema agendou pra outro horário (o modelo tinha só delay_value/
  delay_unit disponível, e chutou um prazo relativo a partir de uma hora do
  relógio — exatamente o tipo de aritmética que o modelo erra, e que este
  produto já evita em todo outro lugar). Corrigido reaproveitando o par
  date+time que `create_visit`/`update_visit` já usam: `resolveDueAt`
  (server/services/agent.ts) tenta date+time primeiro (horário do relógio/
  data específica) e cai pro delay_value/delay_unit relativo se os dois não
  vierem. Sempre valida que o resultado é no FUTURO antes de aceitar — o
  prompt só expõe a DATA de hoje pro modelo, nunca a hora do relógio atual,
  então ele não tem como saber se um horário de hoje já passou; cair no
  passado dispararia o job de 60s imediatamente, então falha honesto em vez
  de arriscar.
- **Aba Lembretes separada da Agenda (2026-07-21).** Decisão explícita do
  usuário: lembrete e visita real não dividem a mesma tela, pra evitar
  mistura/conflito visual. Coluna `imf_agenda.event_type` faz a distinção no
  banco (reaproveitando a tabela em vez de criar uma nova — os dois "tipos"
  usam os mesmos campos); a Agenda (calendário) e tudo que conta "visitas"
  passaram a filtrar `event_type='visita'` explicitamente.
- **Alerta de lembrete: badge + WhatsApp pro corretor (2026-07-21).** Usuário
  pediu os dois. O badge no sino (`ManualRail.tsx`) entrou primeiro porque só
  tocava arquivo isolado do frontend. O envio por WhatsApp pro próprio
  corretor (`server/services/reminderAlerts.ts`, job de 60s) foi adiado até o
  Codex publicar a limpeza do transporte (`uazapi.ts`/`conversations.ts`) e
  implementado logo em seguida, já em cima do transporte novo.
- **Alerta de lembrete por WhatsApp sempre usa o número da CONTA, nunca o de
  um membro (2026-07-21).** `imf_broker_members` guarda `uazapi_instance_token`
  pra membro com WhatsApp próprio (`whatsapp_mode='own'`), mas não guarda o
  número de telefone do membro em lugar nenhum — nunca precisou, porque essa
  coluna só decidia de qual instância RESPONDER um cliente, nunca mandar
  mensagem pro próprio membro. `runReminderWhatsappAlertTick` sempre usa
  `imf_brokers.phone`/`uazapi_instance_token` (a conta), mesmo quando quem
  criou o lembrete foi um membro em modo "own" — nesse caso o alerta cai no
  titular, não no membro. Limitação conhecida e documentada; corrigir exigiria
  adicionar telefone próprio ao membro, fora do escopo deste pedido.
- **Notificar corretor de visita da IA usa número PESSOAL separado, não o
  comercial (2026-07-21).** A instância UAZAPI é o número comercial que a IA
  de atendimento usa pra falar com o cliente; um número não consegue notificar
  a si mesmo de forma confiável pelo WhatsApp. Por isso o alerta de visita
  marcada pela IA (`booked_by_chatbot`) vai pra `imf_brokers.notification_phone`
  (campo novo, editável em Config), sempre um número diferente do comercial.
  Se não configurado, cai só no badge in-app. Optou-se por coluna própria
  `booked_by_chatbot` em vez de reaproveitar `source` (que já grava `'ia'`
  pra visita do N8N e do Assistente in-app) pra não notificar o corretor de
  visita que ele mesmo acabou de ditar e não mexer nos relatórios que agrupam
  por `source`. Mesma limitação titular×membro do alerta de lembrete.
