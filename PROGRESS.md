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
  todo push em `v2` publica sozinho, sem gate manual.
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
- Fix (não commitado): transcrição de áudio do Assistente IA
  (`POST /api/ai/transcribe`) rejeitava com "Dados inválidos." sempre que
  o `mimeType` reportado pelo navegador vinha com parâmetro de codec entre
  aspas (ex.: `codecs="mp4a.40.2"`, formato comum em navegadores mobile) —
  o regex de validação em `server/routes/ai.ts` só aceitava valor sem
  aspas. Corrigido nos dois regexes afetados (`AUDIO_DATA_PREFIX` e
  `audioMimeTypeSchema`); confirmado com teste real contra o servidor
  local (payload antes rejeitado no schema agora passa pra validação
  seguinte; payload realmente inválido continua barrado).

# Em andamento

- Nenhuma implementação em andamento neste momento.

# Bloqueios

- `flyctl` local bloqueado por política de Windows Smart App Control
  nesta máquina — contornado via GitHub Actions, não resolvido na origem.
- Sem dispositivo iOS/Android físico direto disponível pro agente —
  testes de toque dependem de confirmação manual do usuário (já feita
  pra drag-and-drop; outros fluxos mobile não têm confirmação formal
  registrada).

# Próxima tarefa

Ver `NEXT_TASK.md`.
