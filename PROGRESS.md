# Concluído

- CRM com pipelines e etapas configuráveis por broker (Leads → CRM):
  migration `20260717b_crm_pipelines.sql` (aplicada e verificada),
  `server/services/crmPipelines.ts`, `server/routes/crmPipelines.ts`
  (`/api/crm/*`), `PATCH /api/leads/:id/stage`, UI `NegociosArea.tsx`
  (aba Kanban) + `PipelinesManager.tsx` (aba Pipelines). Deploy: release
  v94.
- Redesign visual do Kanban em "lanes" sem barra de rolagem visível
  (release v95).
- Fix de travamento do chat de IA no mobile (flip 3D + backdrop-blur
  trocado por slide/fade simples + `100dvh`).
- Pipeline de deploy automático via GitHub Actions (`deploy-v2.yml`) —
  todo push em `v2` inicia o fluxo; deploy agora depende do gate automático
  de `npm ci`, TypeScript, Knip e build.
- Drag-and-drop cross-platform: migração de HTML5 DnD nativo pra
  `@dnd-kit/core` — confirmado funcionando em Android e iPhone reais pelo
  usuário em 20/07/2026.
- Bug de exclusão de conta pelo admin corrigido: `DELETE
  /api/admin/brokers/:id` falhava silenciosamente (sem CASCADE em
  `imf_crm_pipelines`/`imf_crm_pipeline_stages`, erro não checado).
  Migration `20260720_crm_pipelines_broker_cascade.sql` aplicada e
  verificada com teste real (broker+pipeline+etapa descartáveis).
- Checklist de testes funcionais da IA planejados adicionado em
  `DOCUMENTACAO.md` §15 (roteiro de 3 testes, ainda não executados).
- Checkout `imob.criate-phase3` sincronizado com `origin/v2` (estava 20
  commits atrás) e validado localmente: `npx tsc --noEmit`, `npx knip` e
  `npm run build` limpos após `npm install`.
- Fix do Assistente IA no mobile (dois bugs, um por plataforma):
  - iOS: `POST /api/ai/transcribe` rejeitava áudio com "Dados inválidos."
    porque o Safari reporta `mimeType` imprevisível (mp4 com codec entre
    aspas, às vezes com espaço). `server/routes/ai.ts` reescrito: mimeType
    virou dica opcional, validação passou a ser data-URL-de-áudio +
    base64, e o `format` do provedor é derivado do conteúdo real.
  - Android: seletor de foto não abria (`<input type=file>` com
    `display:none`); virou renderizado-fora-da-tela em `CommandBar.tsx`.
  - Validado local: tsc/knip/build limpos; teste HTTP ao vivo cobrindo 5
    formatos de mimeType (iOS/Android) todos passando e não-áudio barrado;
    verificação no navegador de que o input renderiza e o clipe dispara o
    seletor.

# Em andamento

- Hardening do CRM concluído tecnicamente e incluído no pacote de publicação
  autorizado pelo usuário em 20/07/2026:
  - migration `20260720b_crm_security_hardening.sql` executada manualmente
    pelo usuário e verificada: seis objetos `OK`, RPCs exclusivas da
    `service_role` e trigger instalado;
  - RPC de reorder sem permissão pública e com validação de duplicidade,
    completude e ordem;
  - autocura, troca de padrão, edição e transição de etapa atômicas;
  - trigger recusa associação a etapa/pipeline inativo;
  - endpoint legado de status mantém o Kanban sincronizado;
  - membros veem Pipelines em modo leitura; só titular vê controles;
  - erros internos do CRM não são devolvidos crus ao cliente;
  - dependências atualizadas: `npm audit` online com 0 vulnerabilidades.
- Correção mobile do Assistente IA foi feita em paralelo e teve uma primeira
  versão commitada em `e76181f`; há nova edição local concorrente e já staged
  em `CommandBar.tsx`. Esse arquivo não faz parte nem deve ser incluído no diff
  de hardening do CRM.

# Bloqueios

- `flyctl` local bloqueado por política de Windows Smart App Control
  nesta máquina — contornado via GitHub Actions, não resolvido na origem.
- Sem dispositivo iOS/Android físico direto disponível pro agente —
  testes de toque dependem de confirmação manual do usuário (já feita
  pra drag-and-drop; outros fluxos mobile não têm confirmação formal
  registrada).
- QA funcional autenticado do hardening do CRM será executado após o deploy
  do backend que usa as novas RPCs.

# Próxima tarefa

Ver `NEXT_TASK.md`.
