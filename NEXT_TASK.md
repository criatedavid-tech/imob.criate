# Próximas tarefas — ImobiFlow V2

## Segurança: convidado com acesso indevido a Equipe/Desempenho/Locação — pendente: autorização de commit

Dois achados no mesmo report do usuário (print mostrando o convidado com
"acesso total à interface da imobiliária"), ambos corrigidos e testados
localmente (05/08/2026):

1. **Abas Equipe/Desempenho visíveis pra convidado**: `GET /api/brokers/me`
   passou a devolver `is_owner`; `ManualRail.tsx` esconde `equipe`/
   `desempenho` do rail quando quem está logado não é titular.
2. **Locação sem checagem de titularidade nenhuma**: `server/routes/
   locacao.ts` (contratos, inquilinos com CPF/CNPJ, cobranças, chaves — 24
   rotas) não tinha NENHUMA checagem `isOwner`, só sessão válida — qualquer
   convidado tinha CRUD completo. Usuário confirmou (pergunta direta): só
   titular acessa, mesmo padrão da chave Asaas. Middleware de router
   (`.use("/api/locacao", ...)`) agora exige `isBrokerOwner`; aba `locacao`
   também some do rail pra convidado. Home da imobiliária
   (`fetchImobiliariaLayout`) já degrada bem pro convidado — `/api/locacao/
   contracts` retornando 403 vira lista vazia, sem quebrar a tela.

3. **Financeiro também vazava caixa de aluguel pro convidado**: o bloco de
   aluguel em `GET /api/financeiro/summary` não checava titular nenhum —
   corrigido igual ao de Locação (query só roda se `isBrokerOwner`, resto
   zerado). Aba "Financeiro" só entra em `OWNER_ONLY_AREAS` (rail) se a
   conta não tiver `developments` — preserva a visão de "minha venda" do
   corretor de incorporadora, que é escopo diferente (self-service já
   existia, não é company-wide como aluguel).

Testado com sessão real dos dois papéis (titular vê as 4 abas e usa
Locação/Financeiro normal; convidado não vê nenhuma das 4, e a Home não
quebra).
`tsc`/`knip`/`build` limpos; `npm test` 95/96 (o 1 que falha é o CRLF
conhecido do Windows, não relacionado, passa no CI). Ajustada também a
guarda de regressão em `tests/accountCapabilities.test.ts` (verificava o
shape exato do `.use()` de locacao — agora também confere que o
`isBrokerOwner` está lá). Detalhe completo em PROGRESS.md/DOCUMENTACAO.md.
**Aguardando autorização de commit/push.**

## Aba "Desempenho" (ROI da equipe, sem custo cadastrado) — pendente: autorização de commit

Implementado e testado localmente (05/08/2026), mesmo padrão de conta de
teste isolada da rodada anterior. 3 asserções via HTTP, todas passaram de
primeira (inclusive a janela de período excluindo/incluindo lead antigo
corretamente). Detalhe completo em PROGRESS.md.

1. `GET /api/equipe/performance?months=` (novo, `equipe.ts`, titular-only) —
   por corretor: leads recebidos, fechados, conversão, vendido, retorno por
   lead. Reaproveita `collectPages`/`collectForIds`/`reportPeriod`,
   exportados de `relatorios.ts` pra não duplicar paginação.
2. Aba nova "Desempenho" no menu lateral (`engine.ts` + `ManualRail.tsx`,
   ícone `TrendingUp`), mesma capability `team` de Equipe.
3. `src/experience/DesempenhoArea.tsx` (novo): lista os corretores
   ordenados por venda, clique abre o drill-down por membro em Relatórios
   já construído na rodada anterior (`onOpenMemberReport`).
4. **Aguardando autorização de commit/push**.
5. Depois do deploy: conferir a aba com dado real de vários corretores.

## Conta administradora (imobiliária/incorporadora) — ROLLOUT CONCLUÍDO (05/08/2026)

Commit `60466b8`, deploy validado (health-check 200, GitHub Actions run
aprovado). Testado localmente antes do deploy via HTTP contra o banco real
(conta de teste isolada, criada e depois apagada) — 18+ asserções, todas
passaram na primeira tentativa. Detalhe completo em PROGRESS.md/DECISIONS.md.

1. **Migrations** (aplicadas pelo usuário direto no SQL Editor, antes do
   teste local):
   `20260805b_broker_member_suspension.sql`,
   `20260805c_broker_goals_per_member.sql`.
2. Reatribuir dados (leads/imóveis/agenda) de um corretor pra outro membro
   ativo — `GET/POST /api/equipe/members/:userId/{data-summary,reassign}`.
3. Suspender/reativar um corretor sem remover —
   `PATCH /api/equipe/members/:userId/{suspend,reactivate}` + gate em
   `requireUser` (auth.ts).
4. Drill-down de relatório por corretor específico —
   `GET /api/relatorios/summary?member_user_id=`.
5. Meta individual por corretor + bug corrigido (qualquer membro conseguia
   reescrever a meta da conta inteira antes).
6. **Aguardando autorização de commit/push** deste conjunto.
7. Depois do deploy: usar de verdade com uma equipe real (convidar 2+
   corretores) e confirmar a experiência ponta a ponta pela UI (o teste até
   aqui foi via HTTP direto, não clicando na tela).

## CRM automático no agente de vendas — ROLLOUT CONCLUÍDO (05/08/2026)

Validado ponta a ponta em produção, com conversa real via WhatsApp (número
de teste "Ryan"):

1. ~~Backend: `POST /api/crm/n8n/sync-lead` + avanço automático pra etapa
   "Visita" em `POST /api/agenda/n8n/create`.~~ Commit `4852c8f`.
2. ~~Node `sincronizar_lead1` no n8n (criado manualmente — paste de JSON
   não funcionou nesse ambiente) + seção "SINCRONIZAÇÃO COM O CRM" no
   system prompt do "Agente IA Corretor" (gatilho explícito, sem o qual a
   IA não chamava a tool).~~
3. ~~Bug do `=` vazando em campos `$fromAI` de 4 argumentos (com valor
   padrão) — corrigido com sanitização defensiva no backend
   (`cleanAiString`, commit `6d81d25`).~~
4. ~~Teste real confirmado: lead cria limpo, dedupe por telefone funciona
   (achou um teste anterior "leon" com o mesmo número normalizado antes de
   testar com número fresco), nota sem `=`, e a etapa avança sozinha pra
   "Visita" quando a visita é agendada de verdade (visto no Kanban e no
   banco).~~

**Pendência secundária, não bloqueante:** a IA nunca passou `imovel_id`
pro `sincronizar_lead1` nos testes, mesmo sabendo exatamente qual imóvel
("Apartamento Centro" até apareceu no título da visita criada) — o lead
avança de etapa e recebe a qualificação normalmente, só fica sem o
vínculo visual do imóvel no card do CRM. Investigar se é preciso reforçar
a instrução do `imovel_id` no system prompt (hoje só tem a descrição do
parâmetro, sem exemplo de quando a IA já sabe o ID vindo da
`<imoveis_disponiveis>`) ou se o modelo simplesmente não está lendo o
campo `id` de cada imóvel na base recebida.

## Rollout da confirmação de WhatsApp adicional no convite

1. ~~Aplicar manualmente no Supabase a migration
   `supabase/migrations/20260804c_team_invite_slot_upgrade.sql`.~~ Concluído em
   04/08/2026.
2. ~~Somente depois do SQL confirmado, versionar e publicar o código na `v2`.~~
   Concluído na entrega de 04/08/2026.
3. Em conta paga descartável com cota esgotada, selecionar WhatsApp próprio e
   conferir preço unitário, novo total e texto de vigência antes de confirmar.
4. Confirmar a contratação e validar que a vaga e o convite surgem juntos.
5. Cancelar/repetir sem confirmação e validar que `member_limit` não muda.
6. Em voucher sem cota própria, confirmar que não há oferta paga e que o convite
   compartilhado continua disponível.

## Rollout da cota de WhatsApp nos vouchers

1. ~~Aplicar manualmente no Supabase a migration
   `supabase/migrations/20260804b_trial_voucher_whatsapp.sql`.~~ Concluído em
   04/08/2026.
2. ~~Depois do SQL confirmado, versionar e publicar o código na branch `v2`.~~
   Concluído no commit `d0a5ac2`; GitHub Actions run `30913606899` aprovado.
3. Criar um voucher descartável de imobiliária/incorporadora com, por exemplo,
   três corretores e apenas um WhatsApp próprio.
4. Confirmar que um convite `own` reserva a vaga, que o segundo é bloqueado e
   que convites `shared` continuam disponíveis até a cota total da equipe.
5. Confirmar que o fim do teste exige no checkout ao menos o número de slots
   próprios já em uso.

## Rollout dos vouchers de experimentação

1. ~~Revisar e aplicar manualmente no Supabase a migration
   `supabase/migrations/20260804_trial_vouchers.sql`.~~ Concluído em 04/08/2026.
2. ~~Publicar o código, agora que o SQL e as novas RPCs já estão disponíveis.~~
   Concluído no commit `39d92ba` em 04/08/2026.
3. Fazer smoke autenticado com um voucher de cada modalidade: validar link,
   cadastrar, acessar `/app`, convidar até a cota e confirmar bloqueio da vaga
   excedente.
4. Cancelar um voucher ainda ativo e confirmar HTTP 410 no link.
5. Em conta descartável, usar teste curto/controlado para validar o
   redirecionamento ao pagamento após `trial_ends_at`.

> Atualizado em 03/08/2026. O baseline funcional `5dd570d` está versionado na
> branch `v2`; o GitHub Actions run `30849756989` aprovou validação e deploy.
> A migration de funções combináveis foi aplicada manualmente no Supabase.
>
> A nova Etapa 1 do cadastro com cards de plano foi confirmada em produção:
> desktop em três colunas, mobile empilhado sem overflow e preço vindo de
> `GET /api/config/plan`. O ciclo anual continua deliberadamente informativo,
> sem alterar cobrança.

## Estado para retomar

- Checkout canônico:
  `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; não trabalhar em `main` nem no checkout antigo.
- Baseline funcional da produção: commit `5dd570d`, em
  `https://imobiflow-v2.fly.dev`; deploy validado no GitHub Actions run
  `30849756989` e smoke de saúde HTTP 200.
- Fly: 3 `web` ativas e saudáveis, 1 `scheduler` ativo, 1 `worker` ativo e 1
  `worker` standby.
- Redis: ativo e respondendo; rate limit distribuído com fail-open.
- Sentry: ativo para erros, sem PII, corpos, cabeçalhos, cookies, query strings,
  IP, variáveis locais ou tracing; evento artificial aceito pelo SDK.
- N8N: integração ativa. O modelo padrão vem de `server/config.ts`
  (`google/gemini-2.5-flash`) porque não há secret `N8N_AGENT_MODEL`.
- Deploy: automático em todo push para `v2`; migrations permanecem manuais.

## Prioridade 0 — QA das funções combináveis publicadas

Migration e deploy foram concluídos em 03/08/2026. Falta o QA autenticado:

1. Confirmar que uma conta de cada tipo mantém exatamente as
   áreas antigas sem nenhum override.
2. No Admin, liberar `developments` para uma imobiliária de teste e validar que
   Locação e Lançamentos aparecem juntos depois do reload.
3. Testar que retirar uma capability esconde a área e faz a API correspondente
   retornar 403, sem apagar nenhum dado existente.
4. Repetir os testes pelo Assistente IA: uma conta sem capability não pode
   navegar nem confirmar ações especializadas; uma conta liberada pode.
5. Somente após esse QA, vincular capabilities aos tiers comerciais futuros.

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

- [x] Sentry ativado e validado de ponta a ponta em 27/07/2026: secret na Fly,
  filtros de privacidade, evento recebido no painel e issue de teste resolvida.
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
