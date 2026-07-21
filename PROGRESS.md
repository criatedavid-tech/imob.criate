# Estado do projeto

## Concluído e publicado

- CRM substituiu Leads: Kanban + gerenciamento de pipelines/etapas por broker;
  compatibilidade com `leads.status` preservada. Releases iniciais v94/v95.
- Drag-and-drop migrado para `@dnd-kit/core` e confirmado em Android/iPhone.
- Hardening do CRM aplicado e verificado: RPCs transacionais restritas à
  `service_role`, reorder validado, etapa/pipeline inativo bloqueado, UI de
  membro somente leitura e exclusão integral do broker com CASCADE correto.
- Operações financeiras dos clientes desativadas; locação/financeiro exibem
  apenas registros e valores. Asaas continua apenas para assinatura SaaS.
- Correções mobile confirmadas: áudio iOS, seletor de fotos Android e aviso para
  WebView sem suporte.
- Webhook UAZAPI ganhou self-heal ao reconectar instâncias legadas.
- Inbound privado de PTT e imagem implementado: download UAZAPI, transcrição ou
  visão OpenRouter, persistência textual, deduplicação e fallback. Publicado no
  commit `5d096ef`; GitHub Actions run `29781792572` aprovado; `/`, `/login` e
  `/app` retornaram HTTP 200.
- Assistente interno (`server/services/agent.ts`, ação `send_message`) para de
  narrar a própria ação em mensagens ao cliente ("estou fazendo um
  follow-up..."). Regra explícita + exemplo no prompt; validado com chamada
  real ao modelo em `autonomy=manual` (ação só proposta, nunca enviada).
  Publicado no commit `c372ccc`; smoke `/`, `/login`, `/app` HTTP 200.

## Pacote publicado nesta sessão

- Novo `PROMPT-AGENTE-WHATSAPP.md`: respostas de 1–3 frases, uma pergunta por
  vez, linguagem natural e transparente, catálogo tratado como dado, agenda
  protegida e personalização subordinada às regras do produto.
- `GET /api/brokers/:id/agent` passa a priorizar `imf_brokers.ai_name`, definido
  na tela Assistente IA, com fallback para `broker_agents.agent_name` e
  `Juliana`.
- `ai_name` é validado como texto, normalizado e limitado a 60 caracteres.
- `DOCUMENTACAO.md` e os arquivos PMP foram atualizados.
- Validações locais aprovadas: `npm run lint`, `npx knip`, `npm run build` e
  `git diff --check`.
- Nenhuma migration criada. Pacote publicado no commit `069db64`; GitHub
  Actions run `29832355248` aprovado; `/`, `/login` e `/app` retornaram HTTP
  200. O N8N não foi alterado porque a instância exige uma sessão autenticada.

## Pendências de QA

- Instalar manualmente o novo prompt no N8N e testar nome/instruções do corretor.
- Testar PTT e imagem novos em conversa privada após o deploy já publicado.
- Confirmar isolamento titular/membro e operações críticas do CRM em produção.
- Validar IA desativada/human takeover e ausência de duplicação/vazamento nos
  logs.

## Limitações conhecidas

- A instância N8N exige sessão autenticada com acesso de edição; instalação do
  prompt permanece manual.
- Vídeo, documento, sticker e mídia de grupos não são processados pelo agente.
- `flyctl` local bloqueado; deploy ocorre pelo GitHub Actions.
- Testes físicos mobile dependem do usuário.
