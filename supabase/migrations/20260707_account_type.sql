-- Tipo de conta: define o "mundo" que o usuário enxerga (menus + cockpit).
-- Até agora a persona (corretor/imobiliaria/incorporadora) era só um toggle no
-- front ("ver como"), acessível por qualquer um. Isto torna o tipo REAL: gravado
-- por conta, escolhido no cadastro, e usado pra travar o app no mundo certo
-- (o seletor "ver como" passa a ser exclusivo de admin).

ALTER TABLE imf_brokers
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'corretor'
    CHECK (account_type IN ('corretor', 'imobiliaria', 'incorporadora'));

-- Contas existentes ficam como 'corretor' (o default acima já cobre o backfill,
-- que é o caso mais comum — corretor autônomo). Ajustar manualmente as que forem
-- imobiliária/incorporadora depois, pelo painel admin.
