import "./server/lib/infra";
import { closeInfra } from "./server/lib/infra";
import { createRecurringJobRunner, type RecurringJob } from "./server/lib/recurringJobs";
import { prepareOverageBilling, reconcilePendingBillingActions } from "./server/services/billing";
import { runFollowupTick } from "./server/services/followup";
import { runScheduledAgentFollowupsTick } from "./server/services/agentScheduledFollowups";
import { runReminderWhatsappAlertTick } from "./server/services/reminderAlerts";
import { runVisitWhatsappAlertTick } from "./server/services/visitAlerts";
import { expireDueUnitReservations } from "./server/services/unitReservationBilling";
import { purgeExpiredWebhookLogs, purgeResolvedQueueRows, expirePaiPendingActions, expireStagedWhatsappMedia } from "./server/services/maintenance";
import { runWebhookKeeperTick } from "./server/services/webhookKeeper";
import { runInboundMediaBackfillTick } from "./server/services/inboundMediaBackfill";
import {
  runRentalChargeGenerationTick,
  runRentalDunningTick,
  runKeyOverdueAlertTick,
} from "./server/services/rentalAutopilot";

const jobs: RecurringJob[] = [
  {
    name: "follow-up inteligente",
    intervalMs: 60_000,
    task: runFollowupTick,
  },
  {
    name: "follow-up agendado do assistente",
    intervalMs: 60_000,
    runOnStart: true,
    task: runScheduledAgentFollowupsTick,
  },
  {
    name: "alerta de lembrete",
    intervalMs: 60_000,
    runOnStart: true,
    task: runReminderWhatsappAlertTick,
  },
  {
    name: "alerta de visita",
    intervalMs: 60_000,
    runOnStart: true,
    task: runVisitWhatsappAlertTick,
  },
  {
    name: "preparação de billing",
    intervalMs: 60 * 60 * 1_000,
    runOnStart: true,
    task: prepareOverageBilling,
  },
  {
    name: "reconciliação de billing",
    intervalMs: 5 * 60 * 1_000,
    runOnStart: true,
    task: reconcilePendingBillingActions,
  },
  {
    name: "expiração de reserva PIX",
    intervalMs: 60_000,
    runOnStart: true,
    task: expireDueUnitReservations,
  },
  {
    name: "retenção de webhook logs",
    intervalMs: 24 * 60 * 60 * 1_000,
    runOnStart: true,
    task: purgeExpiredWebhookLogs,
  },
  {
    // Gera a cobrança do aluguel do mês (D-5 do vencimento). Determinístico,
    // sem IA, e idempotente por contrato+mês.
    name: "cobrança de aluguel (geração)",
    intervalMs: 60 * 60 * 1_000,
    runOnStart: true,
    task: runRentalChargeGenerationTick,
  },
  {
    // Régua de cobrança no WhatsApp do inquilino (D-5 até D+15). Respeita
    // promessa de pagamento e horário de silêncio.
    name: "cobrança de aluguel (régua)",
    intervalMs: 30 * 60 * 1_000,
    runOnStart: false,
    task: runRentalDunningTick,
  },
  {
    // Chave que passou do prazo de devolução: avisa o corretor.
    name: "alerta de chave em atraso",
    intervalMs: 15 * 60 * 1_000,
    runOnStart: true,
    task: runKeyOverdueAlertTick,
  },
  {
    // Filas: linhas já resolvidas viram peso morto. Sem retenção, os índices
    // UNIQUE de dedupe (que cobrem todo o histórico) crescem para sempre e
    // cada INSERT de ingestão sonda um btree cada vez maior — a latência
    // degrada de forma permanente, mesmo com a fila vazia.
    name: "retenção das filas de webhook",
    intervalMs: 6 * 60 * 60 * 1_000,
    runOnStart: true,
    task: purgeResolvedQueueRows,
  },
  {
    // Reafirma o webhook UAZAPI das instâncias — impede o inbound de "cair" e
    // exigir reconexão manual quando a UAZAPI perde a config do webhook.
    name: "guardião de webhook",
    intervalMs: 3 * 60 * 1_000,
    runOnStart: true,
    task: runWebhookKeeperTick,
  },
  {
    // Uma ação proposta pelo WhatsApp Pai que nunca foi confirmada nem
    // cancelada não pode ficar presa pra sempre — expira em 15min (ver
    // PENDING_ACTION_TTL_MS em whatsappPaiQueue.ts).
    name: "expiração de ação pendente do WhatsApp Pai",
    intervalMs: 60_000,
    runOnStart: true,
    task: expirePaiPendingActions,
  },
  {
    // Fotos enviadas ao WhatsApp Pai e nunca aproveitadas num cadastro
    // (usuário abandonou) — rede de segurança, TTL de 60min (ver
    // STAGED_MEDIA_TTL_MS em maintenance.ts).
    name: "expiração de staging de mídia do WhatsApp Pai",
    intervalMs: 5 * 60_000,
    runOnStart: true,
    task: expireStagedWhatsappMedia,
  },
  {
    // Torna tocáveis os áudios/imagens recebidos que ficaram só como transcrição
    // (recebidos antes do fix, ou que falharam no upload ao vivo): re-baixa da
    // UAZAPI e preenche o media_url. Idempotente e best-effort.
    name: "backfill de mídia recebida",
    intervalMs: 30 * 60 * 1_000,
    runOnStart: true,
    task: runInboundMediaBackfillTick,
  },
];

const runner = createRecurringJobRunner(jobs);
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Scheduler] ${signal} recebido; aguardando jobs ativos.`);
  const drained = await runner.stop();
  if (!drained) {
    console.warn(`[Scheduler] encerrando com jobs ativos: ${runner.activeJobNames().join(", ")}`);
  }
  await closeInfra();
  if (!drained) process.exitCode = 1;
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

runner.start();
console.log(`[Scheduler] ${jobs.length} jobs recorrentes ativos.`);
