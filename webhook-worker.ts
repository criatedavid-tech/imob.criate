import { closeInfra } from "./server/lib/infra";
import {
  runWebhookInboxTick,
  runWebhookOutboxTick,
} from "./server/services/inboundWebhookQueue";

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const POLL_MS = envInteger("WEBHOOK_WORKER_POLL_MS", 1_000, 100, 60_000);
const SHUTDOWN_TIMEOUT_MS = 25_000;

let stopping = false;
let timer: NodeJS.Timeout | null = null;
let activeCycle: Promise<void> | null = null;

async function processQueueCycle(): Promise<void> {
  await Promise.all([runWebhookInboxTick(), runWebhookOutboxTick()]);
}

function startQueueCycle(): void {
  if (stopping || activeCycle) return;

  activeCycle = processQueueCycle()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Webhook Worker] ciclo falhou:", message);
    })
    .finally(() => {
      activeCycle = null;
    });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`[Webhook Worker] ${signal} recebido; aguardando ciclo ativo.`);

  const cycle = activeCycle;
  let timeout: NodeJS.Timeout | undefined;
  const drained = cycle
    ? await Promise.race([
        cycle.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS);
          timeout.unref();
        }),
      ])
    : true;
  if (timeout) clearTimeout(timeout);

  if (!drained) {
    console.warn("[Webhook Worker] encerrando com ciclo ainda ativo; o lease permitira retry.");
  }

  await closeInfra();
  if (!drained) process.exit(1);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

timer = setInterval(startQueueCycle, POLL_MS);
startQueueCycle();
console.log(`[Webhook Worker] inbox/outbox ativas (poll ${POLL_MS}ms).`);
