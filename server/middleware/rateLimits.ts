import rateLimit from "express-rate-limit";
import { makeRedisStore } from "../lib/infra";

// Em dev (NODE_ENV != production) todo o tráfego sai do mesmo IP (localhost),
// então cadastro+login de teste estouram o limite rápido. Fora de produção o
// limitador é ignorado; em produção continua valendo integralmente.
const skipInDev = () => process.env.NODE_ENV !== 'production';

// --- RATE LIMITERS ---
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
  store: makeRedisStore('auth', 15 * 60 * 1000),
  skip: skipInDev,
});

export const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de cadastros por IP atingido. Tente novamente em 1 hora.' },
  store: makeRedisStore('checkout', 60 * 60 * 1000),
  skip: skipInDev,
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
  store: makeRedisStore('webhook', 60 * 1000),
});
