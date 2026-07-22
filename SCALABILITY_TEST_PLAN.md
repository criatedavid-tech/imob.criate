# Plano de testes de escalabilidade — ImobiFlow V2

## Objetivo

Medir a capacidade real antes de aumentar máquinas e custos. O cenário inicial
de referência é 100 corretores, cerca de 3.000 conversas ativas e picos de
mensagens simultâneas. Nenhum teste de carga destrutivo deve usar dados reais.

## Linha de base em 22/07/2026

- 8 contas, 4 tickets ativos, 7 tickets totais e 49 mensagens nas últimas 24h;
- inbox: 137 eventos/24h, zero backlog, p50 656ms, p95 4.101ms, p99 8.348ms;
- outbox: 20 eventos/24h, todos concluídos, p50 954ms, p95 1.371ms;
- Fly antes desta etapa: uma `web` e uma `worker` ativas, 1 GB cada; depois da
  publicação, uma `scheduler` singleton de 512 MB foi adicionada;
- Redis e Sentry ainda não configurados;
- smoke HTTP local do novo `/api/health`: 1.000 requisições, concorrência 25,
  1.307,94 req/s, p95 36,8ms, p99 54,8ms e zero erro;
- smoke pós-deploy: `/api/health`, `/`, `/login` e `/app` com HTTP 200; filas
  sem `pending`, `processing` ou `dead`;
- esses números comprovam saúde em carga baixa, não capacidade para 100
  corretores.

## Proteção do ambiente

O comando `npm run test:load` usa localhost por padrão. Se o destino for
`imobiflow-v2.fly.dev`, o script bloqueia antes da primeira requisição. A única
forma de liberar produção é definir explicitamente
`ALLOW_PRODUCTION_LOAD_TEST=I_UNDERSTAND`; isso não deve ser usado para teste
pesado. Produção aceita apenas smoke curto e previamente controlado.

Teste de carga real exige um app Fly de staging e banco/provedores isolados, ou
uma conta de teste dedicada com UAZAPI, N8N e Asaas substituídos por stubs.

## Etapas e critérios

### 1. Gate automatizado

- `npm test`, `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`;
- concorrência dos jobs: nenhuma execução sobreposta do mesmo job;
- falha de um tick não encerra o scheduler;
- SIGTERM aguarda jobs ativos;
- API não registra schedulers e o Fly mantém `scheduler=1`.

### 2. Baseline HTTP sem banco

Alvo: `GET /api/health` no staging.

- degraus de 10, 25, 50, 100 e 200 requisições concorrentes;
- erro abaixo de 1%; p95 abaixo de 300ms; nenhuma reinicialização;
- observar CPU, memória e latência por pelo menos 10 minutos em cada degrau.

### 3. Mix autenticado de API

Usar contas/fixtures de teste e reproduzir Dashboard, Conversas, Agenda, CRM e
Contatos. Meta inicial: 100 usuários simultâneos, aumentando até o ponto em que
p95 ultrapassar 800ms ou erro chegar a 1%. Registrar queries lentas e número de
chamadas PostgREST por ação.

### 4. Webhook e worker

- injetar texto e mídia sintéticos a 10, 25 e 50 eventos/s;
- ACK do inbound p95 abaixo de 1s;
- idade de `pending/processing` abaixo de 60s e zero `dead`;
- desligar um worker durante o pico e confirmar recuperação por lease;
- indisponibilizar o stub do N8N por cinco minutos, acumular outbox e confirmar
  drenagem sem perda quando ele voltar;
- validar deduplicação pelo mesmo `event_id`.

### 5. Schedulers

- gerar lotes de 100, 1.000 e 3.000 alertas/follow-ups vencidos;
- medir tempo de drenagem e chamadas externas;
- o batch sequencial atual de 20 itens é um limite conhecido: ajustar batch e
  concorrência somente depois desta medição;
- provar one-shot/idempotência para alertas, follow-ups e billing.

### 6. Escala horizontal

Somente depois dos gates anteriores:

1. configurar Redis para rate limit compartilhado;
2. subir `web` de 1 para 2 e repetir etapas 2 e 3;
3. aumentar `worker` independentemente conforme idade da fila;
4. manter `scheduler=1`;
5. executar soak test de 2 horas e comparar custo, p95/p99, erros e backlog.

## Comandos

```powershell
npm test
npm run lint
npx knip
npm run build

# Requer servidor local/staging já ativo; não altera dados no endpoint health.
$env:LOAD_TEST_URL='http://127.0.0.1:3000/api/health'
$env:LOAD_TEST_REQUESTS='1000'
$env:LOAD_TEST_CONCURRENCY='25'
npm run test:load
```
