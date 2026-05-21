import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';

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
const SUBSCRIPTION_VALUE  = Number(process.env.SUBSCRIPTION_VALUE || "49.90");
// ─── PROXY LLM ────────────────────────────────────────────────────────────────
// Token interno: N8N → servidor (substitui "credential" estática no N8N).
// Enc key: AES-256-GCM para guardar as keys OpenRouter dos corretores no banco.
const INTERNAL_PROXY_TOKEN = process.env.INTERNAL_PROXY_TOKEN || "";
const LLM_PROXY_ENC_KEY    = process.env.LLM_PROXY_ENC_KEY    || "";
// Fallback: chave da empresa usada enquanto o corretor não configurou a própria.
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY   || "";

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

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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

  // --- ROTAS DE AUTENTICAÇÃO (AUTH) ---
  /**
   * Realiza o cadastro de um novo usuário (corretor) no sistema.
   * Cria também um perfil inicial na tabela 'brokers'.
   */
  app.post("/api/auth/signup", async (req, res) => {
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

  app.post("/api/auth/login", async (req, res) => {
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

  // Recuperação de senha via WhatsApp — gera token temporário (15 min) e envia link
  app.post("/api/auth/forgot-password", async (req, res) => {
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
  app.get("/api/brokers/me", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization" });
    
    try {
      const userId = req.headers['x-user-id'] as string; 
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found or created" });

      const { data, error } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Atualiza as configurações e informações do perfil do corretor.
   */
  app.post("/api/brokers/settings", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found" });

      const settings = req.body;
      if (settings.phone !== undefined) settings.phone = normalizePhoneBR(settings.phone);
      const { data, error } = await supabase.from('brokers').update({
        ...settings,
        updated_at: new Date()
      }).eq('id', brokerId).select().single();
      
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Salva a chave OpenRouter do corretor (criptografada com AES-256-GCM)
  app.post('/api/brokers/openrouter-key', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { api_key } = req.body;
      if (!api_key || typeof api_key !== 'string' || api_key.trim().length < 10) {
        return res.status(400).json({ error: 'Chave inválida.' });
      }
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
      const encrypted = encryptKey(api_key.trim());
      await supabase.from('brokers').update({ openrouter_api_key_enc: encrypted }).eq('id', brokerId);
      res.json({ ok: true, message: 'Chave salva com sucesso.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Remove a chave OpenRouter do corretor
  app.delete('/api/brokers/openrouter-key', async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
      await supabase.from('brokers').update({ openrouter_api_key_enc: null }).eq('id', brokerId);
      res.json({ ok: true });
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
  app.post("/api/brokers/upload-photo", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
  app.post("/api/properties/upload-image", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
  app.get("/api/corretora", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
  app.post("/api/corretora", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
  app.get("/api/corretora/brokers", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
  app.get("/api/properties", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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

  app.post("/api/properties", async (req, res) => {
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
      const userId = req.headers['x-user-id'] as string;
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
  app.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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

  app.get("/api/dashboard/charts", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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

  app.get("/api/leads/recent", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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
        // Simulação de disparo de e-mail (Log de console como fallback do sistema)
        console.log(`[E-MAIL SIMULADO] Para: corretor do imóvel ${property_id}. Assunto: Novo lead - ${name}`);
        integrationStatus = "email";
      }

      // 4. Log (Opcional - usando console para não criar novas tabelas se não existirem)
      console.log(`// FLUXO ENVIAR LEAD 30/04/2026: Lead ID ${lead.id} enviado. Chatbot: ${webhookUrl ? 'sim' : 'nao'}`);

      res.status(201).json({ ...lead, integrationStatus });
    } catch (err: any) {
      console.error("Erro no fluxo de envio de lead:", err);
      res.status(500).json({ error: "Falha ao processar contato. Por favor, use o WhatsApp." });
    }
  });

  app.get("/api/agenda/visits", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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

  app.get("/api/leads", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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
  app.patch("/api/properties/:id/status", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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
  app.patch("/api/leads/:id/status", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
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
  app.post("/api/checkout", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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

      // 4. Salva subscription_id no broker e ativa imediatamente
      await supabase.from('brokers')
        .update({ asaas_subscription_id: subscription.id })
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
  app.get("/api/subscription", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
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
        .select('id, name, zpro_api_url, zpro_api_key, zpro_channel_id')
        .eq('phone', normalizedBroker)
        .single();

      if (!broker?.zpro_api_url || !broker?.zpro_api_key) {
        return res.status(404).json({ error: 'Corretor não encontrado ou WhatsApp não configurado.' });
      }

      const zpro_headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${broker.zpro_api_key}`
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

  // Retorna status e QR Code do WhatsApp do corretor
  app.get("/api/whatsapp/status", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('zpro_tenant_id, zpro_api_key, zpro_channel_id, zpro_qr_code, zpro_channel_name, status')
        .eq('id', brokerId).single();

      if (!broker?.zpro_channel_id) {
        return res.json({ connected: false, qr_code: null, message: "Canal WhatsApp ainda não criado." });
      }

      // Se Z-PRO estiver configurado, consulta status em tempo real
      if (ZPRO_ADMIN_URL && ZPRO_ADMIN_TOKEN && broker.zpro_api_key) {
        try {
          const apiHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${await getZproAdminToken()}` };

          // Consulta status do canal — POST /v2/api/external/{apiId}/showChannelById
          const statusResp = await fetch(`${ZPRO_ADMIN_URL}/v2/api/external/${broker.zpro_api_key}/showChannelById`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ id: Number(broker.zpro_channel_id) })
          });
          const channelData = await statusResp.json();
          const connected = channelData.status === 'CONNECTED' || channelData.connected === true;

          if (connected) {
            return res.json({ connected: true, qr_code: null, channel_name: broker.zpro_channel_name });
          }

          // Não conectado: busca QR code atualizado — POST /v2/api/external/{apiId}/qrCodeSession
          const qrResp = await fetch(`${ZPRO_ADMIN_URL}/v2/api/external/${broker.zpro_api_key}/qrCodeSession`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ whatsappId: Number(broker.zpro_channel_id) })
          });
          const qrData = await qrResp.json();
          const freshQr = qrData.qrcode || qrData.qr_code || qrData.base64 || null;

          if (freshQr) {
            await supabase.from('brokers').update({ zpro_qr_code: freshQr }).eq('id', brokerId);
          }

          return res.json({ connected: false, qr_code: freshQr || broker.zpro_qr_code, channel_name: broker.zpro_channel_name });
        } catch {
          // fallback: retorna dados do banco
        }
      }

      res.json({ connected: false, qr_code: broker.zpro_qr_code, channel_name: broker.zpro_channel_name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook do Asaas — confirmação de pagamento, cancelamento
  app.post("/api/webhooks/asaas", async (req, res) => {
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
          subscriptionId: p.subscription || broker.asaas_subscription_id || undefined
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
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return false; }
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
      const adminId = req.headers['x-user-id'];
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

      const adminId = req.headers['x-user-id'];
      console.log(`[ADMIN] Conta excluída: broker=${req.params.id} por user=${adminId}`);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FUNÇÕES DE AUTOMAÇÃO — ATIVAÇÃO E Z-PRO
  // ─────────────────────────────────────────────────────────────────────────

  async function handleAsaasPaymentReceived({ id, customerId, value, brokerId, subscriptionId }: {
    id: string; customerId: string; value: number; brokerId: string; subscriptionId?: string;
  }) {
    try {
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
      { day: 0, label: 'Domingo',    type: 'C', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 1, label: 'Segunda',    type: 'O', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 2, label: 'Terça',      type: 'O', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 3, label: 'Quarta',     type: 'O', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 4, label: 'Quinta',     type: 'O', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 5, label: 'Sexta',      type: 'O', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' },
      { day: 6, label: 'Sábado',     type: 'C', hr1: '08:00', hr2: '18:00', hr3: '', hr4: '' }
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
          isActive: true
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
            zpro_api_key: apiPlainToken,
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
    // 1. Autenticação interna N8N → servidor
    const authHeader = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!INTERNAL_PROXY_TOKEN || authHeader !== INTERNAL_PROXY_TOKEN) {
      return res.status(401).json({ error: { message: 'Proxy: token inválido.', type: 'invalid_api_key' } });
    }

    const { brokerPhone } = req.params;

    // 2. Resolve a key OpenRouter do corretor (ou fallback empresa)
    let openRouterKey = OPENROUTER_API_KEY;
    try {
      const { data: broker } = await supabase
        .from('brokers')
        .select('openrouter_api_key_enc')
        .eq('phone', brokerPhone)
        .maybeSingle();
      if (broker?.openrouter_api_key_enc) {
        openRouterKey = decryptKey(broker.openrouter_api_key_enc);
      }
    } catch (err) {
      console.error('[LLM Proxy] Erro ao buscar key do corretor, usando fallback:', err);
    }

    if (!openRouterKey) {
      return res.status(402).json({
        error: { message: 'OpenRouter key não configurada. Configure em Configurações > IA.', type: 'invalid_api_key' }
      });
    }

    // 3. Proxy transparente → OpenRouter
    const suffix = ((req.params as any)[0] || 'chat/completions').replace(/^\//, '');
    const openRouterUrl = `https://openrouter.ai/api/v1/${suffix}`;
    try {
      const proxyResp = await fetch(openRouterUrl, {
        method: req.method,
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
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
