# Decisões

---
Data: 2026-07-20
Decisão: Adotar Project Memory Protocol v2.0 (5 arquivos de memória em Markdown na raiz do checkout).
Motivo: Reduzir consumo de contexto e permitir continuidade entre Claude, Codex e outros modelos sem depender do histórico de chat.
Impacto: `DOCUMENTACAO.md` continua como referência técnica completa; os 5 arquivos são camada resumida, atualizada a cada tarefa relevante.

---
Data: 2026-07-20
Decisão: Checkout canônico do projeto passa a ser `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`, compartilhado entre Claude e Codex. `C:\Users\Criate\imob.criate` para de receber alterações.
Motivo: Instrução explícita do usuário para unificar o ponto de trabalho entre os dois agentes.
Impacto: Todo trabalho futuro (Claude e Codex) parte deste checkout. O diretório antigo fica congelado — não apagar nem sincronizar manualmente.

---
Data: 2026-07-20
Decisão: Este checkout foi sincronizado (fast-forward) com `origin/v2` antes de qualquer implementação nova, ao descobrir que estava 20 commits atrás.
Motivo: `git status -sb` reportava "em sync" só por causa de referência remota em cache local (sem fetch prévio). Um fetch real revelou que o CRM com pipelines (entre outras features) já tinha sido implementado, deployado e testado em produção nesses 20 commits — via `C:\Users\Criate\imob.criate` nesta mesma sessão.
Impacto: Evitado retrabalho e uma segunda migration duplicada para as mesmas tabelas. Working tree estava limpo (sem alterações locais) antes do fast-forward, então nenhum trabalho foi perdido.

---
Data: 2026-07-20
Decisão: CRM com pipelines/etapas configuráveis por broker substitui as 5 colunas fixas antigas do Kanban (novo/contato/visita/proposta/fechado). "Leads" renomeado visualmente para "CRM", com abas Kanban e Pipelines.
Motivo: Pedido explícito do usuário — permitir que cada corretor/imobiliária configure seu próprio funil de vendas.
Impacto: Novas tabelas `imf_crm_pipelines`/`imf_crm_pipeline_stages`; `leads.status`/`closed_at` mantidos como espelho de compatibilidade via trigger, pois relatórios/IA/integrações ainda os leem diretamente. Não implementado nesta primeira versão: Dashboard do CRM, Calendário, Ações — ver `DOCUMENTACAO.md` §14.

---
Data: 2026-07-20
Decisão: Drag-and-drop do Kanban migrado da API nativa HTML5 (`draggable`/`onDragStart`) para `@dnd-kit/core`.
Motivo: Safari iOS nunca implementou suporte a toque na API nativa (lacuna do WebKit) — arrastar funcionava no Android/Chrome (camada de compatibilidade própria do navegador) mas não no iPhone. Usuário autorizou explicitamente a troca de biblioteca.
Impacto: `NegociosArea.tsx` reescrito com `DndContext`/`useDraggable`/`useDroppable`/`DragOverlay`. Confirmado funcionando em Android e iPhone reais pelo usuário. Nova dependência: `@dnd-kit/core`.

---
Data: 2026-07-20
Decisão: Deploy da v2 passa a ser automático a cada `git push origin v2`, via GitHub Actions, sem revisão manual entre commit e produção.
Motivo: `flyctl` local ficou bloqueado por política de Windows Smart App Control nesta máquina, sem solução viável no momento (reinstalar não resolveu; alterar a política de segurança do Windows está fora do escopo do agente).
Impacto: Validação (tsc/knip/build/`git diff --check`) precisa rodar OBRIGATORIAMENTE antes do commit, não depois. Secret `FLY_API_TOKEN_V2` dedicado (não reutiliza o `FLY_API_TOKEN` da V1).

---
Data: 2026-07-20
Decisão: Migration `20260720_crm_pipelines_broker_cascade.sql` adiciona `ON DELETE CASCADE` em `imf_crm_pipeline_stages.pipeline_id` e `imf_crm_pipelines.broker_id`, sem alterar a ausência de CASCADE em `leads.pipeline_id`/`pipeline_stage_id`.
Motivo: Exclusão de conta pelo admin (`DELETE /api/admin/brokers/:id`) começou a falhar pra qualquer broker que já tivesse um pipeline — regressão não percebida introduzida pela migration do CRM.
Impacto: Apagar o broker inteiro volta a funcionar (leads já cascadeiam via `imf_properties`/`leads`→`imf_brokers` na mesma operação, então nada fica órfão). Proteção contra apagar UM pipeline/etapa isolado com leads vinculados continua intacta.

---
Data: 2026-07-20
Decisão: Endurecer as mutações críticas do CRM com RPCs transacionais restritas à `service_role` e manter a aba Pipelines em leitura para membros.
Motivo: A auditoria retroativa encontrou execução pública implícita na RPC `SECURITY DEFINER` de reorder, validação incompleta de listas e operações de múltiplos statements sujeitas a estado parcial/concorrência. A UI também oferecia controles que o backend recusava para membros.
Impacto: Migration `20260720b_crm_security_hardening.sql` pendente de execução manual; reorder, autocura, troca de padrão e transições de etapa ficam atômicos; associação a etapa/pipeline inativo é recusada; titularidade passa a ser refletida na UI sem substituir a autorização do servidor.

---
Data: 2026-07-20
Decisão: Todo deploy automático da V2 passa a depender de um job de validação no GitHub Actions.
Motivo: O workflow publicava qualquer push em `v2` sem executar TypeScript, Knip ou build.
Impacto: `deploy` depende de `validate` (`npm ci`, `npm run lint`, `npx knip`, `npm run build`). Não existe aprovação manual pós-push; falha técnica bloqueia a publicação.

---
Data: 2026-07-20
Decisão: A validação de áudio da transcrição (`/api/ai/transcribe`) deixa de usar whitelist de mimeType e passa a validar só "data URL de áudio + base64 válido", derivando o `format` do provedor do conteúdo real.
Motivo: O Safari iOS reporta o mimeType do áudio de forma imprevisível (mp4 com codec entre aspas, às vezes com espaço após `;`), quebrando qualquer regex de allowlist — duas rodadas de "regex mais permissivo" ainda falharam. O mimeType do cliente não é fonte de segurança (a proteção é base64 + limite de tamanho) e nunca é repassado cru.
Impacto: `server/routes/ai.ts` reescrito (`resolveAudioFormat`, `AUDIO_DATA_URL_HEADER`). Áudio de qualquer navegador mobile passa; não-áudio continua barrado. Confirmado em iPhone real.

---
Data: 2026-07-20
Decisão: Uploads de foto no mobile usam input `type=file` transparente sobreposto ao ícone (`absolute inset-0 opacity-0`), nunca botão com `.click()` programático nem `<label>` com input `display:none`.
Motivo: Teste de campo no Chrome Android real: as duas abordagens indiretas não abrem o seletor de arquivo; só o toque direto no próprio input funciona. É o padrão canônico de upload da web.
Impacto: Aplicado em `CommandBar.tsx` (anexo do Assistente IA); é o padrão a reusar em qualquer upload mobile futuro (ex.: PropertyForm). Confirmado em Android real.

---
Data: 2026-07-20
Decisão: O fluxo de conexão do WhatsApp (`POST /api/brokers/whatsapp/connect`) reafirma o webhook da instância UAZAPI a cada conexão (self-heal).
Motivo: Instâncias provisionadas na era Z-PRO tinham o webhook apontando pro backend antigo (`appback.criate.online`), então as mensagens de entrada nunca chegavam no V2 e a conversa ficava "Sem mensagens registradas". O fluxo de conexão não reafirmava o webhook.
Impacto: `setUazapiWebhook` extraído como helper exportado em `provisioning.ts`; `resolveManagedInstance` devolve o `instanceId` da instância existente; qualquer instância legada se autocura ao reconectar. ⚠️ Outras contas legadas podem ter o mesmo webhook podre — checar/reconectar. Confirmado pelo usuário: mensagem de entrada voltou a chegar.

---
Data: 2026-07-20
Decisão: Processar áudio/PTT e imagem recebidos pela UAZAPI inteiramente no backend, convertendo ambos em texto antes de repassar ao N8N.
Motivo: O inbound descartava toda mídia; a URL do webhook é criptografada e o workflow N8N não está acessível. Amostras reais e a API oficial confirmaram que `/message/download` devolve a mídia descriptografada em base64.
Impacto: Áudio usa a transcrição OpenRouter compartilhada com `/api/ai/transcribe`; imagem usa visão pelo mesmo provedor; N8N continua recebendo `text`. Falhas viram fallback explícito. Nenhuma migration e nenhuma alteração no N8N.
