# Arquitetura — ImobiFlow V2

> Fotografia técnica do baseline funcional auditado em 27/07/2026: branch
> `v2`, commit `4ee40d6`, release Fly `v185`. Releases exclusivamente
> documentais posteriores não mudam esta topologia/código.

## Visão geral

```text
Navegador / UAZAPI / Asaas / N8N
                │ HTTPS
                ▼
Fly Proxy ──► web × 3 (Express + SPA)
                │
                ├── Supabase Auth/PostgreSQL/Storage
                ├── Redis Upstash (rate limit distribuído)
                ├── UAZAPI / Asaas / OpenRouter / N8N
                └── inbox/outbox PostgreSQL
                         ▲              │
                         └── worker × 1 ativo (+ 1 standby)

scheduler × 1 ──► 11 jobs periódicos singleton
```

Todos os processos ficam em `gru`. Somente `web` recebe tráfego HTTP na porta
interna 3000. O estado durável continua no PostgreSQL/Storage; nenhuma Machine
Fly deve guardar sessão ou dado de negócio localmente.

## Topologia Fly confirmada

| Grupo | Quantidade observada | Tamanho | Responsabilidade |
| --- | ---: | --- | --- |
| `web` | 3 ativas | shared CPU 1, 1 GB | HTTP, autenticação, APIs e SPA |
| `worker` | 1 ativa + 1 standby | shared CPU 1, 1 GB | inbox/outbox e processamento de mídia |
| `scheduler` | 1 ativa | shared CPU 1, 512 MB | jobs periódicos singleton |

As três `web` estavam com health check passando. `auto_stop_machines` está
desligado, `min_machines_running=2` e a concorrência HTTP é soft 80/hard 150.
A segunda Machine do worker é standby de host: não amplia throughput enquanto
estiver parada.

## Aplicação e autenticação

- Frontend V2 em `src/experience/*`, servido em `/app`; páginas públicas e
  administrativas ficam em `src/pages/*`.
- `src/pages/Signup.tsx` escolhe `account_type` por cards de plano e consulta
  o preço público em `GET /api/config/plan`; não existe diferenciação real de
  preço ou ciclo anual no backend.
- `server.ts` inicializa Express, segurança, routers e SPA. Não registra jobs.
- `server/middleware/auth.ts` valida JWT Supabase e resolve `user_id` e
  `broker_id` no servidor.
- O backend usa `service_role`, portanto toda rota filtra tenant, posse e
  permissões explicitamente; RLS é defesa adicional.
- Titulares administram a conta e membros recebem apenas o escopo autorizado.
- Vouchers de experimentação são segredos de uso único armazenados por hash. A
  extensão pendente `20260804b_trial_voucher_whatsapp.sql` mantém duas cotas no
  tenant: total de membros (`trial_member_limit`) e membros com instância UAZAPI
  própria (`trial_whatsapp_member_limit`). Emissão e aceite de convite passam
  por RPCs com lock no broker; convites pendentes reservam ambas as vagas.

## Dados e CRM

### Funções combináveis por conta

`imf_brokers.account_type` permanece como tipo principal compatível com contas
existentes. Funções especializadas são calculadas pelo backend a partir dos
padrões do tipo mais os registros de `imf_account_capability_overrides`:

- `rentals` libera Locação;
- `developments` libera Lançamentos;
- `finance` libera Financeiro;
- `team` libera Equipe.

O painel admin envia o conjunto final para a RPC transacional
`imf_set_account_capabilities`. Frontend, rotas Express e Assistente IA usam o
mesmo conjunto efetivo; esconder o item do rail nunca substitui a autorização
do servidor. Planos comerciais futuros podem provisionar esses mesmos
entitlements sem alterar novamente o modelo de navegação.

- Supabase é compartilhado; novas tabelas do produto usam prefixo `imf_`.
- Valores monetários persistem em centavos inteiros e datas em ISO/UTC.
- CRM usa `imf_crm_pipelines` e `imf_crm_pipeline_stages`; pipelines são por
  broker e as etapas têm `stage_type=open|won|lost`.
- `leads.pipeline_id`/`pipeline_stage_id` são a fonte do funil. Trigger mantém
  `leads.status`/`closed_at` para relatórios e compatibilidade.
- Mutações críticas do CRM usam RPCs transacionais restritas à `service_role`.
- Migrations ficam versionadas, mas são aplicadas manualmente no Supabase.

## WhatsApp, filas e mídia

- A V2 integra UAZAPI diretamente por conta ou membro.
- O inbound `POST /api/wpp-shim/inbound/:instanceId` persiste o evento em
  `imf_webhook_inbox` antes de responder ao provedor.
- Claims atômicos, `FOR UPDATE SKIP LOCKED`, lease, retry e DLQ protegem o
  processamento; `imf_webhook_outbox` entrega ao N8N em modo at-least-once.
- `event_id` estável segue em header e payload. Deduplicação dos efeitos finais
  precisa existir também no workflow N8N.
- Inbox e outbox são processadas em ciclos independentes, para uma falha não
  bloquear o avanço da outra.
- Mensagens recebidas podem persistir `media_url` no Storage para reprodução
  de áudio, imagem e documentos suportados. Transcrição/visão usa
  `google/gemini-2.5-flash-lite` via OpenRouter.
- O backfill periódico recupera mídia recebida sem URL; o guardião reafirma a
  configuração dos webhooks UAZAPI.

Redis não substitui essas filas. Ele é usado para rate limit compartilhado
entre as três `web`. A integração força IPv6 para o host Upstash/Fly quando
necessário, usa timeouts curtos e opera em fail-open: indisponibilidade do
Redis reduz a proteção distribuída, mas não derruba a API.

## IA

Existem três usos separados:

| Uso | Modelo/configuração atual |
| --- | --- |
| Assistente interno do corretor | `xiaomi/mimo-v2.5` em `server/services/agent.ts` |
| Agente externo do WhatsApp/N8N | `N8N_AGENT_MODEL`, padrão `google/gemini-2.5-flash` |
| Texto auxiliar | `openai/gpt-4o-mini` |
| Mídia recebida | `google/gemini-2.5-flash-lite` |

O agente interno recebe um snapshot autorizado do tenant. Textos variáveis
ficam em `UNTRUSTED_ACCOUNT_CONTEXT`; a saída passa por Zod estrito. Consultas
e navegação podem ser imediatas, mas qualquer criação, edição, cancelamento ou
envio exige confirmação humana, inclusive no modo piloto.

O N8N busca configuração pelo backend e pode trocar o modelo por secret sem
editar o workflow. Na produção auditada não existe secret
`N8N_AGENT_MODEL`, então vale o padrão do código. `N8N_WEBHOOK_TOKEN` também
não está dedicado no Fly; o código usa temporariamente o fallback
`INTERNAL_PROXY_TOKEN`. O hardening manual está descrito em
[`docs/N8N_SECURITY_HARDENING.md`](./docs/N8N_SECURITY_HARDENING.md).

## Jobs periódicos

`scheduler-worker.ts` executa 11 jobs: follow-up inteligente, follow-up
agendado do assistente, alerta de lembrete, alerta de visita, preparação de
billing, reconciliação de billing, expiração de reserva PIX, retenção de logs,
retenção das filas, guardião de webhook e backfill de mídia recebida.

O scheduler previne sobreposição local, tolera erro de tick e drena jobs no
SIGTERM. Ele deve permanecer singleton. O worker pode ser escalado conforme
idade/backlog da fila; a web pode escalar horizontalmente porque jobs e rate
limit já foram separados.

## Frontend e mobile

- Tema Cristal Dia/Noite está habilitado e persiste a preferência local.
- Conversas usa padrão inbox no desktop e navegação lista/thread no mobile.
- Chat suporta texto, nota interna e anexos, com composer estabilizado para
  teclado virtual e viewport móvel.
- CRM mobile usa menus e ações contidos na largura do aparelho.
- Kanban de Negócios usa `@dnd-kit/core` com sensores de mouse e toque.
- Upload móvel usa input transparente diretamente clicável.
- Vitrine pública de imóveis e lançamentos está implementada e recebe ajustes
  de apresentação sem alterar o isolamento dos dados.

## Operação e observabilidade

- `/api/health` é o liveness barato usado pelo Fly.
- O painel Admin exibe saúde de inbox/outbox, atendimento, Redis, N8N, memória
  e ações manuais idempotentes de recuperação.
- Redis e Sentry estavam ativos na auditoria. O Sentry recebe apenas eventos de
  erro sanitizados: sem PII, corpo, cabeçalhos, cookies, query string, IP,
  contexto de usuário, variáveis locais ou breadcrumbs de console; tracing
  permanece desativado.
- `PUBLIC_APP_URL=https://imobiflow-v2.fly.dev` é a origem canônica.
- Push em `v2` executa testes, TypeScript, Knip e build antes do deploy
  automático pelo GitHub Actions.

## Limites ainda não comprovados

- Três Machines web não provam capacidade para 100 corretores simultâneos;
  faltam testes autenticados e de webhook em staging.
- O worker standby não adiciona capacidade ativa.
- Deduplicação e Header Auth do N8N precisam de verificação manual no workflow.
- A aplicação de `20260724_scale_hot_path_indexes.sql` no banco de produção não
  foi confirmada nesta auditoria; o arquivo está versionado e exige verificação
  manual antes de ser declarado aplicado.
- A entrega de um evento artificial sem dados de cliente foi confirmada pelo
  SDK e visualizada no painel do Sentry em 27/07/2026. A issue de validação foi
  marcada como resolvida; não há issues pendentes após o teste.

Consulte [`SCALABILITY_TEST_PLAN.md`](./SCALABILITY_TEST_PLAN.md) para os
critérios de carga e [`DOCUMENTACAO.md`](./DOCUMENTACAO.md) para o detalhe por
domínio.
