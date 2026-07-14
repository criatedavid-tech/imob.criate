-- Contatos deixam de ser só cadastro manual: toda mensagem real de cliente
-- que chega pelo WhatsApp (server/routes/wppShim.ts, rota inbound) passa a
-- criar o contato automaticamente na primeira vez, usando o "pushName" que
-- a UAZAPI já manda em todo evento (message.senderName). Precisa de uma
-- constraint única pra o upsert (ON CONFLICT broker_id,phone DO NOTHING)
-- não duplicar contato a cada mensagem nova do mesmo número. Sem duplicatas
-- hoje (checado antes de aplicar).
ALTER TABLE imf_contacts
  ADD CONSTRAINT imf_contacts_broker_phone_unique UNIQUE (broker_id, phone);
