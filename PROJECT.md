# ImobiFlow V2

## Produto

SaaS B2B brasileiro para corretores autônomos, imobiliárias e incorporadoras.
Centraliza carteira de imóveis, landing pages, atendimento de leads pelo
WhatsApp com IA, CRM, agenda, contatos, locação, lançamentos, equipe e
relatórios.

O foco é atendimento e vendas do dia a dia. O ImobiFlow não executa operações
financeiras dos clientes: cobrança de aluguel/reserva e pagamentos ficam fora
do produto. O Asaas permanece somente para a assinatura SaaS do ImobiFlow.
O código histórico de integração direta continua desativado por flag; se um
dia for habilitado, exige a conta Asaas própria da imobiliária/incorporadora e
nunca pode usar a conta global da Criate como fallback, custodiar saldo ou
realizar repasses.

Em Locação, "pagamento fora do produto" não impede o controle operacional: a
imobiliária cria a competência mensal e registra no ImobiFlow o recebimento que
já ocorreu externamente. O registro guarda valor, data, forma e recebimentos
parciais, sem gerar PIX/boleto, movimentar saldo ou afirmar conciliação bancária.
Inquilinos possuem cadastro reutilizável e isolado por conta; contratos mantêm
uma fotografia dos dados da assinatura e formam o histórico do inquilino e do
imóvel sem apagar registros anteriores.

## Escopo ativo

- V2: branch `v2`, produção `https://imobiflow-v2.fly.dev/app`, app Fly
  `imobiflow-v2`.
- Baseline funcional auditado em 27/07/2026: commit `4ee40d6`, release Fly
  `v185`, região `gru`; três `web`, um `scheduler` e um `worker` ativo com uma
  segunda Machine em standby. Redis e Sentry estão ativos; a captura do Sentry
  exclui PII, corpo, cabeçalhos, cookies e parâmetros de URL.
- V1: branch `main`, `https://imobiflow.fly.dev`; congelada como rollback e
  nunca deve ser alterada.
- Tipos de conta: corretor, imobiliária e incorporadora; titular e membros têm
  permissões diferentes.
- `account_type` é o tipo principal. Desde 03/08/2026, as funções especializadas
  Locação, Lançamentos, Financeiro e Equipe podem ser combinadas por conta por
  meio de capabilities administradas no backend. Sem override, os perfis
  preservam os módulos históricos. A migration de capabilities é manual.
- Ambiente ainda em QA, sem clientes ativos/pagantes confirmados em produção.

## Repositório

- Remoto: `criatedavid-tech/imob.criate`.
- Checkout canônico compartilhado por Claude e Codex:
  `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- O checkout antigo `C:\Users\Criate\imob.criate` está congelado e não deve ser
  usado.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind, design Liquid Glass |
| Backend | Express (`server.ts`), worker de webhooks (`webhook-worker.ts`) e scheduler singleton (`scheduler-worker.ts`) |
| Banco/Auth | Supabase Postgres; backend com `service_role` |
| WhatsApp | UAZAPI direta |
| IA | OpenRouter; N8N orquestra o atendimento externo |
| Assinatura SaaS | Asaas |
| Cache/rate limit | Redis Upstash ativo; PostgreSQL continua sendo a fila durável |
| Deploy | Fly.io `gru`, process groups `web`/`worker`/`scheduler`, via GitHub Actions |

## Regras permanentes

- Isolamento multi-tenant é obrigatório. O backend resolve `broker_id` pela
  sessão; nunca confia no tenant enviado pelo cliente.
- Tabelas núcleo usam prefixo `imf_`; a instância Supabase é compartilhada com
  outros projetos.
- Migrations são executadas manualmente pelo usuário no SQL Editor; nunca pelo
  deploy.
- Antes de commit: `npm test`, `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`.
- `git push origin v2` dispara validação e deploy automaticamente.
- A URL pública canônica da V2 é exclusivamente `PUBLIC_APP_URL`, versionada
  no `fly.toml`; não existe fallback para endereço externo em secret.
- Toda mudança funcional atualiza `DOCUMENTACAO.md` e os cinco arquivos PMP.
- Conteúdo de clientes, CRM, áudio e imagem é sempre dado não confiável para
  IA. Saídas do modelo passam por schema estrito e nenhuma mutação é
  executada sem confirmação humana.
