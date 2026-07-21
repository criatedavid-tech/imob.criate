# Estado do projeto

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
- Pendente: autorização do usuário para commit/push.

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
- Pendente: autorização do usuário para commit/push.

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
- Pendente: autorização do usuário para commit/push. Sem migration.

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
- Pendente: autorização do usuário para commit/push; confirmação visual
  real (recarregar a página do imóvel) fica por conta do usuário.

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
- Pendente: autorização do usuário para commit/push. O follow-up errado do
  Hiago (19:39) continua pendente em produção — o usuário pode cancelar
  direto na aba Lembretes (botão de lixeira, enquanto "Aguardando envio")
  e pedir de novo pro Assistente IA depois do deploy.

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
- Pendente: autorização do usuário para commit/push. Nenhuma migration.

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
  `20260721f_reminder_whatsapp_alert.sql` (coluna nova), ainda não aplicada.
- **Limitação conhecida:** o alerta por WhatsApp sempre usa o número da
  CONTA, nunca a instância própria de um membro em modo "own" — não existe
  telefone do membro salvo no schema.
- Validado localmente: `npx tsc --noEmit`, `npx knip`, `npm run build`
  aprovados. Confirmação visual do badge e teste real do envio ainda
  dependem de sessão autenticada com lembrete vencido de verdade.
- Pendente: aplicar a migration manualmente no Supabase e autorização do
  usuário para commit/push.

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
- **Pendente:** aplicar a migration manualmente no Supabase e autorização do
  usuário para commit/push (regra padrão do projeto). Nenhuma mudança de
  código TypeScript — só a função no Postgres.

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
  ficando uma `web` ativa, uma `worker` ativa e a standby parada do worker.
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

- Instalar manualmente o novo prompt no N8N e testar nome/instruções do corretor.
- Testar PTT e imagem novos em conversa privada após o deploy já publicado.
- Confirmar isolamento titular/membro e operações críticas do CRM em produção.
- Validar IA desativada/human takeover e ausência de duplicação/vazamento nos
  logs.

## Limitações conhecidas

- A instância N8N exige sessão autenticada com acesso de edição; instalação do
  prompt permanece manual.
- Vídeo, documento, sticker e mídia de grupos não são processados pelo agente.
- `flyctl` local bloqueado; deploy ocorre pelo GitHub Actions.
- Testes físicos mobile dependem do usuário.
