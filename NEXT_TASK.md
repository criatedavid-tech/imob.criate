# Próxima tarefa

## Ponto exato de retomada

- Checkout: `C:\Users\Criate\Documents\Codex\2026-07-13\project-imobiflow-produto-visao-md\work\imob.criate-phase3`.
- Branch: `v2`; base local/remota antes deste pacote: commit `5d096ef`.
- Produção atual contém o inbound multimodal desse commit.
- Há alterações locais intencionais e não publicadas. Preservar todas:
  `PROMPT-AGENTE-WHATSAPP.md`, `server/routes/brokers.ts`, `DOCUMENTACAO.md` e
  os cinco arquivos PMP.
- Nenhuma migration pendente deste pacote.
- N8N ainda usa o prompt anterior.

## Objetivo imediato

Publicar o alinhamento do nome do agente e instalar o novo prompt padrão sem
alterar V1, tools de agenda ou contrato textual entre backend e N8N.

## Sequência

1. Rodar `git status`, `git diff` e conferir que o pacote contém apenas prompt,
   endpoint de nome e documentação.
2. Confirmar `npm run lint`, `npx knip`, `npm run build` e `git diff --check`.
3. Com autorização do usuário, commitar e executar `git push origin v2`; o push
   dispara deploy automático. Não executar SQL.
4. Confirmar GitHub Actions e smoke de `/`, `/login` e `/app`.
5. No N8N, substituir manualmente o prompt principal pelo conteúdo integral de
   `PROMPT-AGENTE-WHATSAPP.md`; manter os nomes das tools:
   `[verificacao]`, `[agendamento]`, `[atualizar agendamento]` e
   `[deletar agendamento]`.
6. Alterar o nome na tela Assistente IA e confirmar que o endpoint interno
   retorna esse valor em `agent_name`.
7. Configurar uma instrução personalizada simples e iniciar conversa nova.
   Confirmar: 1–3 frases, uma pergunta por vez, sem repetir dados já informados,
   nome correto e regras de agenda preservadas.
8. Testar PTT e imagem novos em conversa privada; verificar transcrição/descrição
   no painel, resposta coerente e ausência de duplicação ou base64 nos logs.
9. Repetir com IA desativada/human takeover e concluir QA titular versus membro
   do CRM.

## Critério de conclusão

- Nome e instruções do corretor chegam ao agente sem substituir regras-base.
- Texto, áudio e imagem recebem resposta coerente e concisa.
- Agenda só confirma ações após sucesso real das tools.
- Sem regressão multi-tenant, duplicação, vazamento de mídia ou alteração da V1.
- Working tree limpo, commit/push/deploy registrados nos documentos oficiais.
