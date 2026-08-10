# Próximas tarefas — ImobiFlow V2

## `@reset` do Assistente IA — migration aplicada; deploy/aceite pendentes

Migration `supabase/migrations/20260810a_agent_conversation_reset.sql` aplicada
e verificada em produção em 10/08/2026. Depois do deploy, enviar **somente**
`@reset` ao WhatsApp Pai e confirmar: resposta de histórico zerado, Assistente
IA vazio ao recarregar, nenhum lead/imóvel/agenda removido e nenhuma entrada do
número Pai em Conversas. As mensagens antigas continuam no aplicativo do
WhatsApp, mas não permanecem como memória da IA.

## WhatsApp Pai — Fases 1-7 publicadas; aceite final em andamento

**Estado confirmado em produção em 10/08/2026:** commit `4c525f2`, release
Fly 234 e migration `20260807h_whatsapp_pai_internal_conversation.sql`
aplicada. O número Pai `556299982218` está pareado e com webhook ativo. A
auditoria encontrou 22 eventos concluídos, zero item `dead`, zero ação
pendente, zero mídia/documento temporário vencido, 6 mídias permanentes no
Assistente IA e 2 vínculos de equipe verificados.

O canal interno também foi separado dos canais comerciais: o número Pai foi
removido de leads, tickets, mensagens comerciais, follow-ups e contatos; o
Hunter responde 409 se esse número alcançar seu pipeline. Assim, a conversa
fica somente no Assistente IA e não deve aparecer em **Conversas**.

**Pendências reais de aceite:** (1) validar visualmente, em sessão autenticada,
as 6 fotos no Assistente IA e a ausência do número Pai em Conversas; (2) fazer
um único smoke controlado com PDF pequeno para encerrar a validação real da
Fase 7. A sessão de navegador usada na auditoria abriu sem autenticação, então
o item visual ainda depende de login. Não enviar rajadas nem massa sintética.

Pedido do usuário: número de WhatsApp central onde qualquer usuário
(titular ou membro, entre potencialmente centenas de contas) manda
comando em linguagem natural (texto/áudio/foto/documento) e a IA executa
a ação real na conta correta, respeitando as mesmas permissões do painel.
Nativo, sem n8n. Plano completo em `.claude/plans/zany-forging-curry.md`
(7 fases). Detalhe completo em PROGRESS.md/DOCUMENTACAO.md.

**Fase 1 (fechar a lacuna de permissão no agente) — concluída e testada
ao vivo**: achado da investigação — `hasPermission`/`imf_member_permissions`
(sistema construído mais cedo nesta mesma sessão) nunca era consultado em
`server/services/agent.ts`/`server/routes/agent.ts`; um membro sem
`carteira:criar` já conseguia cadastrar imóvel via assistente de IA do
painel. Corrigido com `AGENT_ACTION_PERMISSION` (mapa ação→módulo:ação
novo em `agent.ts`) + gate soft em `runAgent` (nem propõe a ação sem
permissão) + gate hard em `executeAction` (nunca executa, mesmo que a
proposta já tenha sido recebida antes de uma revogação — cenário de
corrida). Beneficia o assistente do painel E o futuro WhatsApp Pai, já
que os dois vão compartilhar o mesmo `executeAction`.

Testado ao vivo com conta descartável (titular + 1 membro): membro sem
grade nenhuma é negado sem propor nada; titular concede perfil "corretor"
→ fluxo normal de proposta+confirmação; titular nunca é bloqueado;
revogar `carteira:criar` volta a negar imediatamente (sem esperar o cache
de 60s, invalidado no PUT); cenário de corrida propor→revogar→confirmar é
bloqueado pelo gate hard mesmo com a ação já em mãos. `tsc`/`knip`/`npm
test` limpos (144 testes, 1 falha pré-existente sem relação — flagueada
separadamente, ver `tests/scheduledCardEditing.test.ts`).

**Fase 2 (vínculo de telefone com verificação) — concluída e testada ao
vivo, com um achado real de infraestrutura no caminho**: nova tabela
`imf_whatsapp_staff_links` (PK = telefone normalizado), `server/security/
whatsappVerificationCode.ts` (código de 6 dígitos + hash sha256, nunca
texto puro salvo), `server/services/whatsappStaffLinks.ts` (start/confirm/
list/unlink), rotas `GET/POST/DELETE /api/me/whatsapp-link*`
(`requireUser` + rate limit novo `whatsappLinkLimiter`), card novo em
`ConfigArea.tsx` (telefone → código → confirmar, com lista de vínculos e
botão de desvincular).

Achado ao vivo: o envio original copiava o padrão de `auth.ts`'s
recuperação de senha (`POST /message/text/:session`), mas esse endpoint
já está documentado como morto desde 03/07 em `uazapi.ts` (405 pra
qualquer valor no path) — corrigido pra reusar `sendUazapiText` (o mesmo
`/send/text` já comprovado ao vivo pro resto do app). Além disso,
`UAZAPI_PLATFORM_SESSION` no `.env` local nunca tinha sido preenchido de
verdade (ficou o placeholder `"COLE_O_NOME_DA_SESSAO_AQUI"`) — provisionada
uma instância UAZAPI temporária pareada com o número pessoal do usuário
só pra validar o fluxo local (token real salvo no `.env`, comentário
deixado explicando que é temporário até a Fase 3 trazer o número oficial).

Testado ao vivo: telefone inválido rejeitado, código errado rejeitado
(incrementa tentativa), código expirado rejeitado, bloqueio após 5
tentativas, outro usuário não confirma verificação pendente alheia — tudo
via script contra o servidor real. O fluxo feliz completo (enviar →
receber no WhatsApp de verdade → digitar → confirmar) foi validado pelo
próprio usuário direto na tela real do navegador. `tsc`/`knip`/`npm test`
limpos (144/144).

**Fase 3 (instância central do Pai, gerenciada pelo admin) — concluída e
testada ao vivo**: tabela `imf_platform_instances` (linha única, `key=
'pai'`, sem amarrar a nenhum broker — diferente de corretor/membro, o Pai
é UMA instância compartilhada por TODA a plataforma). `provisioning.ts`
ganhou `ensurePlatformInstance`/`provisionUazapiInstanceForPlatform`
(mesmo padrão de comparar-e-trocar já provado pra broker/membro, adaptado
pra chave de texto) + `setUazapiWebhookUrl` extraído como núcleo
reaproveitável (o Pai aponta pra uma URL fixa `/api/wpp-pai/inbound`, sem
`:instanceId` — a Fase 4 ainda não existe, então por enquanto essa URL dá
404, harmless). Rotas novas `GET/POST /api/admin/whatsapp-pai/status|
connect` + `POST .../disconnect`, todas `requireAdmin`. Aba nova "WhatsApp
Pai" no Painel Admin (`AdminWhatsappPai.tsx`, mesmo padrão de QR/código de
pareamento que `WhatsAppConnectCard` já usa pro corretor), com aviso
explícito de que conectar/desconectar vale pra **todos os tenants de uma
vez** — pedido específico do usuário nesta sessão ("quando um corretor
entrar na plataforma o whatsapp pai já deve estar cadastrado... super
admin deve ter a opção de colocar o whatsapp pai pra todos os tenants").

A instância temporária de teste da Fase 2 (pareada com o número pessoal
do usuário) foi migrada pra dentro dessa tabela nova em vez de
reprovisionar do zero — evita perder o pareamento já feito; troca pelo
número oficial mais tarde é só desconectar/conectar de novo na mesma
tela, sem mudar código nenhum.

Testado ao vivo: usuário não-admin recebe 403 no status; admin vê
`provisioned=true, connected=true` com dados reais (perfil, número) da
instância já pareada; UI checada de ponta a ponta injetando uma sessão
real de admin descartável no navegador — a aba renderiza exatamente o
status ao vivo. `tsc`/`knip`/`npm test` limpos (144/144).

**Fase 4 (pipeline de inbound + confirmação persistida) — concluída e
testada ao vivo, com 2 bugs reais achados e corrigidos no processo**:
`imf_pai_inbox` (fila durável, mesmo padrão SKIP LOCKED de
`claim_imf_webhook_inbox`, particionada por telefone — mensagens da mesma
pessoa nunca processam fora de ordem) + `imf_whatsapp_pending_actions`
(PK em `user_id`, 1 ação pendente por remetente de graça) +
`imf_agent_log` ganhou `channel`/`provider_message_id` (trava de
idempotência). `server/services/whatsappPaiQueue.ts` (novo): resolve
telefone→usuário via `imf_whatsapp_staff_links`, classifica confirmação
por palavra-chave determinística em PT-BR, chama `runAgent`/`executeAction`
(o mesmo cérebro do assistente do painel). `POST /api/wpp-pai/inbound`
(`server/routes/whatsappPai.ts`) — autentica pelo token da instância
central, sem lookup por instância (só existe uma).

Bugs achados testando ao vivo (não hipotéticos, achados rodando contra o
servidor real): (1) `runPaiInboxTick` não tinha a mesma trava
anti-sobreposição que `runWebhookInboxTick` já tem — duas mensagens
próximas no tempo disparavam ciclos concorrentes que colidiam entre si
("lease não pertence mais a este worker"); corrigido com o mesmo padrão
`*TickRunning` boolean. (2) `classifyReply` não tirava pontuação antes de
comparar — "sim, pode confirmar" virava `firstWord` "sim," (com vírgula),
não batia com "sim" da lista, e a pendência era abandonada em silêncio em
vez de confirmada; corrigido tirando pontuação final antes de comparar.

Testado ao vivo, servidor real, contas descartáveis, payload sintético no
formato exato da UAZAPI: telefone não vinculado → orientação, nada
tocado; comando mutante → proposta + pendência persistida; "não" →
cancela, nada criado; comando de novo + "sim" → imóvel REAL criado;
reenvio da mesma mensagem (mesmo id) → bloqueado pelo `dedupe_key`, sem
duplicar; log de conversa com `channel='whatsapp'`; membro sem
`carteira:criar` → negado explicitamente através do WhatsApp Pai (mesmo
gate da Fase 1, agora provado funcionando também por essa porta nova).
`tsc`/`knip`/`npm test` limpos (144/144).

**Fase 5 (mídia: voz + fotos de imóvel antes do texto) — concluída, com
uma ressalva de teste importante**: no intervalo entre a Fase 4 e esta, o
número de teste pessoal do usuário foi BANIDO pelo WhatsApp por spam —
efeito colateral direto do volume de mensagens automatizadas dos testes
anteriores num número recém-pareado. Confirmado contra `GET
/instance/status` (`connected:false`). A implementação seguiu normal; o
teste ao vivo com download real de mídia ficou bloqueado (exige instância
conectada de verdade) e a verificação foi adaptada — ver abaixo. Fica
registrado como risco real pra plataforma inteira, não só pro teste: todo
envio automatizado da ImobiFlow passa pela mesma UAZAPI não-oficial;
número novo + volume alto de mensagens automatizadas logo na entrada é
gatilho conhecido de banimento — merece conversa de produto separada.

`imf_whatsapp_staged_media` (nova, migration `20260807d`) guarda fotos
recebidas ANTES do texto descritivo chegar — WhatsApp entrega cada foto
numa mensagem separada, sem estado de sessão entre elas (diferente do
array em memória da `CommandBar.tsx` no painel). `handleIncomingPhoto`
(baixa da UAZAPI + sobe pro bucket via `uploadPropertyImageBase64`, nova,
extraída de `properties.ts` — SEM descrever a foto por IA, vira anexo
puro) e `handleIncomingAudio` (baixa + transcreve com
`transcribeWithOpenRouter`, mesma IA do pipeline do cliente) em
`whatsappPaiQueue.ts`. `fetchStagedPhotoUrls` alimenta `opts.imageUrls`
do `runAgent`, que `create_property` já sabia consumir desde que esse
parâmetro existe — zero mudança em `agent.ts`. Staging limpo
automaticamente após `create_property` confirmado, mais uma varredura por
TTL de 60min pro abandonado.

1 bug de TypeScript achado (mesma causa-raiz já documentada na Fase 2):
com `strictNullChecks` desligado neste `tsconfig.json`, `!resultado.ok`
não estreita união discriminada — corrigido lançando exceção em vez de
devolver `{ok,error}`.

Testado (adaptado à instância banida): fotos staged simuladas
diretamente no banco → comando de texto → ação pendente chega com
`image_urls` corretos (prova staging→`runAgent`→`create_property` de
ponta a ponta); "sim" → imóvel REAL criado com as fotos; staging limpo
depois; mensagem de foto sintética contra a instância desconectada →
falha tratada com graça (resposta amigável, linha termina `completed`,
não trava nem derruba o worker). O download bem-sucedido em si (função já
comprovada, reusada do pipeline do cliente) fica pendente de validação ao
vivo pra quando houver número pareado de novo. `tsc`/`knip`/`npm test`
(144/144) e `npm run build` limpos.

**Fase 6 (novas consultas: leads e relatório) — concluída e testada ao
vivo, beneficia painel e WhatsApp Pai ao mesmo tempo**: `query_leads`
(leads captados num período, filtro opcional pra só os sem atendimento) e
`query_report` (relatório de leads/visitas/vendas/locação do
mês/trimestre/semestre/ano), as duas determinísticas em código (mesmo
princípio de `query_agenda` — o modelo só decide QUANDO chamar e extrai o
parâmetro). Como vivem em `runAgent`/`executeAction`, o assistente do
painel ganha as duas perguntas junto, de graça. `buildRelatoriosSummary`
extraída de `GET /api/relatorios/summary` (resposta idêntica, rota virou
wrapper fino) e reaproveitada por `query_report`. Gate de permissão
(`negocios:visualizar`/`relatorios:visualizar`) igual ao das outras
ações desde a Fase 1.

Testado ao vivo, conta descartável com titular + 1 membro, dados reais
semeados: contagem de leads de hoje bate exato (exclui os de outros
dias), filtro "não atendidos" isola certo, relatório do mês reflete os
números semeados e bate com a rota HTTP `/api/relatorios/summary`
chamada via sessão real — confirma que a extração ficou byte-idêntica.
Membro sem as duas permissões (revogadas explicitamente) → negado nos
dois casos, mesma mensagem da Fase 1. `tsc`/`knip`/`npm test`
(144/144)/`build` limpos.

**Fase 7 (documentos como contexto temporário) — publicada em produção,
com migration aplicada e sem smoke real de PDF pelo provedor**: PDF, TXT, CSV, JSON,
Markdown e XML, até 8 MB. O arquivo bruto não é persistido; somente texto
extraído e metadados mínimos ficam em `imf_whatsapp_staged_documents`,
isolados por usuário/tenant, limitados a 3 documentos, consumidos pelo próximo
comando ou apagados em 60 minutos. O texto entra no agente dentro de
`UNTRUSTED_ACCOUNT_CONTEXT`, portanto instruções presentes no arquivo não são
comandos. PDF usa o parser `cloudflare-ai` do OpenRouter; Office deve ser
convertido em PDF. Migration: `20260807e_whatsapp_pai_staged_documents.sql`.

**Próximo aceite controlado**:

1. entrar em produção e confirmar que as 6 fotos aparecem no Assistente IA;
2. abrir Conversas e confirmar que `556299982218` não aparece em nenhuma aba;
3. enviar somente 1 PDF pequeno ao Pai e, em seguida, 1 comando que use o
   conteúdo; validar fila, resposta, consumo do contexto e ausência de envio
   duplicado;
4. manter UAZAPI como transporte atual e planejar a futura troca pela API
   oficial da Meta sem alterar o motor do WhatsApp Pai.

Hardening posterior ao pareamento: conexão administrativa agora reafirma o
webhook central antes de chamar a UAZAPI, falhando fechada se a origem pública
não estiver pronta. O guardião periódico também passou a cobrir
`imf_platform_instances(key='pai')`, além de brokers e membros. URLs locais ou
HTTP são recusadas. O túnel de validação foi encerrado e o webhook temporário
foi desativado porque não havia um segundo número disponível para o smoke.

**WhatsApp Pai: Fases 1-7 completas e publicadas.** O único smoke funcional
ainda pendente é o de documento; o aceite visual depende de sessão autenticada.

## Permissões granulares por membro da equipe — CONCLUÍDO, deployado (commit `200ed5b8e`, 2026-08-07)

Pedido do usuário: titular controla, por membro, o que cada um acessa —
grade módulo × ação (Visualizar/Criar/Editar/Excluir/Gerenciar), 6 perfis
prontos, acesso básico automático pra membro novo, histórico de
auditoria. Pedido original citava "Contas Agregadas"/"contas vinculadas";
investigação achou dois sistemas candidatos (Equipe, ativo, vs. Corretora
— agrupamento por CNPJ, achado praticamente morto: 3 rotas, zero RLS,
nenhum acesso a dado de negócio entre contas, nem aparece mais em `/app`).
Usuário confirmou focar só em Equipe nesta rodada. Detalhe completo em
PROGRESS.md/DOCUMENTACAO.md.

- Migration nova `20260806f_member_permissions.sql` (já aplicada pelo
  usuário): tabelas `imf_member_permissions` (normalizada, só guarda
  linha quando concedido) e `imf_permission_audit_log` (append-only) +
  RPCs `imf_set_member_permission`/`imf_replace_member_permissions`.
- `server/services/permissions.ts` (novo): motor espelhando
  `accountCapabilities.ts` — `hasPermission`, `resolveMemberPermissions`
  (cache 60s), `BASIC_ACCESS_DEFAULTS`, `BUILT_IN_PROFILES` (6 perfis
  fixos em código, não tabela — aplicar substitui a grade toda, nunca
  une).
- 5 endpoints novos em `equipe.ts`, hard-coded pro `isOwner()` local —
  NUNCA delegável via a própria grade (nem perfil "Administrador"): se
  desse pra delegar, um membro poderia se auto-conceder qualquer coisa.
- 8 arquivos de rota tiveram o gate `isBrokerOwner` trocado por
  `hasPermission`/checagem granular (equipe, locação, crmPipelines,
  financeiro, relatórios, brokers/asaas-key, lançamentos, conversas) —
  titular continua com acesso total idêntico a antes; membro existente
  sem nenhuma linha concedida fica bit-a-bit igual ao de antes (zero
  regressão, sem backfill).
- Seed de acesso básico em `POST /api/auth/join` (aceitar convite).
- `src/experience/PermissionsModal.tsx` (novo) + ícone na fileira de
  ações de `EquipeArea.tsx`.
- Testado ao vivo: 27 asserções via HTTP (dia-0 sem regressão nas 8
  rotas, conceder/revogar com efeito imediato sem esperar cache,
  combinação inválida rejeitada com 400, titular sem grade própria,
  membro nunca gerencia permissão nenhuma, aplicar perfil substitui a
  grade, auditoria registra e resolve nomes) + checagem visual na
  interface real (grade renderiza, toggle persiste, histórico mostra o
  registro certo). `tsc`/`knip`/`build` limpos; `npm test` só o CRLF
  conhecido (ajustada a guarda de regressão em
  `tests/accountCapabilities.test.ts`, que travava o texto-fonte antigo
  de locacao.ts).
- **Fora de escopo, registrado**: CRUD próprio em Leads/Imóveis/Agenda
  (hoje sem checagem nenhuma pro registro do próprio membro — vira
  revogável numa rodada futura); perfis customizados; enforcement em
  Contatos; sistema Corretora.

## Fix: exclusão de conta (admin) falhava com FK ambígua — CONCLUÍDO, deployado (commit `2fdfb8ab8`, 2026-08-07)

Usuário tentou excluir uma conta no painel admin e bateu em `update or
delete on table "imf_brokers" violates foreign key constraint
"properties_broker_id_fkey"`. Causa: `DELETE /api/admin/brokers/:id`
(`server/routes/admin.ts`) só fazia `DELETE FROM imf_brokers`, confiando
num comentário que dizia que o CASCADE limpava tudo — não limpa. Mapeado
o grafo completo de FKs do schema public: 8 tabelas do ImobiFlow têm
`broker_id -> imf_brokers` SEM `ON DELETE CASCADE` (`imf_broker_goals`,
`imf_conversation_messages`, `imf_developments`, `imf_properties`,
`imf_rental_contracts`, `imf_reservation_documents`,
`imf_unit_reservations`, `leads`), mais `imf_rental_payment_receipts` que
trava contrato via `RESTRICT`. Achado à parte: `imf_agenda.broker_id` não
tem FK NENHUMA pra `imf_brokers` — não bloqueava a exclusão, mas os
eventos ficariam órfãos pra sempre, sem erro nenhum.

Migration `20260806e_admin_delete_broker_cascade.sql` (já aplicada pelo
usuário): função transacional `admin_delete_broker_cascade(p_broker_id)`
que apaga as tabelas sem CASCADE na ordem certa (recibos antes do
contrato, documentos antes da reserva — achado ao vivo numa primeira
versão que tinha essa ordem trocada) antes do `DELETE FROM imf_brokers`
final. `admin.ts` passou a chamar essa RPC em vez do delete direto.
Testado ao vivo com conta descartável populada em todas as 10 tabelas
(incluindo `imf_rental_payments`/`imf_units` como dependências) — exclusão
100% limpa, zero linha órfã, confirmado em cada tabela. Escopo só
ImobiFlow (`imf_`/núcleo) — nenhuma tabela de outro projeto do banco
compartilhado é tocada. Detalhe completo em PROGRESS.md/DOCUMENTACAO.md.

## Fix: CRM (Negócios) inteiro fora do ar — ROLLOUT CONCLUÍDO (06/08/2026)

`GET /api/crm/pipelines` devolvia 500 pra QUALQUER conta (não só
convidado) por um bug de coluna ambígua na RPC `imf_crm_ensure_default_
pipeline` — bug antigo, de sessão anterior a esta, cuja migration de
correção (`20260721d`) nunca tinha sido aplicada, e mesmo depois de
aplicada sobrou um segundo ponto ambíguo (`ON CONFLICT`) que aquela
correção não cobria. Migration `20260806d_fix_crm_ensure_default_
pipeline_on_conflict_ambiguous.sql` aplicada e testada ao vivo. Commit
`95fd8eaf`, deploy validado. Detalhe completo em PROGRESS.md.

## Segurança: convidado com acesso indevido a Equipe/Desempenho/Locação — ROLLOUT CONCLUÍDO (05/08/2026)

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
Commit `f33ac7f` (Equipe/Desempenho/Locação) + `1599b08` (Financeiro),
deploy validado (health-check 200).

## Follow-Up Inteligente: de 3 passos fixos pra até 8 — ROLLOUT CONCLUÍDO (06/08/2026)

Commit `55dd902`, deploy validado (health-check 200). Detalhe completo em
PROGRESS.md/DOCUMENTACAO.md.

## Follow-Up Inteligente: botão "-" + cancelamento imediato com humano — ROLLOUT CONCLUÍDO (06/08/2026)

Duas mudanças pequenas, mesmo dia, no seguimento direto da rodada acima:

1. **Botão "-"**: usuário testou o "+" até 8 e não tinha como voltar.
   `AssistenteIAArea.tsx` ganhou um par "-"/"+" (em vez de só "+"),
   `follow_count` sobe/desce de 1 a 8. Nenhuma mudança de backend/migration
   — `follow_count` já aceitava 1-8 desde a rodada anterior.
2. **Cancelamento imediato quando humano assume**: usuário pediu revisão
   explícita da regra — follow-up só roda com IA ativa; humano assume/
   responde → cancela na hora; IA desligada → nunca dispara. Auditoria
   confirmou regras 1 e 3 já garantidas pela RPC (`ai_active=TRUE`,
   `cfg.enabled=TRUE`). Achou 2 lacunas na regra 2: `PATCH /api/conversas/
   :ticketId/ai-toggle` e `POST /api/conversas/create` desligavam
   `ai_active` mas não travavam `follow_sent=true` (diferente de
   `pauseAiForHumanTakeover`, que já fazia os dois) — sem isso, religar a
   IA sem o cliente ter mandado mensagem nova podia disparar um follow-up
   com timing de antes da pausa. Corrigido nos 2 endpoints.

Testado ao vivo (sessão real + ticket de teste no banco): "-" desce até 1
e sobe de volta, persistência confirmada com F5; cenário de religar IA sem
resposta nova do cliente → RPC não claimou (confirma o fix). `tsc`/`knip`/
`build`/`npm test` limpos. Nenhuma outra parte do fluxo mexida, como
pedido. Commit `95fd8eaf`, deploy validado. Detalhe completo em
PROGRESS.md/DOCUMENTACAO.md.

## Aba "Desempenho" (ROI da equipe, sem custo cadastrado) — ROLLOUT CONCLUÍDO (05/08/2026)

Commit `967a289`, deploy validado. Detalhe completo em PROGRESS.md.

1. `GET /api/equipe/performance?months=` (novo, `equipe.ts`, titular-only) —
   por corretor: leads recebidos, fechados, conversão, vendido, retorno por
   lead. Reaproveita `collectPages`/`collectForIds`/`reportPeriod`,
   exportados de `relatorios.ts` pra não duplicar paginação.
2. Aba nova "Desempenho" no menu lateral (`engine.ts` + `ManualRail.tsx`,
   ícone `TrendingUp`), mesma capability `team` de Equipe.
3. `src/experience/DesempenhoArea.tsx` (novo): lista os corretores
   ordenados por venda, clique abre o drill-down por membro em Relatórios
   já construído na rodada anterior (`onOpenMemberReport`).

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
