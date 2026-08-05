-- Junta mensagens picadas antes de acionar a IA.
--
-- Pessoas escrevem no WhatsApp em pedaços ("oi" / "tudo bem?" / "queria ver um
-- apartamento"). Hoje cada pedaço vira uma execução do n8n e uma resposta
-- completa — a IA responde três vezes a um pensamento só. Aqui a mensagem
-- espera alguns segundos na outbox; se chegar outra do mesmo par
-- (corretor, telefone) enquanto espera, os textos são concatenados na MESMA
-- linha e o relógio reinicia.
--
-- Três cuidados que a função precisa ter, e por quê:
--
-- 1. `FOR UPDATE SKIP LOCKED` — dois processos que recebam mensagens ao mesmo
--    tempo não podem sobrescrever a concatenação um do outro (perderia texto
--    do cliente). Quem não conseguir o lock cria uma linha nova: no pior caso
--    saem duas respostas, que é exatamente o comportamento de hoje. Nunca
--    perde mensagem.
-- 2. `merged_ids` — a mesma mensagem reprocessada (retry da inbox após crash)
--    não pode ser concatenada duas vezes. Preserva a idempotência que o
--    ON CONFLICT dava.
-- 3. `least(..., created_at + max_hold)` — quem digita sem parar não pode
--    adiar a resposta para sempre. Há um teto absoluto de espera.
create or replace function public.imf_enqueue_inbound_debounced(
  p_aggregate_id uuid,
  p_broker_id uuid,
  p_partition_key text,
  p_payload jsonb,
  p_debounce_seconds integer,
  p_max_hold_seconds integer
) returns table (outbox_id uuid, merged boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_existing public.imf_webhook_outbox;
  v_id uuid;
  v_texto_atual text;
  v_texto_novo text;
  v_texto_final text;
begin
  if coalesce(p_debounce_seconds, 0) <= 0 then
    insert into public.imf_webhook_outbox (event_type, aggregate_id, broker_id, partition_key, payload)
    values ('n8n.inbound_message', p_aggregate_id, p_broker_id, p_partition_key, p_payload)
    on conflict (event_type, aggregate_id) do nothing
    returning id into v_id;
    return query select v_id, false;
    return;
  end if;

  select * into v_existing
  from public.imf_webhook_outbox
  where partition_key = p_partition_key
    and event_type = 'n8n.inbound_message'
    and status = 'pending'
    and locked_at is null
    and attempts = 0
    and next_attempt_at > now()
  order by created_at desc
  limit 1
  for update skip locked;

  if found then
    if coalesce(v_existing.payload -> 'merged_ids', '[]'::jsonb) ? p_aggregate_id::text then
      return query select v_existing.id, true;
      return;
    end if;

    v_texto_atual := coalesce(trim(v_existing.payload ->> 'text'), '');
    v_texto_novo := coalesce(trim(p_payload ->> 'text'), '');
    v_texto_final := case
      when v_texto_novo = '' then v_texto_atual
      when v_texto_atual = '' then v_texto_novo
      else v_texto_atual || E'\n' || v_texto_novo
    end;

    update public.imf_webhook_outbox
    set payload = v_existing.payload || jsonb_build_object(
          'text', v_texto_final,
          'merged_ids', coalesce(v_existing.payload -> 'merged_ids', '[]'::jsonb)
                        || to_jsonb(array[p_aggregate_id::text]),
          'merged_count', coalesce((v_existing.payload ->> 'merged_count')::int, 1) + 1,
          -- A resposta se amarra à mensagem mais recente do cliente.
          'message_id', coalesce(p_payload ->> 'message_id', v_existing.payload ->> 'message_id')
        ),
        next_attempt_at = least(
          now() + make_interval(secs => p_debounce_seconds),
          v_existing.created_at + make_interval(secs => greatest(coalesce(p_max_hold_seconds, 25), p_debounce_seconds))
        ),
        updated_at = now()
    where id = v_existing.id;

    return query select v_existing.id, true;
    return;
  end if;

  insert into public.imf_webhook_outbox (
    event_type, aggregate_id, broker_id, partition_key, payload, next_attempt_at
  )
  values (
    'n8n.inbound_message', p_aggregate_id, p_broker_id, p_partition_key,
    p_payload || jsonb_build_object('merged_ids', to_jsonb(array[p_aggregate_id::text]), 'merged_count', 1),
    now() + make_interval(secs => p_debounce_seconds)
  )
  on conflict (event_type, aggregate_id) do nothing
  returning id into v_id;

  return query select v_id, false;
end;
$$;
