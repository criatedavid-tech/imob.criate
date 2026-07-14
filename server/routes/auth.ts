import express from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase";
import { authLimiter } from "../middleware/rateLimits";
import { validateBody } from "../middleware/validate";
import { normalizePhoneBR } from "../lib/crypto";
import {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL,
  UAZAPI_HOST, UAZAPI_TOKEN, UAZAPI_PLATFORM_SESSION,
} from "../config";
import { fetchWithTimeout } from "../lib/http";
import { provisionUazapiInstanceForMember } from "../services/provisioning";

export const authRouter = express.Router();

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY;

// --- ROTAS DE AUTENTICAÇÃO (AUTH) ---
/**
 * Realiza o cadastro de um novo usuário (corretor) no sistema.
 * Cria também um perfil inicial na tabela 'brokers'.
 */
const signupSchema = z.object({
  email: z.string().trim().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string().min(6, "Senha precisa ter pelo menos 6 caracteres."),
  name: z.string().trim().min(1, "Nome é obrigatório."),
  phone: z.string().optional(),
  account_type: z.string().optional(),
});

authRouter.post("/api/auth/signup", authLimiter, validateBody(signupSchema), async (req, res) => {
  try {
    const { email, password, name, phone, account_type } = req.body;
    // Tipo da conta define o "mundo" que o app mostra (menus + cockpit).
    // Valida contra a lista fechada; valor inválido cai no padrão (corretor).
    const VALID_TYPES = ['corretor', 'imobiliaria', 'incorporadora'];
    const accountType = VALID_TYPES.includes(account_type) ? account_type : 'corretor';

    // Verifica se já existe conta com este e-mail
    const { data: existing } = await supabase.from('imf_brokers').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
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
      const { error: profileError } = await supabase.from('imf_brokers').insert([{
        user_id: created.user.id,
        name: name.trim(),
        phone: normalizePhoneBR(phone),
        email: cleanEmail,
        ai_name: 'Minha Assistente IA',
        broker_address: '',
        account_type: accountType,
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

const loginSchema = z.object({
  email: z.string().trim().min(1, "E-mail é obrigatório.").email("E-mail inválido."),
  password: z.string().min(1, "Senha é obrigatória."),
});

authRouter.post("/api/auth/login", authLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

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
authRouter.post("/api/auth/refresh", async (req, res) => {
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
authRouter.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const genericMsg = { message: 'Se o e-mail estiver cadastrado, você receberá o link de recuperação pelo WhatsApp.' };
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

    // Busca corretor pelo e-mail
    const { data: broker } = await supabase
      .from('imf_brokers')
      .select('id, phone')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (!broker?.phone) { res.json(genericMsg); return; }

    // Gera token seguro e expira em 15 minutos
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabase.from('imf_brokers').update({
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

      await fetchWithTimeout(`${UAZAPI_HOST}/message/text/${UAZAPI_PLATFORM_SESSION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': UAZAPI_TOKEN },
        body: JSON.stringify({ number: phone, text: wppText })
      }).catch(e => console.warn('[WPP] Envio de reset falhou:', e?.message));
    } else {
      console.warn('[WPP] Recuperação de senha não enviada: sessão da plataforma ou telefone indisponível.');
    }

    res.json(genericMsg);
  } catch (err: any) {
    console.error("Forgot password error:", err);
    res.json(genericMsg);
  }
});

// Convite de Equipe (multi-usuário leve) — a pessoa convidada ainda não tem
// conta; essas 2 rotas são públicas de propósito, como signup/login.

// Antes de mostrar o formulário: valida o código e diz de qual conta é o convite.
authRouter.get("/api/auth/join/:code", async (req, res) => {
  try {
    const { data: invite } = await supabase
      .from("imf_broker_invites")
      .select("broker_id, expires_at, used_at, whatsapp_mode, imf_brokers(name)")
      .eq("code", req.params.code)
      .maybeSingle();

    if (!invite) return res.status(404).json({ error: "Convite não encontrado." });
    if (invite.used_at) return res.status(410).json({ error: "Este convite já foi utilizado." });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: "Este convite expirou." });

    res.json({ brokerName: (invite as any).imf_brokers?.name || "a conta", whatsappMode: invite.whatsapp_mode });
  } catch (err: any) {
    console.error("Erro GET /api/auth/join/:code:", err);
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/api/auth/join", authLimiter, async (req, res) => {
  try {
    const { code, name, phone, email, password } = req.body;
    if (!code || !email || !password || !name) {
      return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios." });
    }

    // Reivindica o convite de forma atômica — só segue se ninguém usou antes.
    const { data: claimed, error: claimError } = await supabase
      .from("imf_broker_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("broker_id, whatsapp_mode")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return res.status(410).json({ error: "Convite inválido, expirado ou já utilizado." });

    const cleanEmail = email.toLowerCase().trim();
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    if (!created.user) return res.status(500).json({ error: "Falha ao criar usuário." });

    const { data: memberRow, error: memberError } = await supabase
      .from("imf_broker_members")
      .insert({ broker_id: claimed.broker_id, user_id: created.user.id, whatsapp_mode: claimed.whatsapp_mode })
      .select("id")
      .single();
    if (memberError) throw memberError;

    await supabase.from("imf_broker_invites").update({ used_by: created.user.id }).eq("code", code);

    // Guarda nome/telefone no próprio usuário auth (não tem imf_brokers próprio) —
    // fica disponível via user_metadata pra quem listar os membros depois.
    await supabase.auth.admin.updateUserById(created.user.id, {
      user_metadata: { full_name: name.trim(), phone: normalizePhoneBR(phone || "") },
    });

    // Convite pedia WhatsApp próprio — provisiona agora, síncrono (mesmo
    // padrão de esperar a conclusão que o checkout já usa pra conta). Nunca
    // lança: falha vira provisioning_status='failed' na linha do membro,
    // sem travar o cadastro — dá pra tentar de novo depois em Config.
    if (claimed.whatsapp_mode === "own") {
      await provisionUazapiInstanceForMember({ id: memberRow.id, name: name.trim() });
    }

    const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: loginData, error: loginErr } = await authClient.auth.signInWithPassword({ email: cleanEmail, password });
    if (loginErr || !loginData?.session) {
      return res.json({ user: created.user, session: null });
    }
    res.json({ user: loginData.user, session: loginData.session });
  } catch (err: any) {
    console.error("Erro POST /api/auth/join:", err);
    const msg = err.message?.includes("already registered")
      ? "Este e-mail já possui uma conta. Faça login."
      : err.message;
    res.status(400).json({ error: msg });
  }
});

// Valida token e atualiza a senha
authRouter.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

    // Busca corretor pelo token
    const { data: broker } = await supabase
      .from('imf_brokers')
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
    await supabase.from('imf_brokers').update({
      reset_token: null,
      reset_token_expires_at: null
    }).eq('id', broker.id);

    res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err: any) {
    console.error("Reset password error:", err);
    res.status(400).json({ error: 'Erro ao atualizar senha. Tente novamente.' });
  }
});
