# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; último commit funcional publicado: `069db64`.
- Produção atual contém o inbound multimodal e o alinhamento de
  `imf_brokers.ai_name` com o contrato `agent_name` do N8N.
- Branch local/remota sincronizadas e working tree limpo após o registro
  documental da publicação.
- Nenhuma migration pendente deste pacote.
- GitHub Actions run `29832355248` aprovado; `/`, `/login` e `/app` retornaram
  HTTP 200.
- N8N ainda usa o prompt anterior. A instância `https://212n8n.criate.online`
  abriu na tela de login e requer sessão autenticada com acesso de edição.

## Objetivo imediato

Instalar o novo prompt padrão no N8N e concluir o QA de nome, personalização,
agenda e mídia sem alterar V1, nomes das tools ou contrato textual entre backend
e N8N.

## Sequência

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
