# Decisões vigentes

## Projeto e entrega

- **V2 é o único produto ativo.** Branch `v2` e app Fly `imobiflow-v2`; V1/main
  permanece congelada como rollback.
- **Checkout canônico único.** Claude e Codex trabalham somente em
  `work/imob.criate-phase3`; `C:\Users\Criate\imob.criate` está congelado.
- **PMP v2.0.** `PROJECT.md`, `ARCHITECTURE.md`, `PROGRESS.md`, `DECISIONS.md` e
  `NEXT_TASK.md` formam a memória curta; `DOCUMENTACAO.md` mantém o detalhe.
- **Deploy automático.** Push em `v2` valida com `npm ci`, TypeScript, Knip e
  build antes de publicar. Não há gate manual posterior ao push.
- **Migrations manuais.** O usuário sempre executa SQL no Supabase; deploy não
  aplica banco.

## Segurança e dados

- **Tenant resolvido no backend.** `service_role` nunca confia em `broker_id`
  recebido do cliente.
- **CRM transacional.** RPCs `SECURITY DEFINER` são exclusivas da
  `service_role`; reorder, troca de padrão, autocura e transições são atômicos.
  A migration `20260720b_crm_security_hardening.sql` já foi aplicada e
  verificada.
- **Exclusão segura.** Leads não usam CASCADE com pipeline/etapa; pipelines e
  etapas usam CASCADE apenas ao excluir o broker inteiro.
- **Compatibilidade CRM.** Pipeline/etapa são fonte de verdade; trigger mantém
  `leads.status`/`closed_at` para relatórios e integrações legadas.

## Produto e experiência

- **CRM configurável.** As cinco colunas fixas foram substituídas por pipelines
  por broker; membros não administram a estrutura.
- **DnD mobile.** Kanban usa `@dnd-kit/core`, não HTML5 DnD nativo.
- **Upload mobile.** O padrão é input de arquivo transparente diretamente
  clicável; não usar `.click()` programático nem `display:none`.
- **Escopo financeiro.** O produto registra/exibe valores, mas não cobra
  aluguel, reserva ou pagamentos de clientes. Asaas serve à assinatura SaaS.

## WhatsApp e IA

- **Inbox/outbox antes de escalar máquinas (2026-07-21).** A UAZAPI só recebe
  ACK depois da persistência em `imf_webhook_inbox`; processamento e despacho
  ao N8N usam claims recuperáveis e `imf_webhook_outbox`. PostgreSQL é a fonte
  durável nesta primeira etapa, evitando introduzir Redis/BullMQ antes de
  existir medição de carga. A entrega ao N8N é at-least-once, com `event_id`
  estável para deduplicação do workflow.

- **UAZAPI direta.** Z-PRO está removido da V2; a reconexão reafirma o webhook.
- **Mídia convertida no backend.** PTT e imagem privados viram texto antes do
  N8N; base64 não é persistido; falhas geram fallback e mensagens duplicadas são
  rejeitadas por `provider_message_id`.
- **Prompt em duas camadas.** `PROMPT-AGENTE-WHATSAPP.md` contém regras-base
  protegidas; `broker_agents.system_prompt` contém preferências complementares.
  Personalização não pode reduzir privacidade, veracidade ou segurança de tools.
- **Transparência.** O agente fala de modo humano e conciso, mas não afirma ser
  uma pessoa real quando perguntado.
- **Nome público único.** O N8N deve usar `imf_brokers.ai_name`, configurado na
  interface; `broker_agents.agent_name` é fallback legado e `Juliana` é o
  fallback final.
- **Assistente interno sem metacomentário.** Mensagens que o assistente
  interno do app (`server/services/agent.ts`, ação `send_message` — distinto
  do agente externo do WhatsApp acima) escreve para o CLIENTE nunca podem
  narrar a própria ação (proibido "estou fazendo um follow-up...", "isto é um
  lembrete automático..."); regra explícita + exemplo no prompt, validada com
  chamada real ao modelo.
- **Ações agendadas do assistente interno (2026-07-21).**
  `create_reminder` (lembrete) e `schedule_followup` (envio futuro real)
  resolvidas de duas formas diferentes por natureza: lembrete reaproveita a
  Agenda existente (nenhuma tabela nova — não existe hoje nenhum sistema de
  notificação/sino no app); follow-up agendado precisa de execução autônoma
  de verdade, então usa tabela nova (`imf_agent_scheduled_followups`) + job
  de 60s. Prazo relativo ("24h", "2 dias") nunca é calculado pelo modelo —
  só número+unidade, o resto é determinístico em código (mesmo princípio de
  `query_agenda`). O texto da mensagem agendada é composto no momento do
  PEDIDO, não regenerado na hora do envio — o corretor revisa o texto exato
  antes de confirmar (copiloto/manual), igual a `notify_message`. O envio
  agendado grava `sender_type='ai'` e não pausa o atendimento da IA depois
  (trata como automático, não como intervenção manual do corretor — ao
  contrário de `send_message`, que pausa).
