# Próxima tarefa

**Objetivo:** executar o QA real pós-publicação do inbound multimodal do
WhatsApp e concluir o QA autenticado do hardening do CRM.

**Estado entregue neste pacote:**

1. Payloads reais confirmados em `webhook_logs`: áudio e imagem chegam como
   `type=media`, com `mediaType=ptt|image`.
2. Download real confirmado em `POST /message/download`: áudio MP3 e imagem
   JPEG retornaram em base64; nenhuma mídia/token foi persistida no checkout.
3. Backend implementado sem migration e sem mudança no N8N: download UAZAPI,
   transcrição/visão OpenRouter, persistência textual e fallback.
4. Teste local com dependências simuladas cobre áudio, imagem e falha; tsc,
   Knip, build e `git diff --check` passaram.

**Próximo após o deploy:**

1. Em conversa privada com a instância usada no teste, enviar um PTT curto
   contendo uma pergunta clara sobre imóvel.
2. Confirmar no painel que aparece `[Áudio]` com a transcrição e que a IA
   responde à pergunta — não apenas confirma o recebimento.
3. Enviar um print de anúncio de imóvel, preferencialmente com preço e texto.
4. Confirmar no painel que aparece `[Imagem]` com descrição coerente e que a
   IA conduz o atendimento usando a informação visível.
5. Verificar `webhook_logs`, `imf_conversation_messages` e logs do Fly sem
   base64/tokens e sem duplicação pelo mesmo `provider_message_id`.
6. Repetir com IA desativada/atendimento humano para confirmar que as regras
   existentes do ticket continuam valendo.
7. Retomar o QA do CRM: titular versus membro, reorder, troca de padrão,
   arquivamento/reatribuição e tentativa de mover lead para etapa inativa.

**Fora deste escopo:** vídeo, documento e sticker; mudança do workflow N8N;
qualquer migration; V1 (`main`/app Fly `imobiflow`).

**Critério de conclusão:** áudio e imagem geram registro e resposta coerente
em produção, sem regressão do texto, sem duplicação e sem vazamento de mídia.
