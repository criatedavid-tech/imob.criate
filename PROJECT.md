# ImobiFlow

## Nome

ImobiFlow V2 (nome comercial anterior do produto: "Criate"). Repositório: `imob.criate`.

## Objetivo

SaaS B2B para corretores de imóveis, imobiliárias e incorporadoras no Brasil.
Cadastro de imóveis com geração de site/landing por imóvel, atendimento a
leads via WhatsApp com agente de IA, CRM de leads, locação, lançamentos
(venda de unidades em empreendimentos), gestão de equipe e financeiro.

## Escopo

- V2 é o único produto em desenvolvimento ativo. V1 (`imobiflow.fly.dev`,
  branch `main`) está congelado — existe só como rollback de segurança,
  nenhuma alteração deve ser feita nele.
- Três tipos de conta, cada um com fluxo/permissões próprios: corretor
  autônomo, imobiliária, incorporadora.
- Multi-tenant: cada broker (conta) é isolado. Contas imobiliária/
  incorporadora podem ter membros de equipe vinculados ao broker titular.

## Arquitetura geral

Frontend novo em `src/experience/*` (interface única `/app`) + backend
Express modularizado em `server/`. Detalhe completo em `ARCHITECTURE.md`.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind (design system "Liquid Glass") |
| Backend | Express + TypeScript, `tsx server.ts`, porta 3000 |
| Banco/Auth | Supabase Postgres (backend usa `service_role`, bypassa RLS) |
| WhatsApp | UAZAPI direto (Z-PRO foi eliminado do V2) |
| IA | OpenRouter (única fonte de IA — Gemini removido) |
| Pagamento | Asaas — assinatura mensal recorrente |
| Deploy | Fly.io, região `gru`, app `imobiflow-v2` |
| CI/CD | GitHub Actions — push em `v2` dispara deploy automático |

## Convenções permanentes

- Branch única de trabalho: `v2`. Nunca commitar ou alterar `main` (V1).
- Checkout canônico (compartilhado Claude/Codex, desde 20/07/2026):
  `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Prefixo de tabela núcleo no Supabase (instância compartilhada com outros
  projetos do usuário): `imf_`.
- `service_role` nunca confia em `broker_id` vindo do cliente — sempre
  resolvido no backend a partir do usuário autenticado.
- Sem `@types/react` instalado à parte — `key` direto num componente
  customizado dentro de `.map()` gera erro de TS; usar
  `<React.Fragment key={...}>` ao redor do componente.
- Deploy automático: todo `git push origin v2` inicia o GitHub Actions, sem
  gate manual. O deploy só ocorre se o job automatizado de validação
  (`npm ci`, TypeScript, Knip e build) passar; a validação local antes do
  commit continua obrigatória.
- Migrations nunca são executadas automaticamente — sempre aplicação
  manual pelo usuário no SQL Editor do Supabase, mesmo já commitadas.

## Requisitos permanentes

- Isolamento multi-tenant estrito: nenhum dado (imóvel, lead, pipeline,
  conversa, financeiro) de um broker pode ser acessível por outro.
- Nenhuma alteração no comportamento de V1 (`imobiflow.fly.dev`).
- Ambiente atual sem clientes reais/pagantes (fase de testes) — reduz risco
  de ações diretas em produção, mas não deve ser assumido como permanente.
