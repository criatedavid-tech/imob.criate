# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; último commit publicado: `e2b4bfe` (branch local sincronizada
  com `origin/v2` até este commit).
- **Working tree NÃO está limpo** (sessão de 2026-07-21): duas ações novas do
  Assistente IA interno implementadas e validadas localmente, mas ainda sem
  commit — ver "Pacote local pendente de autorização" abaixo. Antes de
  qualquer novo trabalho nesta branch, decidir o destino desse pacote (commit
  ou descarte) em vez de simplesmente sobrescrever.
- Produção atual (deploy do commit `e2b4bfe`) contém o inbound multimodal, o
  alinhamento de `imf_brokers.ai_name` com o contrato `agent_name` do N8N, e o
  fix do assistente interno (para de narrar a própria ação em
  `send_message`) — as duas ações novas NÃO estão em produção.
- Smoke `/`, `/login`, `/app` HTTP 200 em 2026-07-21 (antes desta sessão).
- N8N ainda usa o prompt anterior. A instância `https://212n8n.criate.online`
  abriu na tela de login e requer sessão autenticada com acesso de edição.

## Pacote local pendente de autorização (2026-07-21)

`server/services/agent.ts` ganhou duas ações novas — `create_reminder`
(lembrete em `imf_agenda`, sem enviar nada) e `schedule_followup` (agenda
envio real de WhatsApp via tabela nova `imf_agent_scheduled_followups` + job
de 60s em `server/services/agentScheduledFollowups.ts`). Migration
`supabase/migrations/20260721_agent_scheduled_followups.sql` **aplicada e
verificada em 21/07/2026** (tabela, RLS e policy confirmados `true` na
consulta pós-migration). `npx tsc --noEmit`, `npx knip`, `npm run build` e
`git diff --check` aprovados; nenhum QA ao vivo ainda. Falta só: autorizar
commit/push (o push já dispara deploy automático) — ver detalhe completo em
PROGRESS.md/DECISIONS.md e na seção "Ações agendadas do Assistente IA
interno" do DOCUMENTACAO.md.

## Objetivo imediato

Duas frentes pendentes, sem ordem obrigatória entre si:

1. Revisar e autorizar (ou pedir ajuste no) o pacote local acima.
2. Instalar o novo prompt padrão no N8N e concluir o QA de nome,
   personalização, agenda e mídia sem alterar V1, nomes das tools ou contrato
   textual entre backend e N8N (sequência já represada de sessões
   anteriores, abaixo).

## Sequência (item 2 acima)

1. Entrar em `https://212n8n.criate.online` com uma conta que possa editar o
   workflow de produção do atendimento WhatsApp.
2. No N8N, substituir manualmente o prompt principal pelo conteúdo integral de
   `PROMPT-AGENTE-WHATSAPP.md`; manter os nomes das tools:
   `[verificacao]`, `[agendamento]`, `[atualizar agendamento]` e
   `[deletar agendamento]`.
3. Salvar/ativar o workflow e confirmar que nenhuma conexão ou configuração das
   quatro tools de agenda foi alterada.
4. Alterar o nome na tela Assistente IA e confirmar que o endpoint interno
   retorna esse valor em `agent_name`.
5. Configurar uma instrução personalizada simples e iniciar conversa nova.
   Confirmar: 1–3 frases, uma pergunta por vez, sem repetir dados já informados,
   nome correto e regras de agenda preservadas.
6. Testar PTT e imagem novos em conversa privada; verificar transcrição/descrição
   no painel, resposta coerente e ausência de duplicação ou base64 nos logs.
7. Repetir com IA desativada/human takeover e concluir QA titular versus membro
   do CRM.

## Critério de conclusão

- Nome e instruções do corretor chegam ao agente sem substituir regras-base.
- Texto, áudio e imagem recebem resposta coerente e concisa.
- Agenda só confirma ações após sucesso real das tools.
- Sem regressão multi-tenant, duplicação, vazamento de mídia ou alteração da V1.
- Working tree limpo, commit/push/deploy registrados nos documentos oficiais.
