# Rollout da fila durável de webhooks

## Objetivo

Impedir perda silenciosa de mensagens quando a API ou o n8n ficam
indisponíveis. A entrada UAZAPI e o despacho ao n8n agora usam inbox/outbox no
Postgres, com deduplicação, claims atômicos, lease recuperável, retry e DLQ.

## Ordem obrigatória de publicação

1. Aplicar manualmente no Supabase:
   `supabase/migrations/20260721b_webhook_inbox_outbox.sql`.
2. Confirmar que as duas tabelas e as duas RPCs existem.
3. Somente depois publicar o backend.
4. Enviar uma mensagem textual real e acompanhar inbox/outbox até
   `status='completed'`.

O backend novo não deve ser publicado antes da migration: sem a tabela de
inbox ele responde 503 e pede retry ao provedor, em vez de confirmar uma
mensagem que não conseguiu guardar.

## Verificação no Supabase

```sql
select to_regclass('public.imf_webhook_inbox') is not null as inbox_ok,
       to_regclass('public.imf_webhook_outbox') is not null as outbox_ok,
       to_regprocedure('public.claim_imf_webhook_inbox(text,integer,integer)') is not null as claim_inbox_ok,
       to_regprocedure('public.claim_imf_webhook_outbox(text,integer,integer)') is not null as claim_outbox_ok;
```

## Monitoramento operacional

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

Alertas iniciais sugeridos:

- qualquer linha `dead`;
- evento `pending` ou `processing` com mais de 60 segundos;
- crescimento contínuo da outbox por cinco minutos.

## Contrato com o n8n

O payload anterior foi preservado. Foram acrescentados:

- header `X-ImobiFlow-Event-Id`;
- campo JSON `event_id`.

A entrega da outbox é **at-least-once**. Se o n8n executar o fluxo e a resposta
HTTP se perder, o backend tentará de novo com o mesmo `event_id`. Para impedir
efeitos duplicados em 100% dos casos, o workflow deve registrar esse ID antes
de enviar WhatsApp ou alterar dados e ignorar IDs já concluídos.

## Configuração opcional

```env
WEBHOOK_INBOX_BATCH_SIZE=10
WEBHOOK_OUTBOX_BATCH_SIZE=20
WEBHOOK_QUEUE_MAX_ATTEMPTS=20
```

Os defaults já são seguros para o rollout inicial. Aumentar batches somente
depois de teste de carga e observação de CPU, memória, banco e n8n.

## Rollback

Reverter apenas o backend para a versão anterior. As tabelas podem permanecer
no banco sem afetar a versão antiga e preservam os eventos para diagnóstico.
Não apagar inbox/outbox durante um incidente.

## Próximas etapas

- mover os ticks para um process group de workers separado da API;
- retirar áudio/imagem do processo web;
- implementar deduplicação por `event_id` no n8n;
- adicionar métricas de idade da fila e DLQ;
- executar testes de carga e de reinício dos processos.
