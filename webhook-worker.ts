import { closeInfra } from "./server/lib/infra";
import {
  runWebhookInboxTick,
  runWebhookOutboxTick,
} from "./server/services/inboundWebhookQueue";
import { runPaiInboxTick } from "./server/services/whatsappPaiQueue";

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const POLL_MS = envInteger("WEBHOOK_WORKER_POLL_MS", 1_000, 100, 60_000);
const SHUTDOWN_TIMEOUT_MS = 25_000;

let stopping = false;
let timer: NodeJS.Timeout | null = null;

// Inbox e outbox rodam em ciclos INDEPENDENTES. Antes era um Promise.all: o
// próximo ciclo só começava quando os dois terminassem, então uma
// indisponibilidade do n8n (downstream) prendia a gravação das mensagens
// (upstream) — cada lote da outbox gastava o timeout inteiro e a inbox ficava
// limitada a um lote por timeout. Uma fila não pode depender da outra.
const cycles: Record<"inbox" | "outbox" | "pai", Promise<void> | null> = { inbox: null, outbox: null, pai: null };

function startCycle(name: "inbox" | "outbox" | "pai", run: () => Promise<void>): void {
  if (stopping || cycles[name]) return;
  cycles[name] = run()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Webhook Worker] ciclo ${name} falhou:`, message);
    })
    .finally(() => {
      cycles[name] = null;
    });
}

function startQueueCycle(): void {
  startCycle("inbox", runWebhookInboxTick);
  startCycle("outbox", runWebhookOutboxTick);
  startCycle("pai", runPaiInboxTick);
}

function activeCycles(): Promise<void>[] {
  return [cycles.inbox, cycles.outbox, cycles.pai].filter(Boolean) as Promise<void>[];
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`[Webhook Worker] ${signal} recebido; aguardando ciclo ativo.`);

  const running = activeCycles();
  let timeout: NodeJS.Timeout | undefined;
  const drained = running.length
    ? await Promise.race([
        Promise.all(running).then(() => true),
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
console.log(`[Webhook Worker] inbox/outbox/pai ativas (poll ${POLL_MS}ms).`);
