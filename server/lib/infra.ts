import * as Sentry from "@sentry/node";
import type { Express, NextFunction, Request, Response } from "express";
import Redis from "ioredis";
import { SENTRY_DSN, REDIS_URL } from "../config";
import { sanitizeSentryEvent } from "./sentryPrivacy";

// ─── SENTRY (opcional — error tracking) ──────────────────────────────────────
const SENTRY_EXCEPTION_CAPTURED = "__imobiflowSentryExceptionCaptured";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    includeLocalVariables: false,
    // Nesta primeira etapa o objetivo é error tracking. Omitir sampling de
    // traces desliga performance tracing e evita consumo/custo desnecessário.
    tracesSampleRate: 0,
    integrations(defaultIntegrations) {
      return defaultIntegrations
        // O Console vira breadcrumb por padrão e pode carregar texto do CRM.
        // RequestData, por padrão, inclui body, cookies, headers e query string.
        .filter(({ name }) => name !== "Console" && name !== "RequestData")
        .concat(Sentry.requestDataIntegration({
          include: {
            url: true,
            headers: false,
            cookies: false,
            data: false,
            query_string: false,
            ip: false,
          },
        }));
    },
    beforeSend: sanitizeSentryEvent,
  });
  // UncaughtException e UnhandledRejection já são integrações padrão do SDK.
  // Registrar outro listener aqui duplicava eventos de rejeição.
  console.log('[Sentry] inicializado em modo error tracking (sem PII)');
}

/**
 * Monitora respostas 5xx que foram tratadas dentro das próprias rotas.
 *
 * Grande parte das rotas do projeto usa `catch` e responde com status 500 em
 * vez de chamar `next(error)`. O error handler oficial do Sentry não recebe
 * essas exceções. Este monitor gera um evento seguro (status, método e template
 * da rota), sem corpo, URL concreta, parâmetros ou resposta.
 */
export function sentryHttp5xxMonitor(req: Request, res: Response, next: NextFunction): void {
  if (!SENTRY_DSN) {
    next();
    return;
  }

  res.once("finish", () => {
    if (
      res.statusCode < 500
      || res.statusCode >= 600
      || res.locals[SENTRY_EXCEPTION_CAPTURED]
    ) return;

    const routePath = req.route?.path;
    const route = typeof routePath === "string"
      ? `${req.baseUrl || ""}${routePath}`
      : "<unmatched>";
    const method = req.method.toUpperCase();

    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("http.method", method);
      scope.setTag("http.route", route);
      scope.setTag("http.status_code", String(res.statusCode));
      scope.setFingerprint(["http-5xx", method, route, String(res.statusCode)]);
      Sentry.captureMessage(`HTTP ${res.statusCode} em ${method} ${route}`);
    });
  });

  next();
}

/** Registra a captura de exceções Express depois de todas as rotas. */
export function setupSentryExpressErrorHandler(app: Express): void {
  if (!SENTRY_DSN) return;

  // Evita duplicar o evento no monitor de respostas 5xx acima.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    res.locals[SENTRY_EXCEPTION_CAPTURED] = true;
    next(error);
  });
  Sentry.setupExpressErrorHandler(app);
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
  // O Redis gerenciado do Fly (Upstash) só tem endereço IPv6 na rede privada,
  // e o ioredis resolve como IPv4 por padrão — a conexão falharia em silêncio
  // (e, com o store fail-open, o app seguiria funcionando SEM rate limit
  // distribuído, que é o pior dos mundos: parece certo e não é).
  // REDIS_FAMILY permite forçar 4 ou 6 se o provedor mudar.
  const host = (() => { try { return new URL(REDIS_URL).hostname; } catch { return ''; } })();
  const envFamily = Number(process.env.REDIS_FAMILY);
  const family = Number.isInteger(envFamily) && [4, 6].includes(envFamily)
    ? envFamily
    : (host.endsWith('.upstash.io') || host.endsWith('.internal') ? 6 : 4);

  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    lazyConnect: false,
    family,
  });
  redisClient.on('connect', () => console.log(`[Redis] conectado (IPv${family})`));
  redisClient.on('error',  (e: Error) => console.error('[Redis] erro:', e.message));
}

// Estado REAL da conexão (o painel de saúde mostrava só "a variável existe",
// o que daria "ativo" mesmo com o Redis inalcançável).
export async function checkRedis(): Promise<{ configured: boolean; connected: boolean; error: string | null }> {
  if (!redisClient) return { configured: false, connected: false, error: null };
  try {
    const pong = await redisClient.ping();
    return { configured: true, connected: pong === 'PONG', error: null };
  } catch (e: any) {
    return { configured: true, connected: false, error: e?.message?.slice(0, 200) || 'falha ao conectar' };
  }
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
