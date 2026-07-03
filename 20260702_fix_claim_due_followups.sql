-- ─── Correção: claim_due_followups() ───────────────────────────────────────
-- Rodar no Supabase SQL Editor do projeto umvbrahsqvqeondwtikm
--
-- Baseado na função REAL que está rodando hoje no banco (auditoria de schema
-- 2026-07-02), não na versão desatualizada de supabase_followup_per_delay.sql.
-- Preserva a melhoria já em produção (Follow 2/3 contam o atraso a partir de
-- follow_sent_at) e corrige 2 problemas:
--
-- 1) JOIN brokers → tabela não existe (foi renomeada pra imf_brokers).
--    Resultado: TODO tick de 60s falhava e NENHUM follow-up saía.
-- 2) Função não devolvia zpro_ticket_id. O código (server/services/followup.ts)
--    já espera esse campo pra checar se o corretor assumiu a conversa no
--    Z-PRO antes de mandar o follow — sem ele, essa checagem nunca rodava
--    de verdade (checkTicketOpen sempre recebia undefined).
--
-- Muda o tipo de retorno (coluna zpro_ticket_id nova) — Postgres não deixa
-- CREATE OR REPLACE trocar o retorno de uma função existente (erro 42P13),
-- por isso o DROP antes. Só recria a função — não mexe em dados nem em
-- nenhuma tabela. A janela entre DROP e CREATE é de milissegundos; se o tick
-- de 60s do follow-up cair exatamente nela, ele só loga erro e tenta de novo
-- no próximo ciclo (mesmo comportamento de falha que já existe hoje).

DROP FUNCTION IF EXISTS public.claim_due_followups();

CREATE OR REPLACE FUNCTION public.claim_due_followups()
 RETURNS TABLE(
   conversation_id uuid,
   broker_id       uuid,
   customer_phone  text,
   message_index   integer,
   message         text,
   zpro_api_url    text,
   zpro_api_token  text,
   zpro_ticket_id  text
 )
 LANGUAGE sql
AS $function$
  WITH claimed AS (
    UPDATE followup_conversations fc_upd
    SET
      follow_sent          = true,
      follow_sent_at       = now(),
      follow_message_index = fc_upd.follow_message_index + 1,
      updated_at           = now()
    WHERE fc_upd.id IN (
      SELECT fc.id
      FROM followup_conversations fc
      JOIN followup_config cfg ON cfg.broker_id = fc.broker_id
      WHERE
        fc.follow_sent           = false
        AND fc.ai_active         = true
        AND fc.follow_message_index < 3
        AND cfg.enabled          = true
        AND (
          -- Follow 1: conta a partir da última mensagem do cliente
          (fc.follow_message_index = 0
            AND fc.last_customer_message_at + (cfg.delay_minutes_1 * INTERVAL '1 minute') <= now())
          OR
          -- Follow 2: conta a partir de quando o Follow 1 foi enviado
          (fc.follow_message_index = 1
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at + (cfg.delay_minutes_2 * INTERVAL '1 minute') <= now())
          OR
          -- Follow 3: conta a partir de quando o Follow 2 foi enviado
          (fc.follow_message_index = 2
            AND fc.follow_sent_at IS NOT NULL
            AND fc.follow_sent_at + (cfg.delay_minutes_3 * INTERVAL '1 minute') <= now())
        )
      FOR UPDATE SKIP LOCKED
    )
    RETURNING fc_upd.*
  )
  SELECT
    c.id               AS conversation_id,
    c.broker_id,
    c.customer_phone,
    c.follow_message_index AS message_index,
    CASE c.follow_message_index
      WHEN 1 THEN cfg.message_1
      WHEN 2 THEN cfg.message_2
      WHEN 3 THEN cfg.message_3
    END                AS message,
    b.zpro_api_url,
    b.zpro_api_token,
    c.zpro_ticket_id
  FROM claimed c
  JOIN followup_config cfg ON cfg.broker_id = c.broker_id
  JOIN imf_brokers b       ON b.id = c.broker_id;
$function$;
