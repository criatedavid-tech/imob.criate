import * as Sentry from "@sentry/node";
import Redis from "ioredis";
import { SENTRY_DSN, REDIS_URL } from "../config";

// ─── SENTRY (opcional — error tracking) ──────────────────────────────────────
if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });
  process.on('unhandledRejection', (reason) => Sentry.captureException(reason));
  console.log('[Sentry] inicializado');
}

// ─── REDIS (opcional — rate limiting distribuído multi-máquina) ───────────────
// Sem REDIS_URL, os limiters caem para store em memória por VM (comportamento atual).
// Para ativar: fly redis create --app imobiflow && fly secrets set REDIS_URL=...
let redisClient: Redis | null = null;
if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL);
  redisClient.on('connect', () => console.log('[Redis] conectado'));
  redisClient.on('error',  (e: Error) => console.error('[Redis] erro:', e.message));
}

export function makeRedisStore(prefix: string, windowMs: number) {
  if (!redisClient) return undefined;
  return {
    async increment(key: string) {
      const k = `rl:${prefix}:${key}`;
      const results = await redisClient!.multi().incr(k).pexpire(k, windowMs).exec();
      return { totalHits: (results?.[0]?.[1] as number) ?? 1, resetTime: new Date(Date.now() + windowMs) };
    },
    async decrement(key: string) { await redisClient!.decr(`rl:${prefix}:${key}`); },
    async resetKey(key: string)  { await redisClient!.del(`rl:${prefix}:${key}`); },
  };
}

export async function closeInfra(): Promise<void> {
  const client = redisClient;
  redisClient = null;

  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }

  if (SENTRY_DSN) await Sentry.close(2_000);
}
