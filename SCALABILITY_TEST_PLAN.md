# Plano de testes de escalabilidade — ImobiFlow V2

## Objetivo

Medir a capacidade real para o cenário inicial de 100 corretores e cerca de
3.000 conversas ativas, antes de assumir que a quantidade de Machines garante
capacidade. Testes pesados nunca usam clientes ou dados reais.

## Baseline histórico de 22/07/2026

Na topologia anterior, com uma web, um worker e um scheduler:

- 8 contas, 4 tickets ativos, 7 totais e 49 mensagens em 24 h;
- inbox: 137 eventos/24 h, zero backlog, p50 656 ms, p95 4.101 ms;
- outbox: 20 eventos/24 h, todos concluídos, p50 954 ms, p95 1.371 ms;
- `/api/health` local: 1.000 requisições, concorrência 25, 1.307,94 req/s,
  p95 36,8 ms, p99 54,8 ms e zero erro.

Esse baseline prova saúde em carga baixa, não capacidade de produção.

## Topologia auditada em 27/07/2026

- release Fly `v181`, commit `8aae185`, região `gru`;
- 3 Machines `web` ativas, 1 GB, com checks passando;
- 1 `scheduler` singleton ativo, 512 MB;
- grupo `worker` com 1 Machine ativa de 1 GB e 1 standby parada;
- Redis Upstash ativo para rate limit distribuído;
- `min_machines_running=2`, auto-stop desligado, soft limit 80 e hard 150;
- filas duráveis continuam em PostgreSQL; Redis não substitui inbox/outbox;
- Sentry não configurado;
- `20260724_scale_hot_path_indexes.sql` está versionada, mas sua aplicação no
  banco precisa de confirmação manual.

Três web aumentam disponibilidade e capacidade potencial. O worker standby só
assume em falha de host e não soma throughput enquanto estiver parado.

## Proteção do ambiente

`npm run test:load` usa localhost por padrão e bloqueia
`imobiflow-v2.fly.dev`. Produção recebe somente smoke curto e controlado. Carga
real exige staging, banco isolado e UAZAPI/N8N/Asaas substituídos por stubs ou
contas exclusivamente de teste.

## Gates

### 1. Integridade do artefato

- `npm test`, `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`;
- confirmar `scheduler=1` e ausência de schedulers no processo web;
- confirmar conexão Redis por PING, sem expor a URL;
- confirmar índices de hot path no banco antes do teste autenticado.

### 2. HTTP sem banco

Alvo: `GET /api/health` no staging, com 3 web.

- degraus de 10, 25, 50, 100, 200 e 300 requisições concorrentes;
- erro abaixo de 1% e p95 abaixo de 300 ms;
- observar distribuição entre Machines, CPU, memória e reinícios por 10
  minutos em cada degrau;
- repetir com uma web indisponível para validar continuidade.

### 3. Mix autenticado

Reproduzir Dashboard, Conversas, Agenda, CRM, Carteira e Contatos com fixtures.
Começar em 25 usuários, avançar para 50, 100 e 200 simultâneos. Meta inicial:

- erro abaixo de 1%;
- p95 abaixo de 800 ms;
- nenhuma mistura de tenant;
- conexões/consultas Supabase dentro dos limites contratados;
- registrar queries lentas e chamadas PostgREST por ação.

### 4. Webhook e worker

- injetar texto e mídia sintéticos a 10, 25 e 50 eventos/s;
- ACK p95 abaixo de 1 s;
- idade de `pending/processing` abaixo de 60 s e zero `dead`;
- parar o worker ativo durante pico e confirmar takeover/retry por lease;
- manter N8N stub indisponível por 5 min e confirmar drenagem integral;
- reenviar o mesmo `event_id` e comprovar ausência de efeito duplicado;
- comparar 1 worker ativo com 2 workers realmente ativos antes de mudar a
  configuração de produção.

### 5. Scheduler

- gerar lotes de 100, 1.000 e 3.000 tarefas vencidas;
- testar os 11 jobs, especialmente follow-ups, alertas, retenção, guardião e
  backfill de mídia;
- medir tempo de drenagem e chamadas externas;
- provar one-shot/idempotência e ausência de sobreposição;
- manter o scheduler singleton.

### 6. Resiliência do Redis

- confirmar rate limit compartilhado entre as três web;
- simular timeout/indisponibilidade no staging;
- provar que a API continua atendendo em fail-open;
- registrar perda temporária de proteção distribuída como alerta operacional;
- validar a família de rede usada pelo Upstash/Fly e os timeouts configurados.

### 7. Soak e decisão de escala

Executar 2 h com o mix representativo. Registrar p50/p95/p99, erros, backlog,
CPU, memória, banco, Redis, N8N e custo. Só depois:

- aumentar `worker` se a idade da fila crescer;
- ajustar batch/concurrency depois de medir banco e N8N;
- aumentar `web` se p95/CPU justificarem;
- avaliar CPU dedicada quando shared CPU for o gargalo;
- manter `scheduler=1`.

## Comandos locais seguros

```powershell
npm test
npm run lint
npx knip
npm run build

$env:LOAD_TEST_URL='http://127.0.0.1:3000/api/health'
$env:LOAD_TEST_REQUESTS='1000'
$env:LOAD_TEST_CONCURRENCY='25'
npm run test:load
```

Nunca registrar tokens, URLs Redis com senha ou conteúdo real de clientes nos
resultados dos testes.
