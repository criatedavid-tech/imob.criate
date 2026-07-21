# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; última base publicada `4c60a45` (1ª tentativa do fix do mic).
- Limpeza do transporte antigo publicada e verificada na produção V2.
- O n8n não foi acessado nem alterado nesta etapa.

## Melhoria: seletor de data/hora no Agendar Visita (2026-07-21) — aguardando autorização

Campo "Horário de preferência" do modal Agendar Visita virou
`<input type="datetime-local">` (calendário + relógio nativos, `min` =
agora). Rótulo acima (datetime-local não tem placeholder). Valor formatado
pra pt-BR antes de gravar na nota do lead. Continua opcional e sem agendar
nada em imf_agenda. `PropertyLanding.tsx`, `tsc`/`knip`/`build` aprovados,
sem migration.

## Fix: foto falsa de corretor na landing (2026-07-21) — aguardando autorização

Seção "Seu Corretor" e modal "Saiba Mais" usavam foto de banco de imagens
(Unsplash) como fallback quando o corretor não tinha foto no perfil —
rosto de um estranho apresentado como o corretor real. Fallback agora é um
monograma com a inicial do nome (`PropertyLanding.tsx`, dois pontos de
render). Foto real do perfil (Dashboard 1.0) continua aparecendo quando
existe. `tsc`/`knip`/`build` aprovados. Sem migration.

## Bug: dados cadastrados sumidos da landing (2026-07-21) — aguardando autorização

Landing pública não mostrava quartos/banheiros/piscina/etc. (faixa de
specs, tags e mini-stats sumidos) apesar do formulário de edição exibir
tudo. Causa: `GET /api/properties/:slug` separa o bloco
`---DETALHES-GERADOS---` no servidor (desde `8443173`) e devolve `details`
parseado, mas `PropertyLanding.tsx` ainda parseava a description (que chega
limpa). Correção: landing lê `property.details` primeiro; parse inline vira
fallback. Verificado contra payload real de produção (details com
quartos:4, banheiros:4, piscina/varanda "Sim") — a extração estruturada do
ditado pelo agente já funcionava; só a exibição estava quebrada.

`tsc`/`knip`/`build` aprovados. Sem migration. Pendente: autorização para
commit/push; depois recarregar a landing e conferir specs/tags/mini-stats.

## Bug: microfone abre a galeria no iOS (2026-07-21) — 2ª correção aguardando autorização

iPhone 11: tocar no mic do Assistente IA abria o seletor de foto, ~6 de 7
toques. A 1ª correção (`4c60a45`, remount do input via `key` — hipótese de
foco retido) NÃO resolveu: usuário retestou e continuou falhando, inclusive
sem foto anexada.

Causa real: o controle nativo do `<input type="file">` no iOS tem largura
intrínseca (~110px+) que não encolhe pros 32px do wrapper; sem
`overflow-hidden`, o excedente invisível transbordava por cima do mic e
capturava o toque (input `absolute` pinta acima de botão estático).

2ª correção em `CommandBar.tsx`: `overflow-hidden` no wrapper do clipe
(clipa pintura e hit-test) + `relative z-10` no botão do mic (defesa
extra). Padrão Android intacto.

`npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration.

Pendente: autorização do usuário para commit/push; depois do deploy, QA no
iPhone (vários toques seguidos no mic, com e sem foto anexada).

## Bug: texto repetido na landing page de imóvel (2026-07-21) — aguardando autorização

Print do usuário: a mesma descrição aparecia em todas as seções da página
pública do imóvel. `src/pages/PropertyLanding.tsx` divide a descrição em
parágrafos por seção, mas caía pro parágrafo 0 inteiro quando uma seção não
tinha parágrafo próprio — sempre acontecia com descrição ditada por voz
(sai como um bloco só, 1 parágrafo). Corrigido: só a seção 0 cai pra
descrição inteira; as demais ficam sem parágrafo de corpo se não tiverem um
próprio (mantêm heading/tag/CTA).

`npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Verificado
simulando a transformação com o texto real do print (fora do repo) — não
consegui abrir o Browser pane nesta sessão pra QA visual ao vivo. Sem
migration, sem mudança de backend.

Pendente: autorização do usuário para commit/push; confirmação visual real
fica por conta do usuário.

## Bug: horário absoluto em schedule_followup/create_reminder (2026-07-21) — aguardando autorização

Usuário pediu follow-up pro Hiago "às 16:00", sistema agendou 19:39.
`create_reminder`/`schedule_followup` só aceitavam prazo relativo
(delay_value+delay_unit) — sem campo pra hora do relógio, o modelo chutava
um prazo a partir da hora e chutava errado. Corrigido em
`server/services/agent.ts`: `resolveDueAt` tenta date+time (par que
`create_visit` já usa) primeiro, cai pro relativo se não vier; sempre
valida resultado no futuro (recusa honesto se já passou).

`npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration.

Pendente: autorização do usuário para commit/push. O follow-up errado do
Hiago (19:39, `imf_agent_scheduled_followups`) continua pendente em
produção — cancelar pela aba Lembretes (lixeira, "Aguardando envio") e
pedir de novo depois do deploy.

## Dois bugs de UI relatados pelo usuário (2026-07-21) — aguardando autorização

Print do usuário: barra superior mobile (admin) com "Corretor/Admin" e
"Piloto automático" sobrepostos, e campo de mensagem do Assistente IA de uma
linha só (texto ditado/longo ilegível, só rolava na horizontal).

Corrigido:

- `ExperienceShell.tsx`: pílulas "ver como" com `shrink-0 whitespace-nowrap` +
  container `overflow-x-auto`; botão de autonomia esconde o rótulo de texto
  abaixo de `sm` (só bolinha+seta no mobile);
- `CommandBar.tsx`: `<input>` → `<textarea rows={1}>` com auto-grow até
  144px (`MAX_INPUT_HEIGHT_PX`) e scroll interno depois disso; Enter envia,
  Shift+Enter quebra linha; ditado por voz também cresce (mesma `value`).

`npx tsc --noEmit`, `npx knip`, `npm run build` aprovados. Sem migration.

Pendente: autorização do usuário para commit/push; confirmação visual real
(mobile, sessão admin) fica por conta do usuário — não reproduzo login nem
visão de admin sem credenciais.

## Limpeza publicada e verificada (2026-07-21)

- Commit `67aa90d`; GitHub Actions run `29857448606` aprovado.
- Migration `20260721e` aplicada manualmente e schema confirmado.
- Uma web e um worker ativos na release Fly v128; standby do worker parado.
- `/`, `/login` e `/app` responderam HTTP 200.
- Webhook UAZAPI habilitado e apontando para `imobiflow-v2.fly.dev`.
- Inbox/outbox sem itens `pending`, `processing` ou `dead`.
- Busca global final sem resíduos no runtime/documentação; a migration aditiva
  contém os nomes antigos apenas para copiar dados e preservar a V1.

A migration só adiciona `source_ticket_id` e `claim_due_followups_v2`. A função
e as colunas compartilhadas anteriores permanecem intactas para a V1 congelada.

Próximo QA recomendado: enviar uma mensagem real após esta release e confirmar
a entrada na tela Conversas. Depois, implementar o alerta de lembrete vencido
por WhatsApp usando `server/services/uazapi.ts`.

## Bug crítico encontrado: CRM/Pipelines fora do ar (2026-07-21)

Investigado a partir de um erro relatado pelo usuário na aba Negócios ("Erro
ao carregar pipelines."). Causa: coluna ambígua (42702) em
`imf_crm_ensure_default_pipeline` — `RETURNS TABLE (pipeline_id UUID, ...)`
cria uma variável de saída `pipeline_id`, e uma consulta no corpo da função
referenciava a coluna real de `imf_crm_pipeline_stages` sem alias. Como essa
consulta é a própria condição de um `IF` (roda sempre), a função falhava em
100% das chamadas de `GET /api/crm/pipelines`, pra qualquer broker, desde que
`20260720b_crm_security_hardening.sql` foi aplicada (20/07/2026) — só
percebido agora por falta de QA autenticado ao vivo da tela.

Correção publicada:

- migration `supabase/migrations/20260721d_fix_crm_ensure_default_pipeline_ambiguous_column.sql`
  aplicada manualmente pelo usuário no Supabase;
- commit `7f25b31` (só a migration — a documentação já tinha entrado junto
  no commit anterior do Codex, `5ff6b00`, por causa da mesma árvore
  compartilhada); GitHub Actions run `29854511196` aprovado;
- smoke `/`, `/login`, `/app` HTTP 200 após o deploy.

## Alerta de lembrete vencido: badge + WhatsApp pro corretor (2026-07-21)

Usuário pediu duas formas de alertar sobre lembrete vencido. Badge
(`ManualRail.tsx`, `useDueReminderCount` + `RailIcon`, poll de 60s em
`GET /api/agenda/visits?event_type=lembrete` já existente) publicado no
commit `67aa90d`. WhatsApp pro corretor implementado logo em seguida, já
sobre o transporte novo do Codex: `server/services/reminderAlerts.ts`
(`runReminderWhatsappAlertTick`, job de 60s em `server.ts`, mesmo padrão de
lock de `agentScheduledFollowups.ts`) + migration
`20260721f_reminder_whatsapp_alert.sql` (coluna
`imf_agenda.whatsapp_alert_sent_at`). `npx tsc --noEmit`, `npx knip`,
`npm run build` aprovados.

Limitação conhecida: o alerta sempre usa `imf_brokers.phone`/
`uazapi_instance_token` (a conta), nunca a instância própria de um membro em
modo "own" — não existe telefone do membro salvo no schema.

Pendente:

1. aplicar `20260721f_reminder_whatsapp_alert.sql` manualmente no Supabase;
2. autorização do usuário para commit/push;
3. validar com sessão autenticada: lembrete vencido mostra badge no sino e
   chega mensagem de WhatsApp no número do corretor.

## Pacote publicado: inbox/outbox duráveis

Implementado:

- migration `supabase/migrations/20260721b_webhook_inbox_outbox.sql`;
- serviço `server/services/inboundWebhookQueue.ts`;
- webhook UAZAPI confirma HTTP 200 somente depois do INSERT na inbox;
- falha de persistência retorna 503 para o provedor tentar novamente;
- claim atômico em batch com `FOR UPDATE SKIP LOCKED`;
- lease recuperável depois de crash;
- ordem preservada por corretor + conversa;
- retry com backoff e estado terminal `dead`;
- outbox para o n8n com header/campo `event_id`;
- índices de lookup por `uazapi_instance_id`;
- runbook `WEBHOOK_QUEUE_ROLLOUT.md`.

Validações locais aprovadas:

- `npm run lint`;
- `npx knip`;
- `npm run build`;
- `git diff --check`.

Publicação confirmada:

- commit `28de500` em `v2`;
- GitHub Actions run `29840243877` aprovado (validação + deploy Fly);
- `/`, `/login` e `/app` responderam HTTP 200 após o deploy;
- inbox/outbox sem itens `pending`, `processing` ou `dead` após o deploy.

Banco já preparado:

- migration `20260721b_webhook_inbox_outbox.sql` aplicada manualmente em
  21/07/2026;
- smoke real confirmou inbox/outbox `completed` em uma tentativa, entrega ao
  n8n em cerca de 0,3 s e zero itens `pending`, `processing` ou `dead`.

## Pacote publicado: worker separado (2026-07-21)

- `webhook-worker.ts` executa exclusivamente os ticks da inbox/outbox;
- `server.ts` e `POST /api/wpp-shim/inbound/:instanceId` apenas persistem;
- removido o gatilho em memória que ainda processava a fila na API;
- `fly.toml` define os grupos `web` e `worker`; HTTP pertence somente a `web`;
- `SIGTERM`/`SIGINT` interrompem novos ciclos e drenam o ativo antes de sair;
- TypeScript, Knip, build, TOML e `git diff --check` aprovados localmente;
- nenhuma migration nova e nenhuma alteração no n8n.
- commit `e42c765` e GitHub Actions run `29852566289` aprovados;
- smoke HTTP 200 e filas sem itens problemáticos após o deploy.

Correção publicada: o primeiro rollout criou duas `web` pela HA padrão; o
commit `45b41e0` passou a usar `--ha=false` e reafirmar `web=1`. GitHub Actions
run `29853031218` aprovado e uma Machine web removida. Topologia final: uma
`web` ativa, uma `worker` ativa e uma standby parada do worker. Smoke HTTP 200
e filas sem itens problemáticos.

## Pacote publicado: aba Lembretes (2026-07-21)

Nova área `src/experience/LembretesArea.tsx` (3 personas), separada da
Agenda a pedido do usuário: lista `create_reminder` (com concluir/apagar) e
`schedule_followup` (com cancelar enquanto `pending`), hoje sem nenhuma UI.
Precisou de coluna nova `imf_agenda.event_type` (`'visita'|'lembrete'`) pra
impedir que lembrete contaminasse contagens de visita real em 4 lugares
(snapshot do Assistente IA, Relatórios, KPI do Dashboard 1.0, lista do
agente externo de WhatsApp) — todos já filtrados.

Publicação confirmada:

- migration `20260721c_agenda_event_type.sql` aplicada e coluna verificada;
- código `a023d78` e documentação `0916b8a` publicados;
- GitHub Actions run `29851172091` aprovado.

Falta apenas QA ao vivo: criar um lembrete e um follow-up pela IA, conferir os
dois na aba Lembretes, concluir/apagar um lembrete, cancelar um follow-up
pendente e confirmar que a Agenda não mostra lembretes.

## Sequência obrigatória (fila de webhooks)

1. **Concluído:** fazer smoke com uma mensagem textual real.
2. **Concluído:** confirmar inbox e outbox em `completed` e fila sem erros.
3. Reenviar o mesmo evento e confirmar ausência de mensagem duplicada.
4. Interromper/reiniciar um worker durante o processamento e confirmar
   recuperação do lease.
5. Implementar no workflow n8n deduplicação pelo `event_id` antes de qualquer
   envio ou mutação externa.

## Critério de conclusão desta etapa

- Nenhum ACK antes da persistência.
- Nenhuma mensagem duplicada no banco.
- Falha temporária do n8n mantém a outbox pendente e recuperável.
- Eventos que excedem o limite de tentativas aparecem em `dead`.
- Métricas/consultas mostram que a fila volta a zero após o smoke.
- Rollback não exige apagar inbox/outbox.

## Evolução seguinte

Depois de validar esta entrega:

1. repetir o smoke com uma nova mensagem real após a separação do worker;
2. implementar métricas e alertas de idade da fila/DLQ;
3. substituir polling da tela Conversas por Realtime/SSE;
4. configurar n8n em queue mode e dimensionar workers com teste de carga;
5. executar cenários de 2, 10 e 50 mensagens por segundo;
6. retirar os schedulers restantes de `server.ts` antes de escalar `web`.

## Pendências anteriores que permanecem

- Instalar manualmente o prompt vigente de `PROMPT-AGENTE-WHATSAPP.md` no n8n.
- Fazer QA de nome, instruções personalizadas, agenda, PTT e imagem.
- Confirmar isolamento titular/membro e human takeover em produção.
