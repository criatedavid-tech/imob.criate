import "./server/lib/infra";
import { closeInfra } from "./server/lib/infra";
import { createRecurringJobRunner, type RecurringJob } from "./server/lib/recurringJobs";
import { prepareOverageBilling, reconcilePendingBillingActions } from "./server/services/billing";
import { runFollowupTick } from "./server/services/followup";
import { runScheduledAgentFollowupsTick } from "./server/services/agentScheduledFollowups";
import { runReminderWhatsappAlertTick } from "./server/services/reminderAlerts";
import { runVisitWhatsappAlertTick } from "./server/services/visitAlerts";
import { expireDueUnitReservations } from "./server/services/unitReservationBilling";
import { purgeExpiredWebhookLogs } from "./server/services/maintenance";
import { runWebhookKeeperTick } from "./server/services/webhookKeeper";

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
    // Reafirma o webhook UAZAPI das instâncias — impede o inbound de "cair" e
    // exigir reconexão manual quando a UAZAPI perde a config do webhook.
    name: "guardião de webhook",
    intervalMs: 3 * 60 * 1_000,
    runOnStart: true,
    task: runWebhookKeeperTick,
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
