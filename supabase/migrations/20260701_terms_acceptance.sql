-- ─── Migração: registro de aceite dos Termos de Uso ─────────────────────────
-- Rodar no Supabase SQL Editor do projeto umvbrahsqvqeondwtikm ANTES do deploy
-- do código que grava/lê estas colunas.
--
-- Contexto: o aceite do checkbox (Signup/checkout) era só client-side — sem
-- registro de quem aceitou qual versão dos Termos/Privacidade. Estas colunas
-- guardam a prova do aceite (LGPD/CDC) e permitem o modal de re-aceite quando
-- TERMS_VERSION (server.ts) mudar.

ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
