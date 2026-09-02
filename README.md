# PANTUS Real Estate

SaaS B2B brasileiro para corretores autônomos, imobiliárias e incorporadoras.
O produto reúne carteira, vitrines públicas, CRM, conversas de WhatsApp,
agenda, contatos, equipe, locação, lançamentos, relatórios e uma Assistente IA
para a operação diária. Nome interno do repositório e das tabelas continua
`ImobiFlow`/`imf_` — ver [nota sobre nomes](#nome-interno-vs-nome-comercial).

> **V2 é o único produto.** A V1 foi decomissionada em 02/09/2026: app Fly
> `imobiflow` destruída, código legado removido, clone local
> `C:\Users\Criate\imob.criate` apagado e o branch `main` excluído do GitHub
> (branch padrão do repositório agora é `v2`). Este repositório (branch `v2`,
> app Fly `imobiflow-v2`) é o único checkout que existe. Detalhe em
> [`DECISIONS.md`](./DECISIONS.md).

## Arquitetura em produção

| Camada | Estado atual |
| --- | --- |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 6 e Motion |
| Backend | Node.js, Express e TypeScript executado com `tsx` |
| Dados | Supabase Auth, PostgreSQL e Storage privado; backend usa `service_role` |
| WhatsApp | UAZAPI direta por conta/membro |
| Agente externo | N8N + OpenRouter; modelo padrão entregue pelo backend: `google/gemini-2.5-flash` |
| Assistente interno | OpenRouter; modelo atual em código: `xiaomi/mimo-v2.5` |
| IA de mídia | OpenRouter; `google/gemini-2.5-flash-lite` para transcrição/visão |
| IA de texto auxiliar | OpenRouter; `openai/gpt-4o-mini` |
| Cache/rate limit | Redis Upstash ativo; falha de Redis não derruba a API |
| Fila durável | Inbox/outbox no PostgreSQL, com retry, lease, DLQ e `event_id` |
| Assinatura SaaS | Asaas; operações financeiras de clientes ficam desativadas por padrão |
| Deploy | GitHub Actions para Fly.io, região `gru` |

Topologia Fly em regime normal: grupo `web` com 3 Machines
`shared-cpu-1x`/1 GB (`min_machines_running=2`, concorrência soft 80/hard
150), 1 Machine `scheduler` singleton com `scheduler-worker.ts` (20 jobs
periódicos) e o grupo `worker` com 2 Machines (1 ativa, 1 standby) rodando
`webhook-worker.ts`. Redis conectado; Sentry ativo para erros, sem PII e sem
tracing. Essa topologia melhora disponibilidade, mas não constitui prova de
capacidade para 100+ corretores simultâneos — os gates estão em
[`SCALABILITY_TEST_PLAN.md`](./SCALABILITY_TEST_PLAN.md).

## Produto e personas

As três personas usam a mesma experiência em `/app`, com permissões distintas
para titular e membros:

- **Corretor:** Hoje, Conversas, Assistente IA, Carteira, CRM, Agenda,
  Contatos, Lembretes, Divulgação, Relatórios e Config;
- **Imobiliária:** acrescenta Locação, Financeiro, Equipe e Desempenho;
- **Incorporadora:** acrescenta Lançamentos, Financeiro, Equipe e Desempenho.

`account_type` é o tipo principal, não um bloqueio definitivo. O backend também
resolve as capabilities `rentals`, `developments`, `finance` e `team`, que podem
ser combinadas por conta no painel Admin. Sem override, os três perfis mantêm
exatamente os módulos listados acima. Esconder o menu não substitui a
autorização das rotas no servidor.

No cadastro, essas personas aparecem como três cards de plano com o mesmo
preço mensal retornado por `GET /api/config/plan`; o seletor anual é apenas
informativo e não muda a cobrança. Imobiliária e incorporadora exibem o add-on
de WhatsApp próprio por membro. Vouchers de experimentação usam cotas
separadas para total de corretores convidados e convidados com WhatsApp
próprio.

O Asaas cobra a assinatura do PANTUS Real Estate. Cobrança de aluguel, reserva
e outros pagamentos de clientes fica desligada por padrão em ambientes
genéricos; na V2, o piloto é habilitado somente com
`CLIENT_FINANCIAL_SANDBOX_ONLY=true`, que recusa chaves de produção. Mesmo na
ativação explícita, essas cobranças exigem a integração própria da conta
cliente: não existe fallback para a conta Asaas global da Criate, custódia de
valores ou repasse financeiro pelo PANTUS Real Estate.

O módulo de Locação mantém contrato, garantia, encargos e reajuste e permite
registrar competências e pagamentos realizados externamente. Esse lançamento
manual pode receber boleto PDF privado, ser enviado por WhatsApp e ter baixa
**Pago/Não pago**. Quando a conta usa Asaas, webhook e conciliação periódica
confirmam o pagamento automaticamente. Em nenhum modo o PANTUS Real Estate
recebe ou repassa o dinheiro: ele gera/importa a cobrança e acompanha o
status. Depois que existe histórico financeiro, o contrato só pode ser
encerrado, não apagado.

Inquilinos são cadastrados uma única vez e podem ser vinculados a contratos
sucessivos. O perfil atual pode ser atualizado sem reescrever a fotografia
cadastral já preservada nos contratos; a interface mostra o histórico por
inquilino e por imóvel. Vínculos de outra conta são rejeitados no backend e no
banco. Em **Locação → Inquilinos**, a situação financeira consolidada informa
**Adimplente**, **Inadimplente** ou **Sem cobrança**. O cartão do contrato
repete o indicador e, quando há atraso, mostra quantidade de pendências e
saldo vencido. Cobrança futura não conta como inadimplência; acordo só deixa
de ser dívida após a confirmação do pagamento.

## Dois agentes, três canais

1. A **Assistente IA interna** atende o corretor dentro do app. Consulta o
   snapshot autorizado da conta, navega e responde; qualquer mutação exige
   confirmação humana, inclusive no modo piloto.
2. O **WhatsApp Pai** é outra entrada da mesma Assistente IA interna. Resolve o
   usuário pelo telefone verificado, compartilha histórico/permissões com o
   painel e nunca deve aparecer em Conversas ou chegar ao cliente final.
3. O **agente de atendimento do WhatsApp** roda no N8N e conversa com clientes
   finais. O backend expõe catálogo/configuração sob autenticação interna e
   envia `event_id` estável para deduplicação.

Dados de clientes, descrições, CRM e mensagens são tratados como conteúdo não
confiável. A saída estruturada do agente interno passa por schema Zod estrito.
Toda ação mutante e toda consulta estruturada (`AGENT_ACTION_PERMISSION` em
`server/services/agent.ts`) passa pelo mesmo mapa de permissões granulares
(`imf_member_permissions`) antes de executar, nos dois canais — o mesmo gate
que já vale para as rotas do painel.

## Mensagens e mídia

O inbound da UAZAPI é persistido antes do ACK. Um worker separado processa
inbox e outbox; texto e mídia seguem ao N8N com entrega at-least-once. Áudios,
imagens e documentos suportados ficam acessíveis na conversa por URL de
Storage, e um job de backfill tenta recuperar mídia histórica incompleta.
Outro job reafirma periodicamente os webhooks UAZAPI.

O comando exato `@reset`, disponível no WhatsApp Pai e no painel, limpa o
histórico pessoal compartilhado, propostas não executadas e anexos temporários.
Ele não apaga dados de negócio nem as bolhas já existentes no aplicativo
WhatsApp. O botão **Nova conversa** usa a mesma operação transacional.

## Estrutura principal

```text
imob.criate/
├── server.ts                       # bootstrap HTTP/Express e SPA
├── webhook-worker.ts               # worker de inbox/outbox
├── scheduler-worker.ts             # 20 jobs periódicos singleton
├── server/
│   ├── config.ts                   # configuração centralizada
│   ├── lib/                        # Redis, Sentry e infraestrutura comum
│   ├── middleware/                 # autenticação, tenant e validação
│   ├── routes/                     # APIs por domínio
│   ├── security/                   # guardrails do agente
│   └── services/                   # domínio e integrações
├── src/
│   ├── experience/                 # cockpit V2 (única interface do produto)
│   ├── components/
│   ├── pages/                      # auth, admin e páginas públicas
│   └── lib/
├── supabase/migrations/            # SQL versionado, aplicado manualmente
├── fly.toml
└── DOCUMENTACAO.md                 # referência técnica detalhada
```

## Executar localmente

```bash
npm ci
# copiar .env.example para .env e preencher somente no ambiente local
npm run dev

npm test
npm run lint
npx knip
npm run build
git diff --check
```

O Vite roda como middleware do Express em desenvolvimento; a porta padrão é
3000. Não versionar `.env` nem chaves reais.

## Publicação

O fluxo normal é automático: um push em `v2` dispara
`.github/workflows/deploy-v2.yml`, que executa instalação limpa, testes,
TypeScript, Knip e build antes de publicar no app `imobiflow-v2`.

Comandos `fly status`, `fly checks list`, `fly releases` e `fly logs` são
diagnósticos. `fly deploy` manual é apenas recuperação operacional consciente,
não o caminho normal do projeto. Migrations nunca são aplicadas pelo deploy.

## Segurança essencial

- JWT Supabase é validado no backend; `broker_id` vem da sessão, não do cliente;
- toda rota com `service_role` filtra tenant e pertencimento explicitamente;
- rotas internas do N8N usam Bearer token; o token dedicado de entrada ainda
  precisa de confirmação/configuração no workflow;
- webhook UAZAPI valida o token da instância;
- Storage sensível é privado e usa URL assinada;
- Redis é usado para rate limit distribuído e opera em modo fail-open;
- Sentry está ativo com `sendDefaultPii: false`, sem corpos, cabeçalhos,
  cookies, query strings, IP, dados de usuário ou variáveis locais;
- migrations são manuais e devem ser verificadas antes de código dependente.

## Nome interno vs. nome comercial

O nome comercial exibido ao usuário é **PANTUS Real Estate** (decidido em
02/09/2026, ver [`DECISIONS.md`](./DECISIONS.md)). O nome interno/técnico
continua `ImobiFlow` de propósito — repositório GitHub, prefixo `imf_` de
todas as tabelas, app Fly `imobiflow-v2` — trocar isso seria uma migration de
alto risco sem ganho de produto. As duas coisas convivem: código e infra
falam `ImobiFlow`, tela e mensagem ao usuário falam `PANTUS Real Estate`.

## Fontes de verdade

- [`PROJECT.md`](./PROJECT.md): escopo e regras permanentes;
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): mapa técnico atual;
- [`DOCUMENTACAO.md`](./DOCUMENTACAO.md): referência completa;
- [`PROGRESS.md`](./PROGRESS.md): histórico e estado consolidado;
- [`DECISIONS.md`](./DECISIONS.md): decisões vigentes;
- [`NEXT_TASK.md`](./NEXT_TASK.md): próximos gates reais;
- [`WEBHOOK_QUEUE_ROLLOUT.md`](./WEBHOOK_QUEUE_ROLLOUT.md): operação da fila;
- [`docs/N8N_SECURITY_HARDENING.md`](./docs/N8N_SECURITY_HARDENING.md):
  hardening do workflow que exige validação manual no N8N.
