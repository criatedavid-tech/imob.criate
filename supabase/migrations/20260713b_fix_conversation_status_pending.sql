-- Bug encontrado testando o provisionamento por membro (2026-07-13): o
-- CHECK original (20260702_conversation_messages.sql) só permitia
-- 'open'/'closed', mas todo o código (webhook inbound em conversations.ts, a
-- validação manual de status, e a tela ConversasArea.tsx com 3 abas
-- ia/aguardando/encerrado) sempre tratou 'pending' como terceiro status
-- válido. Resultado: toda conversa nova ou reaberta falhava silenciosamente
-- no upsert (erro engolido pelo catch do handler) — confirmado por checagem
-- direta: só existiam 2 linhas na tabela, ambas 'open', nenhuma 'pending'.
ALTER TABLE followup_conversations
  DROP CONSTRAINT IF EXISTS followup_conversations_conversation_status_check;
ALTER TABLE followup_conversations
  ADD CONSTRAINT followup_conversations_conversation_status_check
  CHECK (conversation_status IN ('pending', 'open', 'closed'));
