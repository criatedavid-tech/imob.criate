import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import * as Sentry from "@sentry/node";
import Redis from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO INICIAL E AMBIENTE ---
// Carrega o .env (se existir), sobrescrevendo vars do ambiente se necessário
dotenv.config({ override: true });

// --- CREDENCIAIS SUPABASE (somente via ambiente — NUNCA hardcoded) ---
// A URL do projeto não é segredo; a service_role key é (acesso total ao
// banco, ignora RLS). Por isso ela só vem do ambiente e o servidor recusa
// subir sem ela, evitando rodar com chave vazia ou commitada por engano.
const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "https://umvbrahsqvqeondwtikm.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  || "";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\n[FATAL] SUPABASE_SERVICE_ROLE_KEY ausente.\n" +
    "Defina a variável de ambiente (ou no .env local) antes de iniciar o servidor.\n"
  );
  process.exit(1);
}

// ─── VARIÁVEIS DE AMBIENTE EXTERNAS ───────────────────────────────────────────
const APP_URL             = process.env.APP_URL             || "http://localhost:3000";
const ASAAS_API_KEY       = process.env.ASAAS_API_KEY       || "";
const ASAAS_BASE_URL      = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';
const ZPRO_ADMIN_URL      = process.env.ZPRO_ADMIN_URL      || "";
const ZPRO_ADMIN_TOKEN    = process.env.ZPRO_ADMIN_TOKEN    || "";
// API_TOKEN_SECRET do backend Z-PRO — necessário para tenantApiCreateSession/StoreTenant
// Obtido pelo admin do servidor Z-PRO: cat /app/.env | grep API_TOKEN_SECRET
// Quando configurado, habilita criação automática de apiConfig no provisionamento.
const ZPRO_API_SECRET     = process.env.ZPRO_API_SECRET     || "";
// JWT_SECRET do Z-PRO — permite forjar tokens de tenant para configuração automática.
// Valor: JWT_SECRET do arquivo .env do backend Z-PRO.
const ZPRO_JWT_SECRET     = process.env.ZPRO_JWT_SECRET     || "";
const UAZAPI_HOST             = process.env.UAZAPI_HOST             || "https://criate.uazapi.com";
const UAZAPI_TOKEN            = process.env.UAZAPI_TOKEN            || "";
const UAZAPI_PLATFORM_SESSION = process.env.UAZAPI_PLATFORM_SESSION || "";
const PROVISIONING_WEBHOOK_URL = process.env.PROVISIONING_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/f19c91c4-b826-4150-af8d-151200e619f0";
const N8N_WEBHOOK_URL     = process.env.N8N_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/edc20beb-c9c1-46c3-bbef-8fa81538cbb3";
const SUBSCRIPTION_VALUE      = Number(process.env.SUBSCRIPTION_VALUE      || "49.90");
// Token configurado no painel Asaas (Configurações → Integrações → Webhooks → Token de Acesso).
// O Asaas envia este valor no header 'asaas-access-token' em cada evento.
// Sem ele configurado, a verificação é pulada (compatibilidade com sandbox sem token).
const ASAAS_WEBHOOK_TOKEN     = process.env.ASAAS_WEBHOOK_TOKEN             || "";
// Plano: 100 atendimentos inclusos; excedente R$ 3,00/ticket cobrado automaticamente no ciclo seguinte.
// Para alterar sem redeploy: fly secrets set PLAN_INCLUDED_TICKETS=100 PLAN_OVERAGE_PRICE=3.00
const PLAN_INCLUDED_TICKETS   = Number(process.env.PLAN_INCLUDED_TICKETS   || "100");
const PLAN_OVERAGE_PRICE      = Number(process.env.PLAN_OVERAGE_PRICE      || "3.00");
// ─── PROXY LLM ────────────────────────────────────────────────────────────────
// Token interno: N8N → servidor (substitui "credential" estática no N8N).
// Enc key: AES-256-GCM para guardar as keys OpenRouter dos corretores no banco.
const INTERNAL_PROXY_TOKEN = process.env.INTERNAL_PROXY_TOKEN || "";
const LLM_PROXY_ENC_KEY    = process.env.LLM_PROXY_ENC_KEY    || "";
// Fallback: chave da empresa usada enquanto o corretor não configurou a própria.
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY   || "";
const SENTRY_DSN           = process.env.SENTRY_DSN           || "";
const REDIS_URL            = process.env.REDIS_URL            || "";

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

function makeRedisStore(prefix: string, windowMs: number) {
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

// ─── Z-PRO JWT AUTO-REFRESH ──────────────────────────────────────────────────
// O JWT do superadmin expira em ~24h. Este objeto mantém o token em memória e
// o renova via POST /auth/refresh_token antes de qualquer chamada Z-PRO.
// Lógica:
//   • parseJwtExp()      → extrai o campo "exp" do payload sem biblioteca
//   • getZproAdminToken()→ retorna token válido, renovando se faltar < 30 min
//   • refreshZproJwt()   → chama /auth/refresh_token; em fallback tenta /auth/login
//   A variável ZPRO_ADMIN_TOKEN carrega o JWT inicial (obtido do browser ou
//   atualizado via "fly secrets set"); daí em diante o refresh é automático.

function parseJwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch { return 0; }
}

const _zproJwt = {
  token: ZPRO_ADMIN_TOKEN,
  exp:   parseJwtExp(ZPRO_ADMIN_TOKEN),
  refreshing: false
};

async function refreshZproJwt(): Promise<void> {
  if (_zproJwt.refreshing) return; // evita refresh duplo simultâneo
  _zproJwt.refreshing = true;
  try {
    // Tentativa 1: POST /auth/refresh_token (não exige senha — usa o token atual)
    const r = await fetch(`${ZPRO_ADMIN_URL}/auth/refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_zproJwt.token}` },
      body: JSON.stringify({ token: _zproJwt.token })
    });
    const raw = await r.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}
    const newToken = json?.token ?? json?.access_token ?? json?.accessToken ?? json?.data?.token;
    if (r.ok && newToken) {
      _zproJwt.token = newToken;
      _zproJwt.exp   = parseJwtExp(newToken);
      console.log(`[Z-PRO] JWT renovado via /auth/refresh_token — exp=${new Date(_zproJwt.exp * 1000).toISOString()}`);
      return;
    }
    console.warn(`[Z-PRO] /auth/refresh_token → ${r.status} | ${raw.slice(0, 200)}`);
  } catch (e: any) {
    console.warn('[Z-PRO] refresh_token exception:', e.message);
  } finally {
    _zproJwt.refreshing = false;
  }
  // Sem refresh bem-sucedido — continua com token atual (pode estar expirado;
  // os endpoints vão retornar 401 e o erro ficará visível nos logs).
  console.warn('[Z-PRO] Não foi possível renovar JWT — usando token atual (pode estar expirado)');
}

async function getZproAdminToken(): Promise<string> {
  // Prefere forgeSuperAdminJwt() quando ZPRO_JWT_SECRET está disponível:
  // gera token fresco a cada chamada (HMAC local, sem rede), nunca expira por clock drift.
  // Fallback para o token armazenado apenas quando JWT_SECRET não está configurado.
  if (ZPRO_JWT_SECRET) {
    return forgeSuperAdminJwt();
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const margin = 30 * 60;
  if (_zproJwt.exp > 0 && nowSec >= _zproJwt.exp - margin) {
    console.log(`[Z-PRO] JWT prestes a expirar (exp=${new Date(_zproJwt.exp * 1000).toISOString()}) — renovando...`);
    await refreshZproJwt();
  }
  return _zproJwt.token;
}

// Normaliza telefone BR para o formato exigido pelo WhatsApp/Z-PRO:
// DDI 55 + DDD (2) + 8 dígitos, sem o nono dígito.
// Ex.: "(62)99159-2150" -> "556291592150"
// ─── AES-256-GCM: criptografa/descriptografa a key OpenRouter do corretor ─────
function encryptKey(plaintext: string): string {
  if (!LLM_PROXY_ENC_KEY) throw new Error('LLM_PROXY_ENC_KEY não configurada');
  const key = Buffer.from(LLM_PROXY_ENC_KEY, 'hex');
  const iv  = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64'); // iv(12)+tag(16)+ciphertext
}

function decryptKey(packed: string): string {
  if (!LLM_PROXY_ENC_KEY) throw new Error('LLM_PROXY_ENC_KEY não configurada');
  const key = Buffer.from(LLM_PROXY_ENC_KEY, 'hex');
  const buf = Buffer.from(packed, 'base64');
  const iv         = buf.subarray(0, 12);
  const tag        = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

function normalizePhoneBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  // Remove DDI 55 se já presente (12+ dígitos = 55 + DDD + 8/9)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  const ddd = d.slice(0, 2);
  let num = d.slice(2);
  // Remove o nono dígito do celular (9 dígitos começando com 9 -> 8 dígitos)
  if (num.length === 9 && num.startsWith('9')) num = num.slice(1);
  return `55${ddd}${num}`;
}

// Gera um JWT HS256 válido para o Z-PRO sem precisar de login.
// Usa o JWT_SECRET do Z-PRO para assinar — funciona porque Z-PRO usa JWT stateless.
// Usado como fallback quando o login do tenant falha (usuário criado no tenant errado).
function forgeTenantJwt(tenantId: number, userId: number, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: userId, username: email, profile: 'admin',
    tenantId, iat: now, exp: now + 86400
  })).toString('base64url');
  const sig = createHmac('sha256', ZPRO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// Forja token de super-admin para o Z-PRO (não requer restart do servidor Z-PRO).
// Requer ZPRO_JWT_SECRET. Typo intencional: "usarname" (Z-PRO usa esse campo).
function forgeSuperAdminJwt(): string {
  if (!ZPRO_JWT_SECRET) throw new Error('ZPRO_JWT_SECRET não configurado — não é possível forjar token super-admin');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    usarname: 'Super Administrador',  // typo intencional do Z-PRO
    tenantId: 1, profile: 'superadmin', id: 2,
    iat: now, exp: now + 86400
  })).toString('base64url');
  const sig = createHmac('sha256', ZPRO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Headers de segurança HTTP (HSTS, X-Frame-Options, nosniff, etc.)
  // CSP desativado: o SPA Vite usa inline styles/scripts que o CSP padrão bloquearia.
  app.use(helmet({ contentSecurityPolicy: false }));

  // 10mb: suficiente para upload individual de foto em base64 (~7MB de imagem real).
  // Limite anterior de 50mb era vetor de DoS por exaustão de memória.
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // --- INTEGRAÇÃO COM SUPABASE ---
  const supabaseUrl = SUPABASE_URL;
  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY;
  
  // Cliente Supabase para operações no banco de dados e autenticação
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });

  // --- RATE LIMITERS ---
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
    store: makeRedisStore('auth', 15 * 60 * 1000),
  });

  const checkoutLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Limite de cadastros por IP atingido. Tente novamente em 1 hora.' },
    store: makeRedisStore('checkout', 60 * 60 * 1000),
  });

  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded.' },
    store: makeRedisStore('webhook', 60 * 1000),
  });

  // --- AUTENTICAÇÃO REAL (valida o JWT do Supabase, não confia em headers) ---
  // O header x-user-id é ignorado para fins de identidade: o userId vem
  // exclusivamente do access_token validado pelo Supabase Auth.
  // Cache de 60s evita uma chamada ao Auth por request.
  const tokenCache = new Map<string, { userId: string; expires: number }>();

  async function verifyAccessToken(req: express.Request): Promise<string | null> {
    const token = (req.headers.authorization || '').toString().replace(/^Bearer\s+/i, '').trim();
    if (!token || token === 'dummy_token' || token === 'null' || token === 'undefined') return null;

    const cached = tokenCache.get(token);
    if (cached && cached.expires > Date.now()) return cached.userId;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;

    if (tokenCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of tokenCache) if (v.expires <= now) tokenCache.delete(k);
    }
    tokenCache.set(token, { userId: data.user.id, expires: Date.now() + 60_000 });
    return data.user.id;
  }

  // Rotas que EXIGEM usuário logado
  async function requireUser(req: any, res: any, next: any) {
    const userId = await verifyAccessToken(req);
    if (!userId) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    req.userId = userId;
    next();
  }

  // Rotas com auth opcional (ex.: GET /api/properties serve landing pública)
  async function optionalUser(req: any, _res: any, next: any) {
    req.userId = await verifyAccessToken(req);
    next();
  }

  // --- ROTAS DE AUTENTICAÇÃO (AUTH) ---
  /**
   * Realiza o cadastro de um novo usuário (corretor) no sistema.
   * Cria também um perfil inicial na tabela 'brokers'.
   */
  app.post("/api/auth/signup", authLimiter, async (req, res) => {
    try {
      const { email, password, name, phone } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
      }

      // Verifica se já existe conta com este e-mail
      const { data: existing } = await supabase.from('brokers').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
      if (existing) {
        return res.status(400).json({ error: 'Este e-mail já possui uma conta. Faça login ou recupere sua senha.' });
      }

      const cleanEmail = email.toLowerCase().trim();

      // Cria o usuário JÁ confirmado (via admin/service_role) — evita a race
      // condition de confirmar o e-mail depois e não conseguir a sessão na hora.
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true
      });
      if (createErr) throw createErr;

      if (created.user) {
        const { error: profileError } = await supabase.from('brokers').insert([{
          user_id: created.user.id,
          name: name.trim(),
          phone: normalizePhoneBR(phone),
          email: cleanEmail,
          ai_name: 'Minha Assistente IA',
          broker_address: '',
          status: 'pendente'
        }]);
        if (profileError) console.error("Error creating profile:", profileError);

        // Usuário já nasce confirmado → signInWithPassword retorna a sessão na hora
        const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: loginData, error: loginErr } = await authClient.auth
          .signInWithPassword({ email: cleanEmail, password });

        if (loginErr || !loginData?.session) {
          console.error("Signup auto-login falhou:", loginErr);
          // Conta criada, mas sem sessão — frontend redireciona para login
          return res.json({ user: created.user, session: null });
        }

        return res.json({ user: loginData.user, session: loginData.session });
      }

      res.json({ user: created.user, session: null });
    } catch (err: any) {
      console.error("Auth Signup Error:", err);
      const msg = err.message?.includes('already registered')
        ? 'Este e-mail já possui uma conta. Faça login ou recupere sua senha.'
        : err.message;
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
      if (error) {
        const msg = error.message?.toLowerCase().includes('invalid')
          ? 'E-mail ou senha incorretos.'
          : error.message;
        return res.status(401).json({ error: msg });
      }
      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      console.error("Auth Login Error:", err);
      res.status(401).json({ error: err.message });
    }
  });

  // Renova a sessão usando o refresh_token (access_token do Supabase expira em ~1h)
  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refresh_token } = req.body || {};
      if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório.' });

      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.refreshSession({ refresh_token });
      if (error || !data?.session) {
        return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
      }
      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  // Recuperação de senha via WhatsApp — gera token temporário (15 min) e envia link
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const genericMsg = { message: 'Se o e-mail estiver cadastrado, você receberá o link de recuperação pelo WhatsApp.' };
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

      // Busca corretor pelo e-mail
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, phone')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (!broker?.phone) { res.json(genericMsg); return; }

      // Gera token seguro e expira em 15 minutos
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase.from('brokers').update({
        reset_token: token,
        reset_token_expires_at: expiresAt
      }).eq('id', broker.id);

      // Monta link e envia via WhatsApp (UAZAPI)
      const resetLink = `${APP_URL}/reset-password?token=${token}`;
      const phone = normalizePhoneBR(broker.phone);

      if (UAZAPI_HOST && UAZAPI_TOKEN && UAZAPI_PLATFORM_SESSION && phone) {
        const wppText =
          `🏠 *ImobiFlow*\n\n` +
          `Você solicitou a recuperação de senha.\n\n` +
          `Clique no link abaixo para criar uma nova senha ` +
          `*(válido por 15 minutos)*:\n\n` +
          `${resetLink}\n\n` +
          `_Se não foi você, ignore esta mensagem._`;

        await fetch(`${UAZAPI_HOST}/message/text/${UAZAPI_PLATFORM_SESSION}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': UAZAPI_TOKEN },
          body: JSON.stringify({ number: phone, text: wppText })
        }).catch(e => console.warn('[WPP] Envio de reset falhou:', e?.message));
      } else {
        console.warn('[WPP] UAZAPI_PLATFORM_SESSION não configurado — link gerado mas não enviado:', resetLink);
      }

      res.json(genericMsg);
    } catch (err: any) {
      console.error("Forgot password error:", err);
      res.json(genericMsg);
    }
  });

  // Valida token e atualiza a senha
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

      // Busca corretor pelo token
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, user_id, reset_token_expires_at')
        .eq('reset_token', token)
        .single();

      if (!broker) return res.status(400).json({ error: 'Link inválido ou já utilizado.' });

      // Verifica expiração
      if (new Date(broker.reset_token_expires_at) < new Date()) {
        return res.status(400).json({ error: 'Link expirado. Solicite uma nova recuperação de senha.' });
      }

      // Atualiza senha via admin (service_role)
      const { error } = await supabase.auth.admin.updateUserById(broker.user_id, { password: newPassword });
      if (error) throw error;

      // Invalida o token imediatamente
      await supabase.from('brokers').update({
        reset_token: null,
        reset_token_expires_at: null
      }).eq('id', broker.id);

      res.json({ message: 'Senha atualizada com sucesso.' });
    } catch (err: any) {
      console.error("Reset password error:", err);
      res.status(400).json({ error: 'Erro ao atualizar senha. Tente novamente.' });
    }
  });

  // --- ROTAS DE CONFIGURAÇÃO DO CORRETOR ---
  /**
   * Obtém as informações do perfil do corretor logado.
   */
  app.get("/api/brokers/me", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string; 
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found or created" });

      // Campos seguros para expor ao frontend — NUNCA incluir:
      // asaas_credit_card_token (cobra cartão), zpro_password, reset_token, reset_token_expires_at
      const { data, error } = await supabase.from('brokers').select(
        'id, user_id, name, email, phone, ai_name, broker_address, status, plan, ' +
        'valid_until, grace_until, is_admin, corretora_id, ' +
        'zpro_tenant_id, zpro_channel_id, zpro_channel_name, zpro_user_email, zpro_username, zpro_qr_code, ' +
        'zpro_api_url, zpro_api_key, ' +
        'asaas_customer_id, asaas_subscription_id, ' +
        'provisioning_status, provisioning_error, provisioning_completed_at, ' +
        'created_at, updated_at'
      ).eq('id', brokerId).single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Atualiza as configurações e informações do perfil do corretor.
   */
  app.post("/api/brokers/settings", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found" });

      // Whitelist: impede mass assignment (ex.: is_admin, valid_until, status
      // ou tokens de pagamento enviados no body seriam gravados sem isso).
      const ALLOWED_SETTINGS = ['name', 'phone', 'ai_name', 'broker_address'] as const;
      const settings: Record<string, any> = {};
      for (const field of ALLOWED_SETTINGS) {
        if (req.body?.[field] !== undefined) settings[field] = req.body[field];
      }
      if (settings.phone !== undefined) settings.phone = normalizePhoneBR(settings.phone);
      const { data, error } = await supabase.from('brokers').update({
        ...settings,
        updated_at: new Date()
      }).eq('id', brokerId).select(
        'id, name, phone, ai_name, broker_address, updated_at'
      ).single();
      
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // ─── Agente IA do corretor ───────────────────────────────────────────────

  app.get("/api/brokers/my-agent", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker not found" });

      const { data } = await supabase
        .from('broker_agents')
        .select('id, agent_name, system_prompt, is_active, updated_at')
        .eq('broker_id', brokerId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      res.json(data ?? { agent_name: 'Agente Principal', system_prompt: '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/brokers/my-agent", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker not found" });

      const agent_name: string = req.body?.agent_name || 'Agente Principal';
      const system_prompt: string = req.body?.system_prompt ?? '';

      const { data: existing } = await supabase
        .from('broker_agents')
        .select('id')
        .eq('broker_id', brokerId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from('broker_agents')
          .update({ agent_name, system_prompt, updated_at: new Date() })
          .eq('id', existing.id)
          .select('id, agent_name, system_prompt, updated_at')
          .single();
        if (error) throw error;
        return res.json(data);
      }

      const { data, error } = await supabase
        .from('broker_agents')
        .insert({ broker_id: brokerId, agent_name, system_prompt })
        .select('id, agent_name, system_prompt, updated_at')
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint para N8N — auth via INTERNAL_PROXY_TOKEN
  app.get("/api/brokers/:id/agent", async (req, res) => {
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    try {
      const { id } = req.params;
      const { data } = await supabase
        .from('broker_agents')
        .select('agent_name, system_prompt')
        .eq('broker_id', id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      res.json({ agent_name: data?.agent_name ?? 'Agente Principal', system_prompt: data?.system_prompt ?? '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to ensure broker exists
  async function getBrokerId(userId: string) {
    if (!userId) return null;
    try {
      const { data: brokers, error } = await supabase.from('brokers').select('id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1);
      
      if (error) {
        console.error("Error fetching broker:", error);
        return null;
      }

      if (!brokers || brokers.length === 0) {
        console.log("Broker profile not found for user, creating one...");
        // Fallback: fetch user info from auth to get name/email if possible, or use defaults
        // Note: admin.getUserById might not work with standard key, but we try
        const { data: userData } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } }));
        const user = userData?.user;
        
        const { data: newBroker, error: createError } = await supabase.from('brokers').insert([
          { 
            user_id: userId,
            name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Corretor',
            phone: '',
            ai_name: 'Minha Assistente IA',
            broker_address: ''
          }
        ]).select().single();
        
        if (createError) {
          console.error("Error creating broker profile on the fly:", createError);
          return null;
        }
        return newBroker.id;
      }
      
      return brokers[0].id;
    } catch (err) {
      console.error("error in getBrokerId:", err);
      return null;
    }
  }

  // --- UPLOAD DE FOTO DO CORRETOR ---
  app.post("/api/brokers/upload-photo", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { imageData } = req.body;
      if (!imageData) return res.status(400).json({ error: "No image data" });

      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `broker-${userId}.jpg`;

      // Garante que o bucket existe
      await supabase.storage.createBucket('broker-photos', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        fileSizeLimit: 5242880
      }).catch(() => {}); // ignora erro se bucket já existe

      const { error: uploadError } = await supabase.storage
        .from('broker-photos')
        .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('broker-photos')
        .getPublicUrl(fileName);

      res.json({ url: publicUrl });
    } catch (err: any) {
      console.error("Erro upload foto corretor:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- UPLOAD DE IMAGEM DE IMÓVEL ---
  // Recebe UMA imagem base64, grava no Supabase Storage e devolve a URL
  // pública (CDN). Substitui o antigo fluxo que trafegava arrays de base64
  // pelo heap do Node e os gravava como TEXT no Postgres (causa do OOM).
  app.post("/api/properties/upload-image", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { imageData } = req.body;
      if (!imageData || typeof imageData !== 'string') {
        return res.status(400).json({ error: "No image data" });
      }

      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Limite defensivo de 8MB por imagem já comprimida
      if (buffer.length > 8 * 1024 * 1024) {
        return res.status(413).json({ error: "Imagem muito grande (máx. 8MB)." });
      }

      const fileName = `prop-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

      // Garante que o bucket existe (idempotente)
      await supabase.storage.createBucket('property-images', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        fileSizeLimit: 8388608
      }).catch(() => {}); // ignora erro se bucket já existe

      const { error: uploadError } = await supabase.storage
        .from('property-images')
        .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('property-images')
        .getPublicUrl(fileName);

      res.json({ url: publicUrl });
    } catch (err: any) {
      console.error("Erro upload imagem imóvel:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CORRETORA (imobiliária) — vínculo N:1 (broker → corretora)
  // ─────────────────────────────────────────────────────────────────────────

  // Retorna a corretora vinculada ao corretor logado
  app.get("/api/corretora", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('corretora_id').eq('id', brokerId).single();

      if (!broker?.corretora_id) return res.json({ corretora: null });

      const { data: corretora } = await supabase.from('corretoras')
        .select('*').eq('id', broker.corretora_id).single();

      res.json({ corretora, isOwner: corretora?.owner_broker_id === brokerId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cria/atualiza a corretora e vincula o corretor logado (upsert por CNPJ)
  app.post("/api/corretora", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { razao_social, cnpj, creci_empresa, endereco, telefone, email } = req.body;
      if (!razao_social || !cnpj) {
        return res.status(400).json({ error: "Razão social e CNPJ são obrigatórios." });
      }
      const cnpjClean = String(cnpj).replace(/\D/g, '');

      // Já existe corretora com este CNPJ? vincula a ela; senão cria
      const { data: existing } = await supabase.from('corretoras')
        .select('*').eq('cnpj', cnpjClean).maybeSingle();

      let corretora = existing;
      if (existing) {
        // Só o owner pode editar os dados da corretora existente
        if (existing.owner_broker_id === brokerId) {
          const { data: upd } = await supabase.from('corretoras').update({
            razao_social, creci_empresa: creci_empresa || null,
            endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
            email: email || null, updated_at: new Date().toISOString()
          }).eq('id', existing.id).select().single();
          corretora = upd || existing;
        }
      } else {
        const { data: created, error: cErr } = await supabase.from('corretoras').insert({
          razao_social, cnpj: cnpjClean, creci_empresa: creci_empresa || null,
          endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
          email: email || null, owner_broker_id: brokerId
        }).select().single();
        if (cErr) throw cErr;
        corretora = created;
      }

      // Vincula o corretor logado à corretora
      await supabase.from('brokers')
        .update({ corretora_id: corretora.id, updated_at: new Date() })
        .eq('id', brokerId);

      res.json({ corretora, isOwner: corretora.owner_broker_id === brokerId });
    } catch (err: any) {
      console.error("Erro POST /api/corretora:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Lista os corretores vinculados à corretora (apenas o owner/admin da corretora vê)
  app.get("/api/corretora/brokers", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('corretora_id').eq('id', brokerId).single();
      if (!broker?.corretora_id) return res.json({ brokers: [] });

      const { data: corretora } = await supabase.from('corretoras')
        .select('owner_broker_id').eq('id', broker.corretora_id).single();
      if (corretora?.owner_broker_id !== brokerId) {
        return res.status(403).json({ error: "Apenas o administrador da corretora pode ver os corretores vinculados." });
      }

      const { data: brokers } = await supabase.from('brokers')
        .select('id, name, email, phone, status, created_at')
        .eq('corretora_id', broker.corretora_id)
        .order('created_at', { ascending: true });

      res.json({ brokers: brokers || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ROTAS DE INTELIGÊNCIA ARTIFICIAL (GEMINI) ---
  /**
   * Rota para aprimorar textos de descrições de imóveis.
   * Utiliza a API do Google Gemini para reescrever o texto com linguagem premium.
   */
  app.post("/api/ai/enhance-text", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Nenhum texto fornecido para aprimoramento." });
      }
      
      // Obtém a chave de API do ambiente
      const apiKey = process.env.GEMINI_API_KEY;
      
      // Validação básica da presença da chave
      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        console.error("ERRO: GEMINI_API_KEY não configurada ou inválida no servidor.");
        return res.status(500).json({ 
          error: "A funcionalidade de IA não está configurada corretamente (Chave de API ausente)." 
        });
      }
      
      // Inicialização do cliente GoogleGenAI
      const ai = new GoogleGenAI({ apiKey });
      
      // Chamada para geração de conteúdo com instrução de sistema
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-lite",
        config: {
          systemInstruction: "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais."
        },
        contents: text,
      });
      
      // Retorna o texto sugerido pela IA
      res.json({ suggestedText: response.text });
    } catch (error: any) {
      // Log detalhado do erro para depuração no servidor
      console.error("Erro na API da IA (Gemini):", error);
      
      // Tratamento de mensagens de erro amigáveis
      let errorMsg = "Não foi possível gerar a sugestão no momento.";
      if (error.message?.includes("API key not valid")) {
        errorMsg = "Erro de autenticação com a API da IA. Verifique a configuração da chave.";
      } else if (error.message?.includes("high demand") || error.message?.includes("429") || error.message?.includes("quota")) {
        errorMsg = "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente.";
      }
      
      res.status(500).json({ error: errorMsg });
    }
  });

  // --- ROTAS DE PROPRIEDADES (IMÓVEIS) ---
  /**
   * Lista todos os imóveis associados ao usuário logado.
   */
  app.get("/api/properties", optionalUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const query = supabase.from('properties').select('*');
      
      if (userId) {
        const brokerId = await getBrokerId(userId);
        if (brokerId) {
          query.eq('broker_id', brokerId);
        } else {
          // If no broker found/created, maybe show nothing or all?
          // The user expects to see THEIR houses.
          query.eq('broker_id', '00000000-0000-0000-0000-000000000000'); // Force empty if no broker
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      
      const formattedData = (data || []).map(p => {
        // --- Parse de imagens ---
        let imageUrlStr = p.image_url;
        let imagesArray: string[] = [];
        try {
          if (imageUrlStr && imageUrlStr.startsWith('[')) {
             imagesArray = JSON.parse(imageUrlStr);
             imageUrlStr = imagesArray[0] || '';
          } else if (imageUrlStr) {
             imagesArray = [imageUrlStr];
          }
        } catch(e) {
             imagesArray = imageUrlStr ? [imageUrlStr] : [];
        }

        // --- Parse de campos estruturados embutidos na descrição ---
        // O PropertyForm salva: "{descrição limpa}\n\n---DETALHES-GERADOS---\n{JSON}"
        // Aqui separamos para que consumidores (N8N, frontend) recebam dados organizados.
        let cleanDescription = p.description || '';
        let details: Record<string, any> = {};
        const SEPARATOR = '---DETALHES-GERADOS---';
        if (cleanDescription.includes(SEPARATOR)) {
          const parts = cleanDescription.split(SEPARATOR);
          cleanDescription = parts[0].trim();
          try {
            details = JSON.parse(parts[1].trim());
          } catch { /* JSON malformado - ignora */ }
        }

        return {
          ...p,
          description: cleanDescription,   // texto limpo, sem o bloco JSON
          details,                          // { quartos, sala, cozinha, piscina, banheiros, area, varanda_gourmet }
          imageUrl: imageUrlStr,
          images: imagesArray,
        };
      });
      
      res.json(formattedData);
    } catch (err: any) {
      console.error("Erro GET /api/properties:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/properties", requireUser, async (req, res) => {
    try {
      let property = req.body;
      const imgCount = Array.isArray(property.images) ? property.images.length : (property.imageUrl ? 1 : 0);
      console.log(`POST /api/properties: title="${property.title}" price="${property.price}" imgs=${imgCount}`);
      
      // Mapeamento de campos do frontend para o banco de dados
      if (property.images !== undefined) {
        property.image_url = JSON.stringify(property.images);
      } else if (property.imageUrl !== undefined) {
        property.image_url = property.imageUrl;
      }
      
      delete property.images;
      delete property.imageUrl;
      
      
      if (!property.slug) {
        const slugBase = (property.title || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        property.slug = `${slugBase}-${Math.random().toString(36).substring(2, 6)}`;
      }

      // --- GERAÇÃO DO LINK DA LANDING PAGE ---
      /**
       * Gera o link completo da landing page exclusiva do imóvel.
       * O link segue o padrão: https://[dominio]/p/[slug-do-imovel]
       */
      const origin = req.headers.origin || req.headers.referer || APP_URL;
      // Remove barra final se existir para garantir formatação limpa
      const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
      property.link = `${cleanOrigin}/p/${property.slug}`;

      // Link to broker
      const userId = (req as any).userId as string;
      if (userId) {
        const brokerId = await getBrokerId(userId);
        if (brokerId) {
          property.broker_id = brokerId;
        } else {
          console.error("Could not associate property with a broker (no broker found or created)");
          return res.status(403).json({ error: "Sua conta não possui um perfil de corretor para cadastrar imóveis. Tente fazer login novamente." });
        }
      } else {
        return res.status(401).json({ error: "O usuário não está autenticado e não pode salvar o imóvel." });
      }
      
      console.log("Upserting property with landing page link:", property.link);
      
      // Lista de colunas permitidas no banco de dados (Whitelisting)
      // Adicionada a coluna 'link' para persistência da URL da Landing Page
      const validColumns = [
        'id',
        'title',
        'price',
        'location',
        'description',
        'image_url',
        'slug',
        'created_at',
        'updated_at',
        'broker_id',
        'link',
        'status'
      ];

      const filteredProperty = Object.keys(property)
        .filter(key => validColumns.includes(key))
        .reduce((obj: any, key) => {
          obj[key] = property[key];
          return obj;
        }, {});

      const { data, error } = await supabase.from('properties').upsert(filteredProperty).select().single();
      
      if (error) {
        console.error("Supabase error upserting property:", error);
        throw error;
      }
      
      if (data) {
        data.imageUrl = data.image_url;
      }
      
      res.json(data);
    } catch (err: any) {
      console.error("Erro POST /api/properties:", err);
      res.status(500).json({ error: err.message || "Unknown server error" });
    }
  });

  // NOVO: implementado em 30/04/2026 - não altera legado
  app.get("/api/dashboard/metrics", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 });

      // Count properties
      const { count: propertyCount, error: propError } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('broker_id', brokerId);

      if (propError) throw propError;

      // Count leads for these properties
      // First get property IDs
      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const ids = (propIds || []).map(p => p.id);
      
      let activeLeads = 0;
      let scheduledVisits = 0;

      if (ids.length > 0) {
        const { count: leadsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('property_id', ids)
          .neq('status', 'archived');
        activeLeads = leadsCount || 0;

        const { count: visitsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('property_id', ids)
          .in('status', ['visita_agendada', 'agendado']);
        scheduledVisits = visitsCount || 0;
      }

      res.json({
        totalProperties: propertyCount || 0,
        activeLeads,
        scheduledVisits
      });
    } catch (err: any) {
      console.error("Erro GET /api/dashboard/metrics:", err);
      res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 }); // Fallback
    }
  });

  app.get("/api/dashboard/charts", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds } = await supabase
        .from('properties')
        .select('id')
        .eq('broker_id', brokerId);

      const ids = (propIds || []).map((p: any) => p.id);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('leads')
          .select('created_at')
          .in('property_id', ids)
          .gte('created_at', sixMonthsAgo.toISOString());
        leads = data || [];
      }

      const counts: Record<string, number> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        counts[key] = 0;
      }
      for (const lead of leads) {
        const d = new Date(lead.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in counts) counts[key]++;
      }

      const result = Object.entries(counts).map(([key, value]) => {
        const [year, month] = key.split('-');
        const name = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(parseInt(year), parseInt(month) - 1, 1));
        return { name: name.replace('.', ''), value };
      });

      res.json(result);
    } catch (err: any) {
      console.error("Erro GET /api/dashboard/charts:", err);
      res.json([]);
    }
  });

  app.get("/api/leads/recent", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false })
          .limit(5);
        if (error) throw error;
        leads = data || [];
      }

      const formattedLeads = leads.map((l: any) => ({
        id: l.id,
        name: l.name || l.client_name || 'Sem nome',
        property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido',
        time: l.created_at,
        status: l.status
      }));

      res.json(formattedLeads);
    } catch (err: any) {
      console.error("Erro GET /api/leads/recent:", err);
      res.json([]);
    }
  });

  app.get("/api/properties/health", async (req, res) => {
    try {
      const { data, error } = await supabase.from('properties').select('id').limit(1);
      if (error) throw error;
      res.json({
        database: "CONNECTED",
        supabase_api: "CONNECTED",
        message: "Node.js Backend via Supabase"
      });
    } catch (err: any) {
      res.json({
        database: "ERROR",
        supabase_api: "ERROR",
        db_error: err.message || JSON.stringify(err),
        full_error: err,
        message: "Node.js Backend via Supabase (Error)"
      });
    }
  });

  app.get("/api/properties/:slug", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('*, brokers(*)')
        .eq('slug', req.params.slug)
        .single();
      
      if (error?.code === 'PGRST116') return res.status(404).json({ error: "Imóvel não encontrado" });
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Imóvel não encontrado" });

      let imageUrlStr = data.image_url;
      let imagesArray: string[] = [];
      try {
        if (imageUrlStr && imageUrlStr.startsWith('[')) {
           imagesArray = JSON.parse(imageUrlStr);
           imageUrlStr = imagesArray[0] || '';
        } else if (imageUrlStr) {
           imagesArray = [imageUrlStr];
        }
      } catch(e) {
         imagesArray = imageUrlStr ? [imageUrlStr] : [];
      }
      data.imageUrl = imageUrlStr;
      data.images = imagesArray;

      // Parse campos estruturados embutidos na descrição
      const SEPARATOR = '---DETALHES-GERADOS---';
      let cleanDescription = data.description || '';
      let details: Record<string, any> = {};
      if (cleanDescription.includes(SEPARATOR)) {
        const parts = cleanDescription.split(SEPARATOR);
        cleanDescription = parts[0].trim();
        try { details = JSON.parse(parts[1].trim()); } catch { /* ignora */ }
      }
      data.description = cleanDescription;
      data.details = details;

      res.json(data);
    } catch (err: any) {
      console.error("Erro GET /api/properties/:slug:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Remove um imóvel do sistema permanentemente.
   */
  app.delete("/api/properties/:id", async (req, res) => {
    try {
      const { error } = await supabase.from('properties').delete().eq('id', req.params.id);
      if (error) throw error;
      res.status(200).json({ success: true });
    } catch (err: any) {
      console.error("Erro DELETE /api/properties:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- FLUXO DE CAPTURA DE LEADS (30/04/2026) ---
  /**
   * Endpoint aprimorado para salvar leads e disparar integrações automáticas.
   */
  app.post("/api/leads", async (req, res) => {
    try {
      const { property_id, name, phone, email, status, notes } = req.body;

      // 1. Validação básica
      if (!name || !phone || !property_id) {
        return res.status(400).json({ error: "Nome, telefone e ID do imóvel são obrigatórios." });
      }

      // 2. Inserir na tabela leads
      const { data: lead, error: insertError } = await supabase.from('leads').insert([
        {
          property_id,
          name,
          phone,
          email: email || '',
          status: status || 'new',
          notes: notes || 'Lead via Landing Page',
          created_at: new Date()
        }
      ]).select().single();

      if (insertError) throw insertError;

      // 3. Roteamento (Chatbot Webhook ou E-mail)
      const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;
      let integrationStatus = "none";

      if (webhookUrl) {
        // Envio assíncrono para o Webhook (Fire and Forget)
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: lead.id,
            name,
            phone,
            property_id,
            origin: 'Landing Page',
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.error("Erro ao disparar Webhook:", err));
        integrationStatus = "chatbot";
      } else {
        integrationStatus = "none";
      }

      // 4. Log (Opcional - usando console para não criar novas tabelas se não existirem)
      console.log(`// FLUXO ENVIAR LEAD 30/04/2026: Lead ID ${lead.id} enviado. Chatbot: ${webhookUrl ? 'sim' : 'nao'}`);

      res.status(201).json({ ...lead, integrationStatus });
    } catch (err: any) {
      console.error("Erro no fluxo de envio de lead:", err);
      res.status(500).json({ error: "Falha ao processar contato. Por favor, use o WhatsApp." });
    }
  });

  app.get("/api/agenda/visits", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      // Lê da tabela agenda (criada para o N8N gravar agendamentos)
      const { data: agendaVisits, error: agendaError } = await supabase
        .from('agenda')
        .select('*')
        .eq('broker_id', brokerId)
        .order('scheduled_at', { ascending: true });

      if (agendaError) throw agendaError;

      // Retrocompat: lê também de leads com status de visita agendada (dados antigos)
      const { data: propIds } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let legacyVisits: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .in('status', ['visita_agendada', 'agendado'])
          .order('created_at', { ascending: false });
        legacyVisits = (data || []).map((l: any) => ({
          ...l,
          name: l.name || l.client_name || 'Sem nome',
          phone: l.phone || l.client_phone || '',
          scheduled_at: l.created_at,
          property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
        }));
      }

      const agendaFormatted = (agendaVisits || []).map((a: any) => ({
        ...a,
        name: a.title || 'Sem nome',
        property: propertiesMap.get(a.property_id) || 'Imóvel desconhecido'
      }));

      res.json([...agendaFormatted, ...legacyVisits]);
    } catch (err: any) {
      console.error("Erro GET /api/agenda/visits:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/leads", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false });
        if (error) throw error;
        leads = data || [];
      }

      res.json(leads.map((l: any) => ({
        ...l,
        name: l.name || l.client_name || 'Sem nome',
        phone: l.phone || l.client_phone || '',
        property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
      })));
    } catch (err: any) {
      console.error("Erro GET /api/leads:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza o status de um imóvel (disponivel / vendido / alugado)
  app.patch("/api/properties/:id/status", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status é obrigatório." });

      const { data, error } = await supabase
        .from('properties')
        .update({ status })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      console.error("Erro PATCH /api/properties/:id/status:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza o status de um lead
  app.patch("/api/leads/:id/status", requireUser, async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status é obrigatório." });

      const { data, error } = await supabase
        .from('leads')
        .update({ status })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      console.error("Erro PATCH /api/leads/:id/status:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // NOVO LANDING 30/04/2026 - Endpoint para buscar agenda
  app.get("/api/agenda", async (req, res) => {
    try {
      // Como a tabela 'agenda' pode não existir ou ter nome diferente no sistema real do usuário
      // tentamos buscar da tabela 'agenda'. Se der erro, retornamos lista vazia conforme requisito fallback.
      const { data, error } = await supabase.from('agenda').select('*');
      
      if (error) {
        console.log("Aviso: Tabela 'agenda' não encontrada. Usando fallback de lista vazia.");
        return res.json([]);
      }
      
      res.json(data || []);
    } catch (err) {
      res.json([]);
    }
  });

  // Retorna configurações públicas do plano (preço atual)
  app.get("/api/config/plan", (_req, res) => {
    const price = SUBSCRIPTION_VALUE;
    const priceDisplay = price.toFixed(2).replace('.', ',');
    res.json({ price, priceDisplay });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ASAAS — CHECKOUT E WEBHOOK
  // ─────────────────────────────────────────────────────────────────────────

  const asaasHeaders = () => ({
    'Content-Type': 'application/json',
    'access_token': ASAAS_API_KEY
  });

  // Cria cobrança no Asaas (cartão de crédito) e ativa o corretor imediatamente
  app.post("/api/checkout", checkoutLimiter, requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!ASAAS_API_KEY) {
      return res.status(503).json({ error: "Pagamento ainda não configurado. Aguarde." });
    }

    const { cpfCnpj, cardHolder, cardNumber, expiryMonth, expiryYear, cvv } = req.body;
    if (!cpfCnpj || !cardHolder || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
      return res.status(400).json({ error: "Dados do cartão incompletos." });
    }

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (!broker) return res.status(404).json({ error: "Corretor não encontrado." });

      // 1. Cria cliente no Asaas
      const customerResp = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders(),
        body: JSON.stringify({
          name: broker.name || broker.email,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
          email: broker.email,
          phone: (broker.phone || '').replace(/\D/g, '')
        })
      });

      const customerData = await customerResp.json();
      if (!customerResp.ok) {
        throw new Error(customerData.errors?.[0]?.description || 'Erro ao registrar cliente');
      }
      const customerId = customerData.id;

      // 2. Cria assinatura RECORRENTE mensal com cartão de crédito
      const nextDueDate = new Date().toISOString().split('T')[0];
      const subscriptionResp = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
        method: 'POST',
        headers: asaasHeaders(),
        body: JSON.stringify({
          customer: customerId,
          billingType: 'CREDIT_CARD',
          value: SUBSCRIPTION_VALUE,
          nextDueDate,
          cycle: 'MONTHLY',
          description: 'ImobiFlow - Assinatura Mensal',
          creditCard: {
            holderName: cardHolder,
            number: cardNumber.replace(/\s/g, ''),
            expiryMonth,
            expiryYear,
            ccv: cvv
          },
          creditCardHolderInfo: {
            name: cardHolder,
            email: broker.email,
            cpfCnpj: cpfCnpj.replace(/\D/g, ''),
            postalCode: '00000000',
            addressNumber: 'S/N',
            phone: (broker.phone || '').replace(/\D/g, '') || '00000000000'
          }
        })
      });

      const subscription = await subscriptionResp.json();
      if (!subscriptionResp.ok) {
        throw new Error(subscription.errors?.[0]?.description || subscription.message || 'Assinatura recusada');
      }

      // 3. Busca o primeiro payment gerado pela subscription
      const firstPaymentResp = await fetch(
        `${ASAAS_BASE_URL}/subscriptions/${subscription.id}/payments`,
        { method: 'GET', headers: asaasHeaders() }
      );
      const firstPaymentList = await firstPaymentResp.json();
      const firstPayment = firstPaymentList.data?.[0];

      if (!firstPayment) {
        throw new Error('Primeira cobrança da assinatura não foi gerada.');
      }
      if (firstPayment.status !== 'CONFIRMED' && firstPayment.status !== 'RECEIVED') {
        throw new Error('Pagamento não aprovado. Verifique os dados do cartão.');
      }

      // 4. Salva subscription_id e token do cartão no broker e ativa imediatamente
      // O creditCardToken permite cobranças avulsas futuras (excedente) sem pedir o cartão novamente.
      const creditCardToken = subscription.creditCard?.creditCardToken || '';
      await supabase.from('brokers')
        .update({
          asaas_subscription_id: subscription.id,
          ...(creditCardToken ? { asaas_credit_card_token: creditCardToken } : {})
        })
        .eq('id', brokerId);

      await handleAsaasPaymentReceived({
        id: firstPayment.id,
        customerId,
        value: firstPayment.value,
        brokerId,
        subscriptionId: subscription.id
      });

      res.json({ success: true, paymentId: firstPayment.id, subscriptionId: subscription.id });
    } catch (err: any) {
      console.error("Erro no checkout Asaas:", err);
      res.status(400).json({ error: err.message });
    }
  });

  // Retorna status da assinatura do corretor
  app.get("/api/subscription", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      let { data: broker } = await supabase.from('brokers')
        .select('status, plan, valid_until, grace_until, zpro_tenant_id, zpro_channel_id, zpro_qr_code, is_admin')
        .eq('id', brokerId).single();

      // Admin tem acesso vitalício — nunca bloquear por assinatura
      if (broker?.is_admin) {
        return res.json({ broker: { ...broker, status: 'ativo' }, lastSubscription: null });
      }

      // Enforcement lazy do grace period: se passou de grace_until e ainda está
      // 'ativo', suspende o acesso agora (cobre PAYMENT_OVERDUE sem cron job).
      if (broker?.status === 'ativo' && broker?.grace_until && new Date(broker.grace_until) < new Date()) {
        await supabase.from('brokers').update({ status: 'inativo' }).eq('id', brokerId);
        broker = { ...broker, status: 'inativo' };
      }

      const { data: lastSub } = await supabase.from('subscriptions')
        .select('*').eq('broker_id', brokerId)
        .order('created_at', { ascending: false }).limit(1).single();

      res.json({ broker, lastSubscription: lastSub });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retorna os últimos atendimentos (ticket_events) do corretor para o dashboard
  app.get("/api/tickets/recent", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });
      const { data, error } = await supabase
        .from("ticket_events")
        .select("id, zpro_ticket_id, created_at")
        .eq("broker_id", brokerId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retorna o consumo de atendimentos do ciclo atual e histórico de cobranças de excedente
  app.get("/api/billing/usage", requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('valid_until').eq('id', brokerId).single();

      // Início do ciclo atual = valid_until - 1 mês
      const periodEnd   = broker?.valid_until ? new Date(broker.valid_until) : new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);

      const [{ count: ticketsRaw }, { data: adjData }] = await Promise.all([
        supabase.from('ticket_events')
          .select('id', { count: 'exact', head: true })
          .eq('broker_id', brokerId)
          .gte('created_at', periodStart.toISOString())
          .lt('created_at', periodEnd.toISOString()),
        supabase.from('ticket_adjustments')
          .select('amount, type')
          .eq('broker_id', brokerId)
          .gte('period_start', periodStart.toISOString())
      ]);

      // bonus → aumenta o limite incluso (gratuito para o cliente)
      // charge → vai direto para excedente, independente do plano (admin cobra manualmente)
      const bonusAdj          = (adjData ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
      const chargeAdj         = (adjData ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
      const ticketsUsed       = ticketsRaw ?? 0;
      const effectiveIncluded = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + bonusAdj);
      const regularOverage    = Math.max(0, ticketsUsed - effectiveIncluded);
      const overage           = regularOverage + Math.max(0, chargeAdj);
      const overageAmount     = overage * PLAN_OVERAGE_PRICE;

      // Histórico das últimas 6 cobranças de excedente
      const { data: history } = await supabase.from('overage_charges')
        .select('billing_period_start, billing_period_end, tickets_total, tickets_overage, amount_cents, status, charged_at')
        .eq('broker_id', brokerId)
        .order('billing_period_end', { ascending: false })
        .limit(6);

      res.json({
        current_period: {
          start:                    periodStart.toISOString(),
          end:                      periodEnd.toISOString(),
          tickets_used:             ticketsUsed,
          tickets_included:         effectiveIncluded,
          tickets_included_base:    PLAN_INCLUDED_TICKETS,
          tickets_bonus:            Math.max(0, bonusAdj),
          tickets_charge_adj:       Math.max(0, chargeAdj),
          tickets_remaining:        Math.max(0, effectiveIncluded - ticketsUsed),
          overage_tickets:          overage,
          overage_amount:           overageAmount,
          overage_price_per_ticket: PLAN_OVERAGE_PRICE,
        },
        history: history ?? [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Envio de mensagem WhatsApp via N8N ─────────────────────────────────
  // Autenticação: Authorization: Bearer <INTERNAL_PROXY_TOKEN>
  // Body: { brokerPhone, clientPhone, message, mediaUrl? }
  app.post("/api/whatsapp/send", async (req, res) => {
    const auth = req.headers.authorization?.replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: 'Token inválido.' });
    }

    const { brokerPhone, clientPhone, message, mediaUrl } = req.body;
    if (!brokerPhone || !clientPhone || !message) {
      return res.status(400).json({ error: 'brokerPhone, clientPhone e message são obrigatórios.' });
    }

    try {
      const normalizedBroker = normalizePhoneBR(brokerPhone);
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, name, zpro_api_url, zpro_api_key, zpro_api_token, zpro_channel_id')
        .eq('phone', normalizedBroker)
        .single();

      if (!broker?.zpro_api_url || !broker?.zpro_api_token) {
        return res.status(404).json({ error: 'Corretor não encontrado ou WhatsApp não configurado.' });
      }

      const zpro_headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${broker.zpro_api_token}`
      };

      const toNumber = normalizePhoneBR(clientPhone);

      // Envia via Z-PRO v2 External API
      let zpro_body: any;
      let endpoint: string;

      if (mediaUrl) {
        endpoint = `${broker.zpro_api_url}/messages/send-media`;
        zpro_body = { number: toNumber, mediaUrl, caption: message };
      } else {
        endpoint = `${broker.zpro_api_url}/messages/send-text`;
        zpro_body = { number: toNumber, text: message };
      }

      const zpro_res = await fetch(endpoint, {
        method: 'POST',
        headers: zpro_headers,
        body: JSON.stringify(zpro_body)
      });

      if (!zpro_res.ok) {
        const err = await zpro_res.text();
        console.error(`[WPP Send] Z-PRO error: ${err}`);
        return res.status(502).json({ error: 'Falha ao enviar via Z-PRO.', detail: err });
      }

      const result = await zpro_res.json().catch(() => ({}));
      console.log(`[WPP Send] broker=${broker.id} → ${toNumber}`);
      res.json({ success: true, result });
    } catch (err: any) {
      console.error('[WPP Send] erro:', err?.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook do Asaas — confirmação de pagamento, cancelamento
  app.post("/api/webhooks/asaas", webhookLimiter, async (req, res) => {
    // Verifica token de acesso enviado pelo Asaas no header (configurado em Asaas → Webhooks).
    // Se ASAAS_WEBHOOK_TOKEN não estiver definido no ambiente, a verificação é pulada
    // para manter compatibilidade com o sandbox de desenvolvimento.
    if (ASAAS_WEBHOOK_TOKEN) {
      const incoming = req.headers['asaas-access-token'];
      if (incoming !== ASAAS_WEBHOOK_TOKEN) {
        console.warn(`[Webhook] token inválido — origin: ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const event = req.body;

    await supabase.from('webhook_logs').insert({
      source: 'asaas',
      event_type: event.event,
      payload: event,
      status: 'received'
    });

    if (event.event === 'PAYMENT_RECEIVED' || event.event === 'PAYMENT_CONFIRMED') {
      const p = event.payment;
      const { data: broker } = await supabase.from('brokers')
        .select('id, asaas_subscription_id').eq('asaas_customer_id', p.customer).single();
      if (broker) {
        await handleAsaasPaymentReceived({
          id: p.id,
          customerId: p.customer,
          value: p.value,
          brokerId: broker.id,
          subscriptionId: p.subscription || broker.asaas_subscription_id || undefined,
          isRenewal: true  // webhook = cobrança de renovação → calcula excedente do ciclo encerrado
        });
      }
    } else if (event.event === 'PAYMENT_OVERDUE') {
      // Inadimplência: NÃO bloqueia na hora — concede grace period de 3 dias.
      // A suspensão efetiva é aplicada lazy em GET /api/subscription quando grace_until expira.
      const p = event.payment;
      const graceUntil = new Date();
      graceUntil.setDate(graceUntil.getDate() + 3);
      await supabase.from('brokers')
        .update({ grace_until: graceUntil.toISOString() })
        .eq('asaas_customer_id', p.customer);
      await supabase.from('subscriptions').update({ status: 'overdue' }).eq('asaas_payment_id', p.id);
    } else if (event.event === 'PAYMENT_DELETED') {
      const p = event.payment;
      await supabase.from('brokers').update({ status: 'inativo' }).eq('asaas_customer_id', p.customer);
      await supabase.from('subscriptions').update({ status: 'cancelled' }).eq('asaas_payment_id', p.id);
    } else if (
      event.event === 'SUBSCRIPTION_DELETED' ||
      event.event === 'SUBSCRIPTION_INACTIVATED' ||
      event.event === 'SUBSCRIPTION_CANCELED'
    ) {
      // Assinatura cancelada → desativa o corretor e marca o tenant Z-PRO como desativado.
      const sub = event.subscription || event.payment;
      const subId = sub?.id || sub?.subscription;
      if (subId) {
        await supabase.from('brokers')
          .update({ status: 'inativo', provisioning_status: 'disabled' })
          .eq('asaas_subscription_id', subId);
      }
    }

    res.json({ received: true });
  });

  // Rejeita métodos não-POST no endpoint de webhook
  app.all("/api/webhooks/asaas", (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed' });
  });

  // Endpoint de teste — simula ativação sem Asaas (apenas dev)
  app.post("/api/webhooks/asaas/test", async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: "Não disponível em produção." });
    }
    const { broker_id } = req.body;
    if (!broker_id) return res.status(400).json({ error: "broker_id obrigatório." });

    await handleAsaasPaymentReceived({
      id: `pay_test_${Date.now()}`,
      customerId: `cus_test_${Date.now()}`,
      value: 1.00,
      brokerId: broker_id
    });
    res.json({ success: true, message: "Corretor ativado via teste." });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAINEL ADMIN
  // ─────────────────────────────────────────────────────────────────────────

  async function requireAdmin(req: any, res: any): Promise<boolean> {
    const userId = await verifyAccessToken(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return false; }
    req.userId = userId;
    const { data } = await supabase.from('brokers').select('is_admin').eq('user_id', userId).single();
    if (!data?.is_admin) { res.status(403).json({ error: "Acesso negado" }); return false; }
    return true;
  }

  // Lista todos os corretores com dados de assinatura
  app.get("/api/admin/brokers", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, email, phone, status, plan, valid_until, created_at, is_admin, asaas_customer_id, zpro_tenant_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Métricas globais da plataforma
  app.get("/api/admin/metrics", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const [brokersRes, propertiesRes, leadsRes, activeRes, revenueRes] = await Promise.all([
        supabase.from('brokers').select('id', { count: 'exact', head: true }),
        supabase.from('properties').select('id', { count: 'exact', head: true }),
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase.from('subscriptions').select('amount').eq('status', 'paid')
      ]);
      const totalRevenue = (revenueRes.data || []).reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
      res.json({
        totalBrokers: brokersRes.count || 0,
        activeBrokers: activeRes.count || 0,
        totalProperties: propertiesRes.count || 0,
        totalLeads: leadsRes.count || 0,
        totalRevenueCents: totalRevenue
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ativar ou bloquear um corretor
  app.patch("/api/admin/brokers/:id/status", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const { status } = req.body;
    if (!['ativo', 'pendente', 'bloqueado'].includes(status)) {
      return res.status(400).json({ error: "Status inválido" });
    }
    try {
      const { data, error } = await supabase
        .from('brokers').update({ status }).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Detalhes de um corretor (imóveis, leads, assinaturas)
  app.get("/api/admin/brokers/:id", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const [brokerRes, propsRes, subsRes] = await Promise.all([
        supabase.from('brokers').select('*').eq('id', req.params.id).single(),
        supabase.from('properties').select('id, title, status, created_at').eq('broker_id', req.params.id).order('created_at', { ascending: false }),
        supabase.from('subscriptions').select('*').eq('broker_id', req.params.id).order('created_at', { ascending: false })
      ]);
      if (brokerRes.error) throw brokerRes.error;
      res.json({
        broker: brokerRes.data,
        properties: propsRes.data || [],
        subscriptions: subsRes.data || []
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Disparo manual de provisionamento Z-PRO (admin)
  // Segue a mesma rota do usuário normal pós-pagamento:
  //   1. Garante status=ativo + valid_until (preserva 2099 se já estiver configurado)
  //   2. Chama createZproTenantAndChannel (cria tenant + sessão WhatsApp)
  app.post("/api/admin/brokers/:id/provision", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data: broker } = await supabase
        .from('brokers').select('*').eq('id', req.params.id).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

      // Garante que o corretor está ativo antes de provisionar
      // Preserva valid_until já definido (ex: 2099) ou define +1 mês
      const currentValidUntil = broker.valid_until ? new Date(broker.valid_until) : null;
      const needsValidUntil = !currentValidUntil || currentValidUntil < new Date();
      if (needsValidUntil) {
        const validUntil = new Date();
        validUntil.setMonth(validUntil.getMonth() + 1);
        await supabase.from('brokers').update({
          status: 'ativo',
          plan: broker.plan || 'mensal',
          valid_until: validUntil.toISOString()
        }).eq('id', broker.id);
        broker.status = 'ativo';
        broker.valid_until = validUntil.toISOString();
      } else if (broker.status !== 'ativo') {
        await supabase.from('brokers').update({ status: 'ativo' }).eq('id', broker.id);
        broker.status = 'ativo';
      }

      // Executa o mesmo fluxo de provisionamento Z-PRO do pós-pagamento
      if (!ZPRO_ADMIN_URL || !ZPRO_ADMIN_TOKEN) {
        return res.status(503).json({ error: 'Z-PRO não configurado.' });
      }

      await createZproTenantAndChannel(broker);

      res.json({ success: true, message: 'Tenant Z-PRO provisionado com sucesso.' });
    } catch (err: any) {
      console.error('[Provision] erro:', err?.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza credenciais Z-PRO de um corretor (usado enquanto ZPRO_API_SECRET não configurado)
  // Body: { zpro_api_key, zpro_api_token, zpro_api_url? }
  app.patch("/api/admin/brokers/:id/zpro-credentials", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const { zpro_api_key, zpro_api_token, zpro_api_url } = req.body;
    if (!zpro_api_key || !zpro_api_token) {
      return res.status(400).json({ error: 'zpro_api_key e zpro_api_token são obrigatórios' });
    }
    const url = zpro_api_url || `${ZPRO_ADMIN_URL}/v2/api/external/${zpro_api_key}`;
    const { error } = await supabase.from('brokers').update({
      zpro_api_key: String(zpro_api_key),
      zpro_api_url: url,
      zpro_api_token: String(zpro_api_token)
    }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    console.log(`[Admin] zpro-credentials atualizados para broker ${req.params.id}`);
    res.json({ success: true, zpro_api_key, zpro_api_url: url });
  });

  // Cancelar plano (mantém valid_until, cancela no Asaas)
  app.post("/api/admin/brokers/:id/cancel-plan", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data: broker } = await supabase
        .from('brokers').select('asaas_subscription_id, asaas_customer_id, name').eq('id', req.params.id).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

      // Cancela assinatura no Asaas se existir
      if (broker.asaas_subscription_id && ASAAS_API_KEY) {
        await fetch(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
          method: 'POST',
          headers: asaasHeaders()
        }).catch(e => console.warn('[Asaas] cancel sub falhou:', e?.message));
      }

      // Marca corretor como cancelado — acesso mantido até valid_until (cronjob/webhook vai expirar)
      await supabase.from('brokers').update({ status: 'bloqueado' }).eq('id', req.params.id);

      // Log admin
      const adminId = (req as any).userId;
      console.log(`[ADMIN] Plano cancelado: broker=${req.params.id} por user=${adminId}`);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Excluir conta de corretor
  app.delete("/api/admin/brokers/:id", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data: broker } = await supabase
        .from('brokers').select('user_id, asaas_subscription_id').eq('id', req.params.id).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

      // 1. Cancela assinatura no Asaas
      if (broker.asaas_subscription_id && ASAAS_API_KEY) {
        await fetch(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
          method: 'POST', headers: asaasHeaders()
        }).catch(() => {});
      }

      // 2. Remove dados do corretor (cascade deve limpar propriedades/leads via FK)
      await supabase.from('brokers').delete().eq('id', req.params.id);

      // 3. Remove usuário do Supabase Auth (invalida login)
      if (broker.user_id) {
        await supabase.auth.admin.deleteUser(broker.user_id).catch(e =>
          console.warn('[Admin] deleteUser falhou:', e?.message)
        );
      }

      const adminId = (req as any).userId;
      console.log(`[ADMIN] Conta excluída: broker=${req.params.id} por user=${adminId}`);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Consulta consumo de atendimentos de um corretor (período atual)
  app.get("/api/admin/brokers/:id/ticket-usage", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const brokerId = req.params.id;
      const { data: broker } = await supabase.from('brokers')
        .select('valid_until, name').eq('id', brokerId).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

      const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);

      const [{ count: ticketsRaw }, { data: adjData }] = await Promise.all([
        supabase.from('ticket_events')
          .select('id', { count: 'exact', head: true })
          .eq('broker_id', brokerId)
          .gte('created_at', periodStart.toISOString())
          .lt('created_at', periodEnd.toISOString()),
        // SEM filtro de período: admin vê e pode estornar qualquer ajuste da história
        supabase.from('ticket_adjustments')
          .select('id, amount, type, reason, created_at, period_start')
          .eq('broker_id', brokerId)
          .order('created_at', { ascending: false })
      ]);

      // Totais históricos (sem filtro de período) — base para elegibilidade de estorno
      const bonusAdj          = (adjData ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
      const chargeAdj         = (adjData ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
      // Limite efetivo usa apenas ajustes do período corrente para cálculo de cobrança
      const periodBonusAdj    = (adjData ?? []).filter((a: any) => a.type === 'bonus' && a.period_start >= periodStart.toISOString()).reduce((s: number, a: any) => s + a.amount, 0);
      const effectiveIncluded = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + periodBonusAdj);
      const ticketsUsed       = ticketsRaw ?? 0;

      res.json({
        broker_name:              broker.name,
        period_start:             periodStart.toISOString(),
        period_end:               periodEnd.toISOString(),
        tickets_used:             ticketsUsed,
        tickets_raw:              ticketsRaw ?? 0,
        tickets_included_base:    PLAN_INCLUDED_TICKETS,
        tickets_bonus:            Math.max(0, bonusAdj),     // total histórico para estorno
        tickets_charge_adj:       Math.max(0, chargeAdj),    // total histórico para estorno
        tickets_included:         effectiveIncluded,
        overage_price_per_ticket: PLAN_OVERAGE_PRICE,
        adjustments:              adjData ?? [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ajuste manual de atendimentos de um corretor (período atual)
  app.post("/api/admin/brokers/:id/ticket-adjustment", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const adminId  = (req as any).userId;
    const brokerId = req.params.id;

    const amount = parseInt(req.body?.amount, 10);
    const type   = String(req.body?.type || 'bonus');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);

    if (!Number.isInteger(amount) || amount === 0) {
      return res.status(400).json({ error: 'amount deve ser um inteiro diferente de zero' });
    }
    if (!['bonus', 'charge'].includes(type)) {
      return res.status(400).json({ error: 'type deve ser "bonus" ou "charge"' });
    }
    try {
      const { data: broker } = await supabase.from('brokers')
        .select('valid_until').eq('id', brokerId).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

      const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);

      // Negativo: estorno de qualquer ajuste histórico (sem filtro de período)
      if (amount < 0) {
        const { data: existing } = await supabase.from('ticket_adjustments')
          .select('amount')
          .eq('broker_id', brokerId)
          .eq('type', type);
        const historicTotal = (existing ?? []).reduce((s: number, a: any) => s + a.amount, 0);
        if (historicTotal + amount < 0) {
          return res.status(400).json({
            error: `${type === 'bonus' ? 'Bônus' : 'Cobrança'} total histórico: +${historicTotal}. Estorno máximo: ${historicTotal}. Não é possível estornar mais do que foi lançado.`,
            current_total: historicTotal,
          });
        }
      }

      const { data, error } = await supabase.from('ticket_adjustments').insert({
        broker_id:    brokerId,
        amount,
        type,
        reason:       reason || null,
        admin_id:     adminId,
        period_start: periodStart.toISOString(),
        period_end:   periodEnd.toISOString(),
      }).select().single();
      if (error) throw error;

      console.log(`[ADMIN] Ajuste tickets: broker=${brokerId} type=${type} amount=${amount>0?'+':''}${amount} por admin=${adminId}`);
      res.json({ success: true, adjustment: data });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FUNÇÕES DE AUTOMAÇÃO — ATIVAÇÃO E Z-PRO
  // ─────────────────────────────────────────────────────────────────────────

  async function handleAsaasPaymentReceived({ id, customerId, value, brokerId, subscriptionId, isRenewal = false }: {
    id: string; customerId: string; value: number; brokerId: string; subscriptionId?: string; isRenewal?: boolean;
  }) {
    try {
      // Captura valid_until ANTES de atualizar — necessário para delimitar o ciclo encerrado
      const { data: brokerBefore } = await supabase.from('brokers')
        .select('valid_until, asaas_credit_card_token').eq('id', brokerId).single();

      const validUntil = new Date();
      validUntil.setMonth(validUntil.getMonth() + 1);

      const brokerUpdate: any = {
        status: 'ativo',
        asaas_customer_id: customerId,
        plan: 'mensal',
        valid_until: validUntil.toISOString(),
        grace_until: null   // pagamento confirmado limpa inadimplência/grace
      };
      if (subscriptionId) brokerUpdate.asaas_subscription_id = subscriptionId;

      await supabase.from('brokers').update(brokerUpdate).eq('id', brokerId);

      // Processa excedente do ciclo encerrado (apenas em renovações)
      if (isRenewal && brokerBefore?.valid_until && subscriptionId) {
        const periodEnd = new Date(brokerBefore.valid_until);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        if (periodEnd >= sevenDaysAgo) {
          // Verifica se prepareOverageBilling() já embutiu o excedente na assinatura
          const windowStart = new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString();
          const windowEnd   = new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString();
          const { data: scheduled } = await supabase.from('overage_charges')
            .select('id, tickets_overage, amount_cents')
            .eq('broker_id', brokerId)
            .eq('status', 'scheduled_in_subscription')
            .gte('billing_period_end', windowStart)
            .lte('billing_period_end', windowEnd)
            .maybeSingle();

          if (scheduled) {
            // Caminho normal: excedente já estava embutido no valor da cobrança — marcar como pago
            await supabase.from('overage_charges')
              .update({ status: 'included_in_subscription', charged_at: new Date().toISOString() })
              .eq('id', scheduled.id);
            // Reseta subscription de volta ao valor base para o próximo ciclo
            fetch(`${ASAAS_BASE_URL}/subscriptions/${subscriptionId}`, {
              method: 'PUT',
              headers: asaasHeaders(),
              body: JSON.stringify({ value: SUBSCRIPTION_VALUE, description: 'Criate — Plano mensal' })
            }).catch(e => console.error('[Billing] falha ao resetar subscription:', e.message));
            console.log(`[Billing] excedente de ${scheduled.tickets_overage} tickets já incluído na renovação — ${brokerId}`);
          } else if (brokerBefore?.asaas_credit_card_token) {
            // Fallback: job de preparo não rodou (ex: servidor estava offline) → cobrança separada
            await chargeOverageIfDue(brokerId, periodEnd, customerId, brokerBefore.asaas_credit_card_token);
          }
        }
      }

      await supabase.from('subscriptions').insert({
        broker_id: brokerId,
        asaas_payment_id: id,
        asaas_customer_id: customerId,
        plan: 'mensal',
        amount: Math.round(value * 100),
        currency: 'brl',
        status: 'paid',
        paid_at: new Date().toISOString(),
        valid_until: validUntil.toISOString()
      });

      const { data: broker } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (!broker) return;

      if (ZPRO_ADMIN_URL && ZPRO_ADMIN_TOKEN) {
        // Trava atômica: só provisiona se status NÃO for 'completed' nem 'processing'.
        // Evita criação duplicada quando Asaas dispara o mesmo evento 2x.
        const { data: locked } = await supabase.from('brokers')
          .update({ provisioning_status: 'processing' })
          .eq('id', brokerId)
          .neq('provisioning_status', 'completed')
          .neq('provisioning_status', 'processing')
          .select('id');
        if (!locked?.length) {
          console.log(`[Z-PRO] Provisionamento já em andamento/concluído para ${brokerId} — webhook duplicado ignorado`);
          return;
        }
        await createZproTenantAndChannel({ ...broker, provisioning_status: 'processing' });
      }

      console.log(`✅ Corretor ${brokerId} ativado — Asaas ${id}`);
    } catch (err: any) {
      console.error("Erro ao ativar corretor:", err);
    }
  }

  // ─── Cobrança de excedente de atendimentos ────────────────────────────────
  // Chamada na renovação mensal (handleAsaasPaymentReceived com isRenewal=true).
  // Conta os tickets do ciclo encerrado, cobra R$ PLAN_OVERAGE_PRICE por ticket
  // acima de PLAN_INCLUDED_TICKETS diretamente no cartão já cadastrado via token.
  // Idempotente: se já existe registro para o mesmo período, não cobra novamente.
  async function chargeOverageIfDue(
    brokerId: string,
    periodEnd: Date,
    asaasCustomerId: string,
    creditCardToken: string
  ): Promise<void> {
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    // Idempotência: verifica se já existe cobrança para este período (±12h de tolerância)
    const windowStart = new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const windowEnd   = new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase.from('overage_charges')
      .select('id, status')
      .eq('broker_id', brokerId)
      .gte('billing_period_end', windowStart)
      .lte('billing_period_end', windowEnd)
      .neq('status', 'failed')
      .maybeSingle();

    if (existing) {
      console.log(`[Overage] período ${periodEnd.toISOString().slice(0,10)} já processado (${existing.status}) — ${brokerId}`);
      return;
    }

    // Conta tickets no período encerrado
    const { count } = await supabase.from('ticket_events')
      .select('id', { count: 'exact', head: true })
      .eq('broker_id', brokerId)
      .gte('created_at', periodStart.toISOString())
      .lt('created_at', periodEnd.toISOString());

    const totalTickets = count ?? 0;
    const overage      = Math.max(0, totalTickets - PLAN_INCLUDED_TICKETS);
    const amountCents  = Math.round(overage * PLAN_OVERAGE_PRICE * 100);

    console.log(`[Overage] ${brokerId} — ${totalTickets} tickets (${overage} excedentes, R$ ${(amountCents / 100).toFixed(2)})`);

    // Sem excedente: registra apenas para auditoria
    if (overage === 0) {
      await supabase.from('overage_charges').insert({
        broker_id: brokerId,
        billing_period_start: periodStart.toISOString(),
        billing_period_end:   periodEnd.toISOString(),
        tickets_total:   totalTickets,
        tickets_included: PLAN_INCLUDED_TICKETS,
        tickets_overage: 0,
        price_per_ticket: PLAN_OVERAGE_PRICE,
        amount_cents: 0,
        status: 'no_charge',
      });
      return;
    }

    // Insere registro 'pending' ANTES de chamar o Asaas (garante idempotência em retries)
    const { data: chargeRow } = await supabase.from('overage_charges').insert({
      broker_id: brokerId,
      billing_period_start: periodStart.toISOString(),
      billing_period_end:   periodEnd.toISOString(),
      tickets_total:    totalTickets,
      tickets_included: PLAN_INCLUDED_TICKETS,
      tickets_overage:  overage,
      price_per_ticket: PLAN_OVERAGE_PRICE,
      amount_cents:     amountCents,
      status: 'pending',
    }).select('id').single();

    try {
      const amount = amountCents / 100;
      const dueDate = new Date().toISOString().split('T')[0];
      const description =
        `Criate — Excedente ${overage} atendimento${overage > 1 ? 's' : ''} ` +
        `(${periodStart.toISOString().slice(0,10)} a ${periodEnd.toISOString().slice(0,10)}) ` +
        `× R$ ${PLAN_OVERAGE_PRICE.toFixed(2)}`;

      const payResp = await fetch(`${ASAAS_BASE_URL}/payments`, {
        method: 'POST',
        headers: asaasHeaders(),
        body: JSON.stringify({
          customer: asaasCustomerId,
          billingType: 'CREDIT_CARD',
          value: amount,
          dueDate,
          description,
          creditCardToken,
        })
      });

      const payment = await payResp.json();
      if (!payResp.ok) {
        throw new Error(payment.errors?.[0]?.description || payment.message || 'Falha na cobrança Asaas');
      }

      await supabase.from('overage_charges').update({
        status: 'charged',
        asaas_payment_id: payment.id,
        charged_at: new Date().toISOString(),
      }).eq('id', chargeRow?.id);

      console.log(`[Overage] ✅ R$ ${amount.toFixed(2)} cobrado — payment ${payment.id} — ${brokerId}`);
    } catch (err: any) {
      await supabase.from('overage_charges').update({
        status: 'failed',
        error: err.message,
      }).eq('id', chargeRow?.id);
      // Falha na cobrança de excedente não deve derrubar o fluxo principal de renovação
      console.error(`[Overage] ❌ falha ao cobrar excedente ${brokerId}:`, err.message);
    }
  }

  // ─── Preparo de billing consolidado (roda a cada hora) ───────────────────
  // Para cada corretor cuja renovação é amanhã, calcula o excedente do ciclo
  // atual e atualiza o valor da assinatura no Asaas ANTES que ela seja cobrada.
  // Assim o corretor recebe UMA cobrança = mensalidade + excedente (se houver).
  // Quando o webhook de renovação chega, handleAsaasPaymentReceived reseta o
  // valor de volta ao base e marca o registro como 'included_in_subscription'.
  async function prepareOverageBilling(): Promise<void> {
    if (!ASAAS_API_KEY) return;

    const now = new Date();
    // Janela: corretores com valid_until nas próximas 20-28 horas
    // (evita preparar muito cedo ou deixar passar)
    const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 28 * 60 * 60 * 1000);

    const { data: brokers } = await supabase.from('brokers')
      .select('id, asaas_subscription_id, valid_until')
      .eq('status', 'ativo')
      .gte('valid_until', windowStart.toISOString())
      .lte('valid_until', windowEnd.toISOString())
      .not('asaas_subscription_id', 'is', null);

    if (!brokers?.length) return;
    console.log(`[Billing Prep] ${brokers.length} corretor(es) com renovação amanhã`);

    for (const broker of brokers) {
      try {
        const periodEnd   = new Date(broker.valid_until);
        const periodStart = new Date(periodEnd);
        periodStart.setMonth(periodStart.getMonth() - 1);

        // Idempotência: não preparar duas vezes o mesmo ciclo
        const { data: alreadyDone } = await supabase.from('overage_charges')
          .select('id')
          .eq('broker_id', broker.id)
          .in('status', ['scheduled_in_subscription', 'included_in_subscription', 'no_charge'])
          .gte('billing_period_end', new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString())
          .lte('billing_period_end', new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString())
          .maybeSingle();

        if (alreadyDone) continue;

        const [{ count }, { data: adjRows }] = await Promise.all([
          supabase.from('ticket_events')
            .select('id', { count: 'exact', head: true })
            .eq('broker_id', broker.id)
            .gte('created_at', periodStart.toISOString())
            .lt('created_at', periodEnd.toISOString()),
          supabase.from('ticket_adjustments')
            .select('amount, type')
            .eq('broker_id', broker.id)
            .gte('period_start', periodStart.toISOString())
        ]);

        const bonusAdj      = (adjRows ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
        const chargeAdj     = (adjRows ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
        const totalTickets  = count ?? 0;
        const effectiveLim  = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + bonusAdj);
        const regularOver   = Math.max(0, totalTickets - effectiveLim);
        const overage       = regularOver + Math.max(0, chargeAdj);
        const overageAmount = overage * PLAN_OVERAGE_PRICE;
        const totalValue    = SUBSCRIPTION_VALUE + overageAmount;

        const description = overage > 0
          ? `Criate — Plano mensal + ${overage} atendimento${overage > 1 ? 's' : ''} excedente${overage > 1 ? 's' : ''} × R$ ${PLAN_OVERAGE_PRICE.toFixed(2)}`
          : 'Criate — Plano mensal';

        // Atualiza valor da assinatura no Asaas para o próximo ciclo
        const upResp = await fetch(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}`, {
          method: 'PUT',
          headers: asaasHeaders(),
          body: JSON.stringify({ value: totalValue, description })
        });

        if (!upResp.ok) {
          const err = await upResp.json().catch(() => ({}));
          console.error(`[Billing Prep] falha ao atualizar subscription ${broker.asaas_subscription_id}:`, err);
          continue;
        }

        await supabase.from('overage_charges').insert({
          broker_id:            broker.id,
          billing_period_start: periodStart.toISOString(),
          billing_period_end:   periodEnd.toISOString(),
          tickets_total:        totalTickets,
          tickets_included:     PLAN_INCLUDED_TICKETS,
          tickets_overage:      overage,
          price_per_ticket:     PLAN_OVERAGE_PRICE,
          amount_cents:         Math.round(overageAmount * 100),
          status:               overage > 0 ? 'scheduled_in_subscription' : 'no_charge',
        });

        console.log(`[Billing Prep] ✅ ${broker.id} — R$ ${totalValue.toFixed(2)} (${overage} excedentes) agendado`);
      } catch (err: any) {
        console.error(`[Billing Prep] erro para ${broker.id}:`, err.message);
      }
    }
  }

  function generateSecurePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd + 'A1!';
  }

  function buildZproUsername(broker: any): string {
    const base = (broker.email || broker.id || 'corretor')
      .split('@')[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 16);
    const suffix = String(broker.id || '').replace(/-/g, '').slice(0, 4);
    return `${base}${suffix}`;
  }

  async function fireProvisioningWebhook(payload: any) {
    if (!PROVISIONING_WEBHOOK_URL) return;
    try {
      const resp = await fetch(PROVISIONING_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await supabase.from('webhook_logs').insert({
        source: 'provisioning_webhook',
        event_type: resp.ok ? 'webhook_delivered' : 'webhook_failed',
        payload: { url: PROVISIONING_WEBHOOK_URL, status: resp.status, body: payload },
        status: resp.ok ? 'processed' : 'error',
        broker_id: payload.broker?.id || null
      });
    } catch (err: any) {
      await supabase.from('webhook_logs').insert({
        source: 'provisioning_webhook',
        event_type: 'webhook_failed',
        payload: { url: PROVISIONING_WEBHOOK_URL, error: err.message, body: payload },
        status: 'error',
        broker_id: payload.broker?.id || null
      });
    }
  }

  // ─── Z-PRO REST API (nova versão — app.criate.online) ────────────────────────
  // Endpoint raiz confirmado pelo usuário: POST /tenants
  // Todos os endpoints seguem o padrão REST; logs detalhados para cada chamada.

  async function zproPost(path: string, body: any, token?: string): Promise<{ ok: boolean; status: number; raw: string; json: any }> {
    const authToken = token || await getZproAdminToken();
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
    try {
      const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
      const raw = await r.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* raw não é JSON */ }
      console.log(`[Z-PRO] POST ${path} → ${r.status} | body=${raw.slice(0, 300)}`);
      return { ok: r.ok, status: r.status, raw, json };
    } catch (e: any) {
      console.error(`[Z-PRO] POST ${path} exception:`, e.message);
      return { ok: false, status: 0, raw: e.message, json: null };
    }
  }

  async function zproPut(path: string, body: any, token?: string): Promise<{ ok: boolean; status: number; raw: string }> {
    const authToken = token || await getZproAdminToken();
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
    try {
      const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'PUT', headers: hdrs, body: JSON.stringify(body) });
      const raw = await r.text();
      console.log(`[Z-PRO] PUT ${path} → ${r.status} | body=${raw.slice(0, 200)}`);
      return { ok: r.ok, status: r.status, raw };
    } catch (e: any) {
      console.error(`[Z-PRO] PUT ${path} exception:`, e.message);
      return { ok: false, status: 0, raw: e.message };
    }
  }

  async function zproGet(path: string, token?: string): Promise<{ ok: boolean; status: number; raw: string; json: any }> {
    const authToken = token || await getZproAdminToken();
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
    try {
      const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'GET', headers: hdrs });
      const raw = await r.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* raw não é JSON */ }
      console.log(`[Z-PRO] GET ${path} → ${r.status} | body=${raw.slice(0, 200)}`);
      return { ok: r.ok, status: r.status, raw, json };
    } catch (e: any) {
      console.error(`[Z-PRO] GET ${path} exception:`, e.message);
      return { ok: false, status: 0, raw: e.message, json: null };
    }
  }

  async function zproDelete(path: string, token?: string): Promise<{ ok: boolean; status: number; raw: string }> {
    const authToken = token || await getZproAdminToken();
    const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
    try {
      const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'DELETE', headers: hdrs });
      const raw = await r.text();
      console.log(`[Z-PRO] DELETE ${path} → ${r.status}`);
      return { ok: r.ok, status: r.status, raw };
    } catch (e: any) {
      console.error(`[Z-PRO] DELETE ${path} exception:`, e.message);
      return { ok: false, status: 0, raw: e.message };
    }
  }

  // Configura n8nUrl no canal via PUT /whatsapp/:id (body mínimo — spread completo causa falha silenciosa).
  // Z-PRO retorna 500 mas salva o dado; verificamos com GET para confirmar.
  // Requer tenantToken: super admin token não salva n8nUrl neste endpoint.
  async function setN8nWebhook(
    tenantId: string | number,
    whatsappId: string | number,
    tenantToken?: string
  ): Promise<boolean> {
    if (!N8N_WEBHOOK_URL) return false;
    const wId = Number(whatsappId);
    const tId = Number(tenantId);

    const minimalBody = {
      id: wId,
      tenantId: tId,
      n8nUrl: N8N_WEBHOOK_URL,
      disableExternalIntegration: 'disabled',   // Habilitar IA
      waitProcessExternalInteraction: 'enabled' // Habilitar para todos os tickets
    };

    // Tenta com tenant token e super admin; ambos retornam 500 mas salvam — verificar via GET
    const candidates = tenantToken
      ? [{ label: 'tenantToken', tok: tenantToken }, { label: 'superAdmin', tok: await getZproAdminToken() }]
      : [{ label: 'superAdmin', tok: await getZproAdminToken() }];

    for (const { label, tok } of candidates) {
      await zproPut(`/whatsapp/${wId}`, minimalBody, tok); // ignora status — 500 pode salvar
      const check = await zproGet(`/whatsapp/${wId}`, tok);
      if (check.json?.n8nUrl === N8N_WEBHOOK_URL) {
        console.log(`[Z-PRO] n8nUrl+IA configurados via PUT /whatsapp/${wId} (${label})`);
        return true;
      }
    }

    console.warn('[Z-PRO] n8nUrl: não foi possível salvar — configure manualmente no painel Z-PRO');
    return false;
  }

  // Ativa Bots IA (N8N) no tenant via PUT /settings/:key com {key, value, tenantId}.
  // Endpoints confirmados: PUT /settings/n8n e PUT /settings/n8nAllTickets → 200.
  async function configureBotIA(tenantId: number, tenantToken: string): Promise<void> {
    for (const key of ['n8n', 'n8nAllTickets']) {
      const r = await zproPut(`/settings/${key}`, { key, value: 'enabled', tenantId }, tenantToken);
      if (r.ok) {
        console.log(`[Z-PRO] Setting ${key}=enabled configurado`);
      } else {
        console.warn(`[Z-PRO] Setting ${key} falhou: ${r.status} ${r.raw.slice(0, 100)}`);
      }
    }
  }

  // ── UAZAPI: configura webhook da instância apontando ao Z-PRO ─────────────────
  // CRÍTICO para o canal funcionar: sem esse webhook, as mensagens chegam na UAZAPI
  // mas NUNCA são entregues ao Z-PRO → canal conecta (CONNECTED) porém fica "Não ativado"
  // e não recebe mensagens nem direciona para o agente.
  // Padrão confirmado em 39/43 instâncias em produção: ${ZPRO_ADMIN_URL}/uazapi-webhook/${instanceId}
  // (Z-PRO identifica o canal pelo instanceId na URL, que é o mesmo valor salvo em wppUser.)
  // POST /webhook (header token = token da instância) atualiza o webhook existente — retorna 200.
  // Decoplado do POST /whatsappSession para NÃO disparar auto-connect (mensagem outbound, não inicia sessão).
  async function setUazapiWebhook(instanceToken: string, instanceId: string): Promise<boolean> {
    if (!UAZAPI_HOST || !ZPRO_ADMIN_URL || !instanceToken || !instanceId) {
      console.warn('[UAZAPI] setUazapiWebhook: parâmetros ausentes — pulando');
      return false;
    }
    const webhookUrl = `${ZPRO_ADMIN_URL}/uazapi-webhook/${instanceId}`;
    try {
      const r = await fetch(`${UAZAPI_HOST}/webhook`, {
        method: 'POST',
        headers: { token: instanceToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          enabled: true,
          events: ['messages', 'connection', 'wasSentByApi', 'messages_update', 'call', 'contacts', 'groups', 'history'],
          excludeMessages: [],
          addUrlEvents: false,
          addUrlTypesMessages: false
        })
      });
      const raw = await r.text();
      const ok = r.ok && raw.includes(webhookUrl);
      console.log(`[UAZAPI] webhook ${ok ? 'configurado ✓' : 'FALHOU'} (${r.status}) → ${webhookUrl}`);
      return ok;
    } catch (e: any) {
      console.warn('[UAZAPI] Exceção ao configurar webhook:', e.message);
      return false;
    }
  }

  // ── UAZAPI: cria instância e vincula ao canal Z-PRO ───────────────────────────
  // Fluxo descoberto via inspeção da API UAZAPI (criate.uazapi.com):
  //   1. POST /instance/create (header: admintoken) + body {name}
  //      → retorna { id: instanceId, token: instanceToken, instance: { id, token } }
  //   2a. PUT /whatsapp/:id com { tokenAPI } → salva "API Token" no painel (retorna 500 mas persiste)
  //   2b. PUT /whatsapp/:id com { wppUser }  → salva "Number ID (Instance ID)" (PUT separado — combinado não salva wppUser)
  //   3.  POST /webhook (UAZAPI) → registra webhook Z-PRO para entrega de mensagens (setUazapiWebhook)
  //   NOTA: NÃO chamamos POST /whatsappSession/:id aqui — chamá-lo no provisionamento
  //   causa auto-connect indesejado (canal fica em OPENING sem o usuário ter iniciado).
  //   O webhook é configurado direto na UAZAPI (não dispara connect), e o Z-PRO inicia
  //   a sessão automaticamente quando o usuário acessa o canal no painel e lê o QR.
  async function createUazapiInstanceForChannel(
    whatsappId: string | number, channelName: string, tenantToken?: string
  ): Promise<string | null> {
    if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
      console.warn('[UAZAPI] UAZAPI_HOST ou UAZAPI_TOKEN ausente — pulando criação de instância');
      return null;
    }

    // 1. Cria instância UAZAPI — extrai token e id da instância
    let instanceToken: string | null = null;
    let instanceId: string | null = null;
    try {
      const res = await fetch(`${UAZAPI_HOST}/instance/create`, {
        method: 'POST',
        headers: { 'admintoken': UAZAPI_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: channelName })
      });
      const json: any = await res.json().catch(() => null);
      instanceToken = json?.token ?? json?.instance?.token ?? null;
      instanceId    = json?.instance?.id ?? json?.id ?? null;
      console.log(`[UAZAPI] POST /instance/create "${channelName}": status=${res.status} instanceToken=${instanceToken?.slice(0,8) ?? 'null'} instanceId=${instanceId ?? 'null'}`);
      if (!instanceToken) {
        console.warn(`[UAZAPI] Criação de instância falhou: ${res.status} ${JSON.stringify(json)?.slice(0,200)}`);
        return null;
      }
    } catch (e: any) {
      console.warn('[UAZAPI] Exceção ao criar instância:', e.message);
      return null;
    }

    // 2a. Salva tokenAPI no canal Z-PRO (PUT retorna 500 mas persiste — padrão confirmado)
    // tokenAPI = "API Token" no painel Z-PRO UazApi
    await zproPut(`/whatsapp/${whatsappId}`, { tokenAPI: instanceToken }, tenantToken);
    const check1 = await zproGet(`/whatsapp/${whatsappId}`, tenantToken);
    const savedToken = check1.json?.tokenAPI;
    if (savedToken === instanceToken) {
      console.log(`[Z-PRO] tokenAPI salvo no canal ${whatsappId} ✓`);
    } else {
      console.warn(`[Z-PRO] tokenAPI NÃO confirmado — check=${savedToken?.slice(0,8)} esperado=${instanceToken.slice(0,8)}`);
    }

    // 2b. Salva o Number ID (Instance ID) no canal Z-PRO.
    // DESCOBERTA 2026-05-22 (via diff do PUT real do painel): o campo "Number ID (Instance ID)"
    // do painel Z-PRO UazApi grava na coluna `wabaId` — NÃO em `wppUser`.
    // Por isso o painel sempre mostrava vazio (escrevíamos em wppUser, a coluna errada).
    // wabaId é também o identificador que o Z-PRO usa p/ casar os eventos do webhook UAZAPI ao canal.
    // PUTs separados (envio combinado com tokenAPI não persiste de forma confiável — bug Z-PRO).
    if (instanceId) {
      // wabaId = "Number ID (Instance ID)" do painel — CRÍTICO p/ ativação e entrega de mensagens
      let wabaOk = false;
      for (const tok of [tenantToken, undefined]) { // tenta tenant token; fallback super admin
        await zproPut(`/whatsapp/${whatsappId}`, { wabaId: instanceId }, tok);
        const c = await zproGet(`/whatsapp/${whatsappId}`, tenantToken);
        if (c.json?.wabaId === instanceId) { wabaOk = true; break; }
      }
      console.log(`[Z-PRO] wabaId (Number ID=${instanceId}) ${wabaOk ? 'salvo ✓' : 'NÃO salvo ✗'} no canal ${whatsappId}`);

      // wppUser também (best-effort) — alguns fluxos internos do Z-PRO referenciam esse campo
      await zproPut(`/whatsapp/${whatsappId}`, { wppUser: instanceId }, tenantToken);
    } else {
      console.warn(`[Z-PRO] instanceId nulo — Number ID não pode ser salvo para canal ${whatsappId}. Verificar resposta UAZAPI.`);
    }

    // 3. Configura webhook UAZAPI → Z-PRO (entrega de mensagens).
    // Sem isso o canal conecta mas fica "Não ativado" e não recebe mensagens.
    if (instanceId) {
      await setUazapiWebhook(instanceToken, instanceId);
    }

    return instanceToken;
  }

  // Re-vincula instância UAZAPI ao canal Z-PRO: garante wppUser (Number ID) salvo
  // E o webhook UAZAPI→Z-PRO configurado, sem recriar a instância nem disparar connect.
  // Corrige canais provisionados antes da correção do webhook (sintoma: CONNECTED mas "Não ativado").
  // IMPORTANTE: lê o canal via LOGIN do tenant (token forjado com userId=0 dá ERR_AUTH_USER_NOT_FOUND;
  // super admin dá 500 em /whatsapp/:id de outro tenant — só o token de login do tenant funciona).
  app.post("/api/admin/brokers/:id/relink-uazapi", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data: broker } = await supabase
        .from('brokers').select('*').eq('id', req.params.id).single();
      if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });
      if (!broker.zpro_channel_id) return res.status(400).json({ error: 'Canal Z-PRO não configurado para este corretor.' });
      if (!UAZAPI_HOST || !UAZAPI_TOKEN) return res.status(503).json({ error: 'UAZAPI não configurado no servidor.' });

      const whatsappId = Number(broker.zpro_channel_id);
      const tenantId   = Number(broker.zpro_tenant_id) || 0;
      const tenantEmail = broker.zpro_user_email || broker.email;

      // Obtém token de tenant válido via LOGIN (userId real). Fallback: forja com userId do JWT.
      let tenantToken: string | undefined;
      if (tenantEmail && broker.zpro_password) {
        const loginRes = await zproPost('/auth/login', { email: tenantEmail, password: broker.zpro_password });
        const rawToken = loginRes.json?.token ?? loginRes.json?.access_token ?? loginRes.json?.accessToken ?? loginRes.json?.data?.token;
        if (rawToken) {
          tenantToken = rawToken;
          console.log(`[ReLink] Login tenant ${tenantId} OK`);
        } else {
          console.warn(`[ReLink] Login falhou (${loginRes.status}) — seguindo com super admin`);
        }
      }
      const readToken = tenantToken ?? await getZproAdminToken();

      // 1. Busca canal Z-PRO para obter tokenAPI e wppUser atuais
      const channelCheck = await zproGet(`/whatsapp/${whatsappId}`, readToken);
      const currentTokenAPI = channelCheck.json?.tokenAPI;
      let currentWabaId     = channelCheck.json?.wabaId;
      console.log(`[ReLink] Canal ${whatsappId}: tokenAPI=${currentTokenAPI?.slice(0,8) ?? 'null'} wabaId=${currentWabaId ?? 'null'}`);

      if (!currentTokenAPI) {
        return res.status(400).json({
          error: 'tokenAPI não encontrado no canal Z-PRO. Re-provisione o corretor para recriar a instância UAZAPI.'
        });
      }

      // 2. Lista instâncias UAZAPI e encontra a que corresponde ao tokenAPI
      const uazapiResp = await fetch(`${UAZAPI_HOST}/instance/all`, {
        headers: { 'admintoken': UAZAPI_TOKEN }
      });
      const instances: any[] = await uazapiResp.json().catch(() => []);
      const instance = instances.find((i: any) =>
        i.token === currentTokenAPI || i.instance?.token === currentTokenAPI
      );

      if (!instance) {
        return res.status(404).json({
          error: 'Instância UAZAPI não encontrada para o tokenAPI do canal. Pode ter sido removida no UAZAPI.',
          tokenAPI: currentTokenAPI.slice(0, 8) + '...',
          totalInstances: instances.length
        });
      }

      const instanceId: string    = instance.id ?? instance.instance?.id ?? '';
      const instanceToken: string = instance.token ?? instance.instance?.token ?? currentTokenAPI;
      if (!instanceId) {
        return res.status(500).json({ error: 'instanceId não encontrado na resposta UAZAPI.', instance });
      }
      console.log(`[ReLink] Instância UAZAPI encontrada: id=${instanceId}`);

      // 3. Salva o Number ID na coluna `wabaId` (campo real do painel) se ainda não estiver setado.
      let wabaIdSaved = currentWabaId === instanceId;
      if (!wabaIdSaved) {
        const tokens = tenantToken
          ? [{ label: 'tenant', tok: tenantToken }, { label: 'superAdmin', tok: await getZproAdminToken() }]
          : [{ label: 'superAdmin', tok: await getZproAdminToken() }];
        for (const { label, tok } of tokens) {
          await zproPut(`/whatsapp/${whatsappId}`, { wabaId: instanceId }, tok);
          const check = await zproGet(`/whatsapp/${whatsappId}`, tok);
          if (check.json?.wabaId === instanceId) {
            console.log(`[ReLink] wabaId=${instanceId} salvo via ${label} ✓`);
            wabaIdSaved = true; currentWabaId = instanceId;
            break;
          }
          console.warn(`[ReLink] wabaId NÃO salvo via ${label}: check=${check.json?.wabaId}`);
        }
      }
      // wppUser também (best-effort, compatibilidade)
      await zproPut(`/whatsapp/${whatsappId}`, { wppUser: instanceId }, tenantToken);

      // 4. Configura o webhook UAZAPI→Z-PRO (entrega de mensagens) — SEMPRE.
      const webhookOk = await setUazapiWebhook(instanceToken, instanceId);

      res.json({
        success: wabaIdSaved && webhookOk,
        wabaId: instanceId,
        wabaIdSaved,
        webhookConfigured: webhookOk,
        message: (wabaIdSaved && webhookOk)
          ? `Canal ${whatsappId} corrigido: Number ID "${instanceId}" salvo (wabaId) e webhook ativo. Desconecte e reconecte o WhatsApp para ativar.`
          : `Parcial — wabaIdSaved=${wabaIdSaved}, webhookConfigured=${webhookOk}. Verifique os logs do servidor.`
      });
    } catch (err: any) {
      console.error('[ReLink] erro:', err?.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Cria API Config vinculada ao canal do corretor (endpoint do painel api-service).
  // POST /api-config → retorna uuid (para URL externa) + plainToken (bearer token).
  // URL externa: ${ZPRO_ADMIN_URL}/v2/api/external/${uuid}
  async function createApiConfig(
    tenantId: number, whatsappId: number, brokerName: string, tenantToken: string
  ): Promise<{ uuid: string; plainToken: string; apiUrl: string } | null> {
    const r = await zproPost('/api-config', { name: brokerName, sessionId: whatsappId, tenantId }, tenantToken);
    if (r.ok && r.json?.plainToken) {
      const uuid = r.json.id as string;
      const apiUrl = `${ZPRO_ADMIN_URL}/v2/api/external/${uuid}`;
      console.log(`[Z-PRO] API Config criada — uuid=${uuid}`);
      return { uuid, plainToken: r.json.plainToken, apiUrl };
    }
    console.warn(`[Z-PRO] Criação de api-config falhou: ${r.status} ${r.raw.slice(0, 100)}`);
    return null;
  }

  async function createZproTenantAndChannel(broker: any) {
    const brokerName = broker.name || `Corretor ${broker.id}`;

    // Gera credenciais ANTES — persistidas no Supabase imediatamente
    const tenantPassword = broker.zpro_password || generateSecurePassword();
    const tenantUsername = broker.zpro_username || buildZproUsername(broker);
    // Usa o email real do broker como login no Z-PRO (melhor UX — o corretor loga com o email que cadastrou).
    // Fallback @imobiflow.local só se a criação falhar por conflito de email (email já existe no Z-PRO global).
    // let (não const) para permitir fallback para @imobiflow.local se necessário.
    let tenantEmail = broker.zpro_user_email || broker.email || `${tenantUsername}@imobiflow.local`;

    await supabase.from('brokers').update({
      zpro_password: tenantPassword,
      zpro_username: tenantUsername,
      zpro_user_email: tenantEmail,
      provisioning_status: broker.zpro_tenant_id ? 'tenant_created' : 'pending',
      provisioning_error: null
    }).eq('id', broker.id);

    // Dias da semana padrão para o usuário admin do tenant.
    // Z-PRO ignora hr1-hr4 no POST /userTenants — usa apenas 'type'.
    // 'O' = Aberto (Open), 'C' = Fechado (Closed). 'W' é convertido para 'O' pelo Z-PRO.
    // restrictedUser: false garante que essas horas não bloqueiam login.
    const defaultBusinessHours = [
      { day: 0, label: 'Domingo',    type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 1, label: 'Segunda',    type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 2, label: 'Terça',      type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 3, label: 'Quarta',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 4, label: 'Quinta',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 5, label: 'Sexta',      type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
      { day: 6, label: 'Sábado',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' }
    ];
    const defaultMenuPermissions = {
      massa: true, grupo: true, chatPrivado: true, kanban: true, funil: true,
      agenda: true, campanhas: true, relatorios: true, financeiro: true,
      contatos: true, helpdesk: true, filas: true, tags: true, quickAnswers: true
    };

    try {
      let tenantId: number | string | undefined = broker.zpro_tenant_id && broker.zpro_tenant_id !== 'undefined'
        ? broker.zpro_tenant_id
        : undefined;
      let adminUserId: number | string | undefined;

      // ── 1. Cria tenant ────────────────────────────────────────────────────────
      // POST /tenants (super-admin JWT) — inclui uazapiHost+Token para evitar step extra.
      // Tenant API (/tenantApiStoreTenant) retorna 401 sem restart do Z-PRO — não usar.
      if (!tenantId) {
        const tenantBody = {
          name: brokerName,
          email: tenantEmail,
          password: tenantPassword,
          userName: tenantUsername,
          username: tenantUsername,
          status: 'active',
          maxUsers: 5,
          maxConnections: 1,
          acceptTerms: true,
          profile: 'user',
          uazapiHost: UAZAPI_HOST,
          uazapiToken: UAZAPI_TOKEN
        };

        const res = await zproPost('/tenants', tenantBody);
        if (!res.ok) throw new Error(`Z-PRO criar tenant → ${res.status}: ${res.raw.slice(0, 500)}`);

        const t = res.json;
        tenantId = t?.id ?? t?.tenant_id ?? t?.tenantId ?? t?.data?.id ?? t?.tenant?.id ?? t?.result?.id;
        if (!tenantId) throw new Error(`Z-PRO tenant ID ausente no response: ${JSON.stringify(t)}`);
        console.log(`[Z-PRO] Tenant criado: id=${tenantId}`);

        // ── 1a. Cria usuário admin isolado no tenant via POST /userTenants ────────
        // POST /users cria o user no tenant 1 (tenant do super-admin) — errado.
        // POST /userTenants aceita tenantId no body e cria o user corretamente isolado.
        // Verificado: login após esse endpoint retorna tenantId correto.
        const buildUserBody = (email: string) => ({
          name: brokerName,
          email,
          password: tenantPassword,
          profile: 'admin',
          tenantId: Number(tenantId),
          phone: '',
          status: 'active',      // obrigatório — Z-PRO retorna OUT_RANGE se status for null
          inactive: false,
          businessHours: defaultBusinessHours,
          menuPermissions: defaultMenuPermissions,
          restrictedUser: false  // false (boolean) — string 'disabled' é truthy em JS, ativa check de horário
        });

        let userRes = await zproPost('/userTenants', buildUserBody(tenantEmail));

        // Se falhou por conflito de email (email já existe no Z-PRO), tenta com @imobiflow.local
        if (!userRes.ok && tenantEmail !== `${tenantUsername}@imobiflow.local`) {
          const fallbackEmail = `${tenantUsername}@imobiflow.local`;
          console.warn(`[Z-PRO] /userTenants com email real falhou (${userRes.status}) — tentando ${fallbackEmail}`);
          userRes = await zproPost('/userTenants', buildUserBody(fallbackEmail));
          if (userRes.ok && userRes.json?.id) {
            tenantEmail = fallbackEmail;  // atualiza para o resto do fluxo (login, webhook)
            await supabase.from('brokers').update({ zpro_user_email: fallbackEmail }).eq('id', broker.id);
          }
        }

        if (userRes.ok && userRes.json?.id) {
          adminUserId = userRes.json.id;
          const usedEmail = userRes.json.email ?? tenantEmail;
          console.log(`[Z-PRO] Usuário admin criado via /userTenants — id=${adminUserId} email=${usedEmail} tenant=${tenantId}`);
        } else {
          console.warn(`[Z-PRO] /userTenants falhou: ${userRes.status} ${userRes.raw.slice(0, 200)}`);
          // Não é fatal — login tenta mesmo assim
        }

        await supabase.from('brokers').update({
          zpro_tenant_id: String(tenantId),
          provisioning_status: 'tenant_created'
        }).eq('id', broker.id);
      } else {
        console.log(`[Z-PRO] Tenant ${tenantId} já existe — pulando criação`);
      }

      // ── 1b. Login como user do tenant para obter token de sessão ─────────────
      // Com /userTenants o login sempre retorna tenantId correto (verificado).
      let tenantToken: string | undefined;
      try {
        const loginRes = await zproPost('/auth/login', { email: tenantEmail, password: tenantPassword });
        if (loginRes.ok && loginRes.json) {
          const rawToken = loginRes.json.token ?? loginRes.json.access_token ?? loginRes.json.accessToken
            ?? loginRes.json.data?.token;
          if (rawToken) {
            let jwtTenantId = 0;
            try {
              const p = JSON.parse(Buffer.from(rawToken.split('.')[1], 'base64url').toString());
              jwtTenantId  = Number(p.tenantId || 0);
              adminUserId  = adminUserId ?? p.id;
            } catch {}
            if (jwtTenantId === Number(tenantId)) {
              tenantToken = rawToken;
              console.log(`[Z-PRO] Login user-tenant OK — tenantId=${tenantId} ✓`);
            } else {
              console.warn(`[Z-PRO] Login retornou tenantId=${jwtTenantId} (esperado ${tenantId})`);
            }
          }
        } else {
          console.warn(`[Z-PRO] Login user-tenant falhou (${loginRes.status})`);
        }
      } catch (e: any) {
        console.warn('[Z-PRO] Login exception:', e.message);
      }

      // Fallback: forja JWT de tenant se login falhou e temos JWT_SECRET + userId
      if (!tenantToken && ZPRO_JWT_SECRET && tenantId && adminUserId) {
        tenantToken = forgeTenantJwt(Number(tenantId), Number(adminUserId), tenantEmail);
        console.log(`[Z-PRO] JWT forjado para tenant ${tenantId} (user ${adminUserId})`);
      }

      // ── 2. Cria canal WhatsApp uazapi ─────────────────────────────────────────
      // POST /whatsappTenants com type=uazapi — verificado: cria canal isolado no tenant,
      // status DISCONNECTED, sem herdar template Baileys.
      // Tenant API (/tenantApiCreateSession) retorna 401 — não usar.
      let whatsappId: number | string | undefined = broker.zpro_channel_id && broker.zpro_channel_id !== 'undefined'
        ? broker.zpro_channel_id
        : undefined;

      if (!whatsappId) {
        const channelBody = {
          tenant: Number(tenantId),
          tenantId: Number(tenantId),
          name: `WhatsApp - ${brokerName}`,
          status: 'DISCONNECTED',
          type: 'uazapi',
          isActive: true,
          // uazapiHost + uazapiToken são obrigatórios para Z-PRO comunicar com UAZAPI
          // Sem eles o canal fica DISCONNECTED e nunca gera QR Code
          uazapiHost: UAZAPI_HOST,
          uazapiToken: UAZAPI_TOKEN
        };

        const channelRes = await zproPost('/whatsappTenants', channelBody);
        if (!channelRes.ok) throw new Error(`Z-PRO criar canal: ${channelRes.status}: ${channelRes.raw.slice(0, 500)}`);

        const s = channelRes.json;
        whatsappId = s?.id ?? s?.whatsappId ?? s?.data?.id ?? s?.whatsapp?.id;
        if (!whatsappId) throw new Error(`Z-PRO whatsappId ausente: ${JSON.stringify(s)}`);
        console.log(`[Z-PRO] Canal uazapi criado — id=${whatsappId} name="WhatsApp - ${brokerName}"`);
      } else {
        console.log(`[Z-PRO] Canal ${whatsappId} já existe — pulando criação`);
      }

      await supabase.from('brokers').update({
        zpro_channel_id: String(whatsappId),
        zpro_channel_name: `WhatsApp - ${brokerName}`,
        provisioning_status: 'session_created'
      }).eq('id', broker.id);

      // ── 2b. Cria instância UAZAPI e vincula ao canal (tokenAPI) ───────────────
      // Sem esse passo, Z-PRO exibe "Aguardando QR Code" indefinidamente.
      // createUazapiInstanceForChannel: POST /instance/create (UAZAPI) + PUT /whatsapp/:id + POST /whatsappSession/:id
      // Só cria se o canal é novo (não existia antes); se já existia, assume que a instância já foi criada.
      if (!broker.zpro_channel_id || broker.zpro_channel_id === 'undefined') {
        await createUazapiInstanceForChannel(whatsappId, `WhatsApp - ${brokerName}`, tenantToken);
      } else {
        console.log(`[UAZAPI] Canal ${whatsappId} pré-existente — pulando criação de instância UAZAPI`);
      }

      // ── 3. Cria API Config vinculada ao canal (POST /api-config) ──────────────
      let apiPlainToken: string | null = null;
      let apiUuid: string | null = null;
      let apiExternalUrl: string | null = null;
      if (tenantToken) {
        const apiResult = await createApiConfig(Number(tenantId), Number(whatsappId), brokerName, tenantToken);
        if (apiResult) {
          apiPlainToken = apiResult.plainToken;
          apiUuid = apiResult.uuid;
          apiExternalUrl = apiResult.apiUrl;
          await supabase.from('brokers').update({
            zpro_api_key: apiUuid,
            zpro_api_token: apiPlainToken,
            zpro_api_url: apiExternalUrl
          }).eq('id', broker.id);
        }
      }

      // ── 4. Ativa Bots IA (N8N) no tenant ─────────────────────────────────────
      // PUT /settings/n8n e PUT /settings/n8nAllTickets com {key, value, tenantId}.
      // Equivalente a: Configurações > Bots IA > IA > Habilitar IA + Habilitar para todos os tickets.
      if (tenantToken) await configureBotIA(Number(tenantId), tenantToken);

      // ── 5. Configura N8N webhook URL no canal ─────────────────────────────────
      // PUT /whatsapp/:id com body mínimo {n8nUrl, disableExternalIntegration, waitProcessExternalInteraction}.
      // Body mínimo é obrigatório — spread do canal completo causa falha silenciosa (não salva n8nUrl).
      // Z-PRO retorna 500 mas salva; verificamos com GET para confirmar.
      if (N8N_WEBHOOK_URL) await setN8nWebhook(tenantId, whatsappId, tenantToken);

      await supabase.from('brokers').update({
        provisioning_status: 'api_created'
      }).eq('id', broker.id);

      const completedAt = new Date().toISOString();
      await supabase.from('brokers').update({
        provisioning_status: 'completed',
        provisioning_completed_at: completedAt
      }).eq('id', broker.id);

      await supabase.from('webhook_logs').insert({
        source: 'zpro',
        event_type: 'tenant_created',
        payload: { tenant_id: tenantId, whatsapp_id: whatsappId, broker_id: broker.id },
        status: 'processed',
        broker_id: broker.id
      });

      console.log(`✅ Z-PRO: tenant=${tenantId} | canal=${whatsappId} | api=${apiUuid} — corretor ${broker.id}`);

      // ── 4. Webhook provisionamento → N8N entrega credenciais ao corretor ──────
      const loginUrl = `${ZPRO_ADMIN_URL.replace('appback.', 'app.')}/login`;
      await fireProvisioningWebhook({
        event: 'broker_provisioned',
        provisioned_at: completedAt,
        broker: {
          id: broker.id,
          name: broker.name,
          email: broker.email,
          phone: broker.phone
        },
        zpro_login: {
          url: loginUrl,
          email: tenantEmail,
          username: tenantUsername,
          password: tenantPassword
        },
        zpro: {
          admin_url: ZPRO_ADMIN_URL,
          tenant_id: String(tenantId),
          channel_id: String(whatsappId),
          channel_name: `WhatsApp - ${brokerName}`,
          channel_type: 'uazapi',
          api_uuid: apiUuid,
          url: apiExternalUrl,
          bearerToken: apiPlainToken
        },
        asaas: {
          customer_id: broker.asaas_customer_id || null,
          subscription_id: broker.asaas_subscription_id || null
        }
      });

    } catch (err: any) {
      console.error("Erro ao criar Z-PRO tenant/canal:", err);
      await supabase.from('brokers').update({
        provisioning_status: 'failed',
        provisioning_error: err.message
      }).eq('id', broker.id);
      await supabase.from('webhook_logs').insert({
        source: 'zpro',
        event_type: 'tenant_creation_failed',
        payload: { error: err.message, broker_id: broker.id },
        status: 'error',
        broker_id: broker.id
      });
    }
  }


  // ─── PROXY LLM ─────────────────────────────────────────────────────────────
  // N8N chama: POST /api/proxy/llm/:brokerPhone/chat/completions
  // Authorization: Bearer INTERNAL_PROXY_TOKEN   (credential estática no N8N)
  // O proxy busca a key OpenRouter do corretor no Supabase e encaminha para
  // openrouter.ai — cada corretor é cobrado na própria conta.
  // Fallback: OPENROUTER_API_KEY (chave da empresa) se o corretor não configurou.
  app.all('/api/proxy/llm/:brokerPhone/*', async (req, res) => {
    const authHeader = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || authHeader !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: { message: 'Proxy: token inválido.', type: 'invalid_api_key' } });
    }

    if (!OPENROUTER_API_KEY) {
      return res.status(402).json({
        error: { message: 'OpenRouter key não configurada no servidor.', type: 'invalid_api_key' }
      });
    }

    const suffix = ((req.params as any)[0] || 'chat/completions').replace(/^\//, '');
    const openRouterUrl = `https://openrouter.ai/api/v1/${suffix}`;
    try {
      const proxyResp = await fetch(openRouterUrl, {
        method: req.method,
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': APP_URL,
          'X-Title': 'ImobiFlow'
        },
        body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : JSON.stringify(req.body)
      });
      const data = await proxyResp.json();
      res.status(proxyResp.status).json(data);
    } catch (err: any) {
      console.error('[LLM Proxy] Erro ao chamar OpenRouter:', err);
      res.status(502).json({ error: { message: 'Proxy error: ' + err.message, type: 'proxy_error' } });
    }
  });

  // ─── FOLLOW-UP IA ───────────────────────────────────────────────────────────
  // Reativação automática de lead: após X minutos sem o cliente responder, envia
  // UMA mensagem de follow (progressivo 1→2→3, para após o 3º). Handover humano:
  // se o corretor responde manualmente, o agente é interrompido (ai_active=false)
  // e os follow-ups param naquela conversa.
  // Tabelas: followup_config (1 por corretor) + followup_conversations (por conversa).

  // [Corretor] Carrega a config de follow-up do corretor logado
  app.get('/api/followup/config', requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
      const { data } = await supabase.from('followup_config').select('*').eq('broker_id', brokerId).maybeSingle();
      res.json(data || {
        broker_id: brokerId, enabled: false,
        delay_minutes_1: 30, delay_minutes_2: 120, delay_minutes_3: 1440,
        message_1: '', message_2: '', message_3: '', strategy: 'progressive'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // [Corretor] Salva a config de follow-up (toggle + tempo + 3 mensagens)
  app.post('/api/followup/config', requireUser, async (req, res) => {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
      const { enabled, delay_minutes_1, delay_minutes_2, delay_minutes_3, message_1, message_2, message_3, strategy } = req.body || {};
      const payload: any = {
        broker_id: brokerId,
        enabled: !!enabled,
        delay_minutes_1: Math.max(1, Number(delay_minutes_1) || 30),
        delay_minutes_2: Math.max(1, Number(delay_minutes_2) || 120),
        delay_minutes_3: Math.max(1, Number(delay_minutes_3) || 1440),
        message_1: message_1 ?? null,
        message_2: message_2 ?? null,
        message_3: message_3 ?? null,
        strategy: strategy || 'progressive',
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('followup_config')
        .upsert(payload, { onConflict: 'broker_id' }).select().single();
      if (error) throw error;
      res.json({ success: true, config: data });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // [N8N] Cliente enviou mensagem → re-arma o timer; retorna { respond }.
  // Se respond=false (handover humano ativo), o agente N8N deve PARAR de responder.
  // Auth: Bearer INTERNAL_PROXY_TOKEN. Body: { broker_phone, customer_phone }.
  app.post('/api/followup/inbound', async (req, res) => {
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    try {
      const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || '').split(':')[0]);
      if (!customerPhone) {
        return res.status(400).json({ error: 'customer_phone é obrigatório.' });
      }
      // Aceita broker_id direto (estável) ou fallback para broker_phone (quebra se trocar número)
      let _brokerId: string | null = req.body?.broker_id || null;
      if (!_brokerId) {
        const brokerPhone = normalizePhoneBR(String(req.body?.broker_phone || '').split(':')[0]);
        if (brokerPhone) {
          const { data: b } = await supabase.from('brokers').select('id').eq('phone', brokerPhone).maybeSingle();
          _brokerId = b?.id || null;
        }
      }
      if (!_brokerId) return res.json({ respond: true }); // corretor não encontrado: não bloqueia o agente
      const broker = { id: _brokerId };

      const incomingTicketId = String(req.body?.ticket_id || '').trim() || null;

      const { data: conv } = await supabase.from('followup_conversations')
        .select('ai_active, human_takeover_at, zpro_ticket_id')
        .eq('broker_id', broker.id).eq('customer_phone', customerPhone).maybeSingle();

      // Reativação automática opcional após handover (config.reactivate_after_minutes; null = nunca)
      let aiActive = conv?.ai_active ?? true;
      if (conv && aiActive === false) {
        const { data: cfg } = await supabase.from('followup_config')
          .select('reactivate_after_minutes').eq('broker_id', broker.id).maybeSingle();
        const mins = cfg?.reactivate_after_minutes;
        if (mins && conv.human_takeover_at &&
            (Date.now() - new Date(conv.human_takeover_at).getTime()) >= mins * 60000) {
          aiActive = true;
        }
      }

      // Novo ticket = zera a contagem de follows. Mesma conversa = mantém o índice.
      // Regra: máximo 3 follows por ticket. O índice (follow_message_index) é o
      // contador absoluto e NÃO reseta quando o cliente responde — só reseta em
      // novo ticket. Assim: Follow 1 → 2 → 3 → para, independente de respostas.
      const isNewTicket = incomingTicketId && conv?.zpro_ticket_id &&
                          incomingTicketId !== conv.zpro_ticket_id;

      await supabase.from('followup_conversations').upsert({
        broker_id: broker.id,
        customer_phone: customerPhone,
        last_customer_message_at: new Date().toISOString(),
        follow_sent: false, // re-arma o timer (permite próximo follow disparar)
        ai_active: aiActive,
        ...(incomingTicketId ? { zpro_ticket_id: incomingTicketId } : {}),
        ...(isNewTicket ? { follow_message_index: 0, human_takeover_at: null } : {}),
        updated_at: new Date().toISOString()
      }, { onConflict: 'broker_id,customer_phone' });

      // Contabiliza atendimento: cada ticket_id único = 1 atendimento no ciclo de billing.
      // ON CONFLICT (broker_id, zpro_ticket_id) DO NOTHING garante idempotência sem try/catch.
      if (incomingTicketId) {
        await supabase.from('ticket_events').upsert({
          broker_id: broker.id,
          zpro_ticket_id: incomingTicketId,
          customer_phone: customerPhone,
        }, { onConflict: 'broker_id,zpro_ticket_id', ignoreDuplicates: true });
      }

      res.json({ respond: aiActive });
    } catch (err: any) {
      console.error('[Follow-up] inbound erro:', err.message);
      res.json({ respond: true }); // em erro, nunca bloqueia o agente
    }
  });

  // [N8N] Corretor respondeu manualmente → handover humano: interrompe o agente
  // e pausa follow-ups naquela conversa. Auth: Bearer INTERNAL_PROXY_TOKEN.
  app.post('/api/followup/broker-reply', async (req, res) => {
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    try {
      const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || '').split(':')[0]);
      if (!customerPhone) {
        return res.status(400).json({ error: 'customer_phone é obrigatório.' });
      }
      // Aceita broker_id direto (estável) ou fallback para broker_phone (quebra se trocar número)
      let _brokerId: string | null = req.body?.broker_id || null;
      if (!_brokerId) {
        const brokerPhone = normalizePhoneBR(String(req.body?.broker_phone || '').split(':')[0]);
        if (brokerPhone) {
          const { data: b } = await supabase.from('brokers').select('id').eq('phone', brokerPhone).maybeSingle();
          _brokerId = b?.id || null;
        }
      }
      if (!_brokerId) return res.json({ success: true });
      const broker = { id: _brokerId };

      await supabase.from('followup_conversations').upsert({
        broker_id: broker.id,
        customer_phone: customerPhone,
        ai_active: false,
        human_takeover_at: new Date().toISOString(),
        follow_sent: true, // pausa follow-ups enquanto o humano atende
        updated_at: new Date().toISOString()
      }, { onConflict: 'broker_id,customer_phone' });

      res.json({ success: true, paused: true });
    } catch (err: any) {
      console.error('[Follow-up] broker-reply erro:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Motor do Follow-Up (tick 60s) ──────────────────────────────────────────
  // claim_due_followups() faz o claim ATÔMICO (seleciona+marca+avança numa só
  // instrução) → multi-máquina safe (Fly roda 2 VMs). Envia via API externa Z-PRO.
  // Em falha de envio, reverte o claim p/ retry no próximo tick (nada se perde).
  // Envia via API externa Z-PRO no MESMO formato do agente N8N (comprovado em produção):
  // POST na URL base (zpro_api_url, sem sufixo) · header "Authorization: Token <token>"
  // · body { body, number, externalKey, isClosed:false }.
  async function checkTicketOpen(ticketId: string | null): Promise<boolean | null> {
    if (!ticketId || !ZPRO_ADMIN_URL) return null;
    try {
      const token = await getZproAdminToken();
      const r = await fetch(`${ZPRO_ADMIN_URL}/api/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return null; // falha na consulta → não bloqueia envio
      const d = await r.json();
      const status = d?.ticket?.status ?? d?.status;
      return status === 'open' || status === 'pending';
    } catch {
      return null;
    }
  }

  async function sendFollowMessage(apiUrl: string, apiToken: string, customerPhone: string, message: string): Promise<boolean> {
    if (!apiUrl || !apiToken || !message) return false;
    try {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${apiToken}` },
        body: JSON.stringify({
          // Prefixo ​ (zero-width space, invisível): marca mensagem do SISTEMA.
          // O nó de handover no N8N só dispara quando a msg fromMe NÃO tem esse marcador
          // (= corretor digitou manual). Assim o follow-up não causa auto-handover.
          body: String.fromCharCode(0x200B) + message, // ZWSP: marca msg do sistema
          number: normalizePhoneBR(customerPhone),
          externalKey: 'imobiflow-followup',
          isClosed: false
        })
      });
      return r.ok;
    } catch (e: any) {
      console.warn('[Follow-up] sendFollowMessage exceção:', e.message);
      return false;
    }
  }

  async function runFollowupTick() {
    try {
      const { data: due, error } = await supabase.rpc('claim_due_followups');
      if (error) { console.error('[Follow-up] claim erro:', error.message); return; }
      if (!due?.length) return;
      for (const row of due as any[]) {
        // Mensagem vazia = follow não configurado → avança sem enviar (evita loop infinito)
        if (!row.message?.trim()) {
          console.warn(`[Follow-up] follow #${row.message_index} sem mensagem configurada — pulando → ${row.customer_phone}`);
          continue;
        }
        // Verifica se o ticket ainda está aberto no Z-PRO antes de enviar
        const ticketOpen = await checkTicketOpen(row.zpro_ticket_id);
        if (ticketOpen === false) {
          console.log(`[Follow-up] ticket ${row.zpro_ticket_id} fechado — pulando ${row.customer_phone}`);
          continue;
        }
        const ok = await sendFollowMessage(row.zpro_api_url, row.zpro_api_token, row.customer_phone, row.message);
        if (ok) {
          console.log(`[Follow-up] follow #${row.message_index} → ${row.customer_phone} (broker ${row.broker_id})`);
          // Após Follow 1 ou 2, reseta follow_sent para que o próximo dispare automaticamente
          // após o delay correspondente (contado a partir de follow_sent_at, gravado pela RPC).
          // Follow 3 (index=3) mantém follow_sent=true — sequência encerrada.
          if (row.message_index < 3) {
            await supabase.from('followup_conversations').update({
              follow_sent: false,
              updated_at: new Date().toISOString()
            }).eq('id', row.conversation_id);
          }
        } else {
          // Falha de envio (rede/API) → reverte claim para retry no próximo tick
          await supabase.from('followup_conversations').update({
            follow_sent: false,
            follow_sent_at: null,
            follow_message_index: Math.max(0, (row.message_index || 1) - 1),
            updated_at: new Date().toISOString()
          }).eq('id', row.conversation_id);
          console.warn(`[Follow-up] envio falhou, claim revertido → ${row.customer_phone}`);
        }
      }
    } catch (err: any) {
      console.error('[Follow-up] tick erro:', err.message);
    }
  }

  setInterval(runFollowupTick, 60_000);
  console.log('[Follow-up] scheduler ativo (tick 60s)');

  // Verifica a cada hora se algum corretor tem renovação amanhã e emite o
  // valor combinado (mensalidade + excedente) na assinatura do Asaas.
  setInterval(prepareOverageBilling, 60 * 60 * 1000);
  prepareOverageBilling(); // executa uma vez ao subir (cobre restarts próximos ao billing)
  console.log('[Billing Prep] scheduler ativo (tick 1h)');

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
