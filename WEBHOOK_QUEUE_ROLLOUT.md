# Operação da fila durável de webhooks

> Rollout inicial concluído. Estado revisado em 27/07/2026 no commit
> `8e3ed27`/release Fly `v180`.

## Objetivo e contrato

A entrada UAZAPI e a entrega ao N8N usam inbox/outbox no PostgreSQL para evitar
perda silenciosa quando API, worker ou N8N ficam indisponíveis.

- o inbound só responde ACK depois de persistir `imf_webhook_inbox`;
- claims atômicos usam lease e `FOR UPDATE SKIP LOCKED`;
- retry e DLQ recuperam falhas transitórias e preservam diagnóstico;
- inbox e outbox avançam em ciclos independentes;
- a entrega ao N8N é **at-least-once**;
- `event_id` estável segue no header `X-ImobiFlow-Event-Id` e no JSON.

Redis não é a fila. O Redis ativo serve ao rate limit distribuído; os eventos
duráveis continuam no PostgreSQL.

## Estado atual no Fly

- `web`: 3 ativas; recebe HTTP e persiste o webhook antes do ACK;
- `worker`: 1 ativa + 1 standby parada; processa inbox/outbox e mídia;
- `scheduler`: 1 ativa; executa os 11 jobs periódicos;
- `[http_service]` atende somente `web`;
- SIGTERM permite drenagem e o lease devolve trabalho incompleto para retry.

O grupo worker está configurado com duas Machines, mas a standby não aumenta
throughput enquanto parada. Escala de processamento exige duas workers
efetivamente iniciadas e deve ser validada em staging.

## Pré-requisitos de banco

A migration base é
`supabase/migrations/20260721b_webhook_inbox_outbox.sql`. Em um ambiente novo:

1. aplicar a migration manualmente;
2. confirmar tabelas e RPCs;
3. publicar o backend somente depois;
4. enviar evento real de teste e acompanhar até `completed`.

```sql
select to_regclass('public.imf_webhook_inbox') is not null as inbox_ok,
       to_regclass('public.imf_webhook_outbox') is not null as outbox_ok,
       to_regprocedure('public.claim_imf_webhook_inbox(text,integer,integer)') is not null as claim_inbox_ok,
       to_regprocedure('public.claim_imf_webhook_outbox(text,integer,integer)') is not null as claim_outbox_ok;
```

## Monitoramento

O painel Admin mostra contagens de entrada/saída, estados, falhas, idade da
fila e ações idempotentes de recuperação. Para diagnóstico direto:

```sql
select status, count(*) as total, min(created_at) as mais_antigo
from imf_webhook_inbox
group by status
order by status;

select status, count(*) as total, min(created_at) as mais_antigo
from imf_webhook_outbox
group by status
order by status;

select id, broker_id, attempts, last_error, created_at, updated_at
from imf_webhook_inbox
where status = 'dead'
order by updated_at desc
limit 100;

select id, broker_id, attempts, last_error, created_at, updated_at
from imf_webhook_outbox
where status = 'dead'
order by updated_at desc
limit 100;
```

Alertar em qualquer linha `dead`, evento `pending/processing` com mais de 60 s
ou crescimento contínuo da outbox por cinco minutos.

## Recuperação operacional

O painel Admin oferece processar filas, reprocessar falhas, destravar itens,
reapontar webhooks e limpar histórico resolvido. As operações são desenhadas
para repetição segura, mas devem ser usadas após identificar a causa.

Durante incidente:

1. preservar inbox/outbox; nunca apagar filas como primeira ação;
2. verificar saúde de web, worker, scheduler, Supabase, Redis e N8N;
3. corrigir o componente indisponível;
4. reprocessar falhas e observar a drenagem;
5. confirmar ausência de efeitos duplicados no N8N/WhatsApp.

Reverter o backend não exige remover tabelas. O histórico deve permanecer para
diagnóstico e recuperação.

## N8N e deduplicação

Uma resposta HTTP perdida depois de o N8N executar o fluxo provoca retry com o
mesmo `event_id`. Portanto o workflow precisa registrar o ID **antes** de
enviar WhatsApp ou alterar dados e ignorar IDs já concluídos.

A existência desse comportamento no workflow online não foi comprovada por
esta auditoria de código/Fly. Validar manualmente seguindo
[`docs/N8N_SECURITY_HARDENING.md`](./docs/N8N_SECURITY_HARDENING.md).

## Parâmetros

```env
WEBHOOK_INBOX_BATCH_SIZE=10
WEBHOOK_OUTBOX_BATCH_SIZE=20
WEBHOOK_QUEUE_MAX_ATTEMPTS=20
WEBHOOK_WORKER_POLL_MS=1000
```

Os defaults priorizam segurança. Aumentar batches ou ativar mais workers só
depois de medir fila, banco, CPU, memória e limite do N8N em staging.

## Validação periódica

1. Enviar texto e mídia de uma conta de teste.
2. Confirmar inbox/outbox em `completed` e mídia reproduzível.
3. Parar o worker ativo de forma controlada e confirmar recuperação por lease.
4. Indisponibilizar um N8N stub, acumular outbox e confirmar drenagem.
5. Repetir o mesmo `event_id` e comprovar deduplicação ponta a ponta.
6. Confirmar execução do guardião de webhook e do backfill de mídia sem
   duplicação.
