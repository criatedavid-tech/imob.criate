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
- Rodada mobile do Assistente IA — três correções, todas confirmadas pelo
  usuário em aparelho real (20/07/2026):
  - **iOS — áudio "Dados inválidos.":** `POST /api/ai/transcribe`
    (`server/routes/ai.ts`) rejeitava o mimeType imprevisível do Safari.
    Largou a whitelist de formato: valida só "data URL de áudio + base64" e
    deriva o `format` do provedor do conteúdo real (`resolveAudioFormat`).
    ✅ confirmado.
  - **Android — anexo de foto não abria (3 tentativas):** `.click()`
    programático e `<label>` com input `display:none` falharam no Chrome
    Android real. Solução final: input `type=file` transparente por cima do
    ícone (`absolute inset-0 opacity-0`), toque direto no input. ✅
    confirmado. + no WebView do WhatsApp (sem seletor de arquivo) mostra
    dica "abrir no Chrome" (detecção `; wv)` no UA).
  - **WhatsApp de entrada não chegava:** webhook da instância UAZAPI apontava
    pro Z-PRO morto (`appback.criate.online`). Self-heal:
    `setUazapiWebhook` reafirmado em `/api/brokers/whatsapp/connect`;
    instância afetada re-apontada na hora. ✅ confirmado.
  - Validado local: tsc/knip/build limpos; testes HTTP ao vivo (5 formatos
    de mimeType) + verificação no navegador (overlay do input, hit-test,
    detecção de WebView) + diagnóstico read-only do webhook contra
    Supabase/UAZAPI reais.

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
- Nada em aberto no momento. (A rodada mobile do Assistente IA — commits
  `e76181f`→`729b000`, em paralelo ao hardening do CRM — está concluída e
  confirmada pelo usuário; ver "Concluído".)

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
