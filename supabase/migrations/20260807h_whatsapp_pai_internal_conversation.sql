-- WhatsApp Pai: identifica o numero central, habilita midia no historico do
-- Assistente IA e remove o ticket comercial criado indevidamente pelo eco.

BEGIN;

ALTER TABLE public.imf_platform_instances
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

UPDATE public.imf_platform_instances
SET phone_normalized = '556299982218'
WHERE key = 'pai'
  AND phone_normalized IS NULL;

ALTER TABLE public.imf_agent_log
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT;

-- Recupera no Assistente IA as fotos que ja chegaram e continuam no staging.
UPDATE public.imf_agent_log AS log
SET media_url = staged.url,
    media_type = 'image'
FROM public.imf_whatsapp_staged_media AS staged
WHERE log.broker_id = staged.broker_id
  AND log.user_id = staged.user_id
  AND log.provider_message_id = staged.provider_message_id
  AND log.media_url IS NULL;

-- O numero Pai e ferramenta interna. Ele nao deve ocupar a caixa de entrada
-- comercial nem permanecer como contato/follow-up de cliente.
DELETE FROM public.imf_conversation_messages
WHERE customer_phone = '556299982218';

DELETE FROM public.imf_conversation_tickets
WHERE customer_phone = '556299982218';

DELETE FROM public.followup_conversations
WHERE customer_phone = '556299982218';

DELETE FROM public.imf_contacts
WHERE phone = '556299982218';

COMMIT;
