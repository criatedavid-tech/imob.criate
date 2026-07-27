# Próximas tarefas — ImobiFlow V2

> Atualizado em 27/07/2026. Este arquivo substitui as listas antigas de
> alterações funcionais pendentes: o baseline funcional `4ee40d6` está
> versionado na branch `v2` e foi validado na release Fly `v185`. O pacote
> documental posterior não muda o código do produto.
>
> A nova Etapa 1 do cadastro com cards de plano foi confirmada em produção:
> desktop em três colunas, mobile empilhado sem overflow e preço vindo de
> `GET /api/config/plan`. O ciclo anual continua deliberadamente informativo,
> sem alterar cobrança.

## Estado para retomar

- Checkout canônico:
  `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; não trabalhar em `main` nem no checkout antigo.
- Baseline funcional da produção: release `v185`, commit `4ee40d6`, em
  `https://imobiflow-v2.fly.dev`; consultar Fly/GitHub para o número da release
  documental mais recente.
- Fly: 3 `web` ativas e saudáveis, 1 `scheduler` ativo, 1 `worker` ativo e 1
  `worker` standby.
- Redis: ativo e respondendo; rate limit distribuído com fail-open.
- Sentry: ativo para erros, sem PII, corpos, cabeçalhos, cookies, query strings,
  IP, variáveis locais ou tracing; evento artificial aceito pelo SDK.
- N8N: integração ativa. O modelo padrão vem de `server/config.ts`
  (`google/gemini-2.5-flash`) porque não há secret `N8N_AGENT_MODEL`.
- Deploy: automático em todo push para `v2`; migrations permanecem manuais.

## Prioridade 1 — confirmar o banco da escala

O arquivo `supabase/migrations/20260724_scale_hot_path_indexes.sql` está no
repositório, mas esta auditoria não confirmou sua aplicação no Supabase de
produção.

1. Consultar os índices/objetos definidos na migration no SQL Editor.
2. Se faltarem, executar o arquivo manualmente em janela controlada.
3. Repetir as consultas de verificação e registrar o resultado em
   `DOCUMENTACAO.md` e `PROGRESS.md`.

Não executar migrations por deploy e não declarar “aplicada” apenas porque o
arquivo existe no Git.

## Prioridade 2 — QA operacional da topologia atual

Executar sem carga destrutiva:

1. Confirmar `/api/health` nas três web e painel Admin sem alertas.
2. Enviar texto, áudio, imagem e documento pelo WhatsApp; verificar mensagem,
   mídia reproduzível, inbox/outbox concluídas e resposta do N8N.
3. Testar resposta manual, nota interna, anexos, troca de etapa CRM, pausar e
   reativar IA.
4. Confirmar o guardião de webhook e o backfill sem duplicação.
5. Reiniciar uma web e o worker ativo de forma controlada; observar recuperação
   e ausência de perda.
6. Registrar p95/p99, backlog, memória e erros antes de alterar quantidade ou
   tamanho das Machines.

## Prioridade 3 — hardening manual do N8N

O backend já aceita autenticação dedicada, mas o ambiente auditado ainda usa o
fallback `INTERNAL_PROXY_TOKEN` para a entrada do webhook.

1. Validar se o workflow rejeita chamadas sem Header Auth.
2. Criar/configurar `N8N_WEBHOOK_TOKEN` exclusivo, sem reutilizar o token da
   API interna.
3. Remover headers literais do workflow e usar credenciais do N8N.
4. Confirmar chave de memória por `broker_id:ticket_id`.
5. Persistir/consultar `event_id` antes de efeitos externos para deduplicação.
6. Verificar se `20260722a_n8n_agenda_guardrails.sql` foi aplicada.
7. Executar o roteiro de [`docs/N8N_SECURITY_HARDENING.md`](./docs/N8N_SECURITY_HARDENING.md).

## Prioridade 4 — teste de carga em staging

Não executar carga pesada em produção. Criar staging com banco e provedores
isolados/stubados e seguir [`SCALABILITY_TEST_PLAN.md`](./SCALABILITY_TEST_PLAN.md):

- HTTP sem banco;
- mix autenticado de Dashboard, Conversas, Agenda, CRM e Contatos;
- inbound/outbox a 10, 25 e 50 eventos/s;
- falha e recuperação do N8N;
- desligamento do worker durante pico;
- lotes de scheduler;
- soak de duas horas.

Somente dados medidos devem embasar nova escala de web/worker ou mudança de
batches.

## Prioridade 5 — observabilidade e lançamento

- Confirmar visualmente o evento de validação no painel do Sentry com o
  bloqueador de conteúdo desativado e revisar a política de retenção do projeto.
- Criar alertas de fila `dead`, idade acima de 60 s, erro HTTP, reinício e uso
  de memória.
- Repetir isolamento com dois tenants e titular/membro.
- Reexecutar QA de desktop, iPhone e Android para chat, CRM, modais, teclado
  virtual, temas Dia/Noite e vitrines.
- Rodar periodicamente `npm audit`, além do gate padrão do repositório.

## Gate antes de qualquer commit futuro

```powershell
npm test
npm run lint
npx knip
npm run build
git diff --check
```

Revisar o diff, atualizar documentação da mudança funcional e lembrar que
`git push origin v2` inicia o deploy automaticamente.
