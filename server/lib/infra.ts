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
  // Opções explícitas: no default do ioredis, uma queda do Redis enfileira os
  // comandos em memória sem teto e as requisições ficam penduradas até 20
  // tentativas. Com enableOfflineQueue:false + timeouts curtos, o comando
  // falha rápido e o wrapper abaixo deixa a requisição passar.
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    lazyConnect: false,
  });
  redisClient.on('connect', () => console.log('[Redis] conectado'));
  redisClient.on('error',  (e: Error) => console.error('[Redis] erro:', e.message));
}

export function makeRedisStore(prefix: string, windowMs: number) {
  if (!redisClient) return undefined;
  // FAIL-OPEN: no express-rate-limit, uma exceção no store vira 500 na rota.
  // Sem este try/catch, uma indisponibilidade do Redis derrubaria login,
  // checkout, webhooks e as rotas do n8n de uma vez — o rate limiter viraria
  // um novo ponto único de falha. Preferimos perder a contagem (e deixar
  // passar) a derrubar o app; o erro fica no log para investigação.
  return {
    async increment(key: string) {
      const k = `rl:${prefix}:${key}`;
      try {
        const results = await redisClient!.multi().incr(k).pexpire(k, windowMs).exec();
        return { totalHits: (results?.[0]?.[1] as number) ?? 1, resetTime: new Date(Date.now() + windowMs) };
      } catch (e: any) {
        console.error(`[Redis] rate-limit indisponível (${prefix}); liberando request:`, e?.message);
        return { totalHits: 0, resetTime: new Date(Date.now() + windowMs) };
      }
    },
    async decrement(key: string) {
      try { await redisClient!.decr(`rl:${prefix}:${key}`); } catch { /* fail-open */ }
    },
    async resetKey(key: string) {
      try { await redisClient!.del(`rl:${prefix}:${key}`); } catch { /* fail-open */ }
    },
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
