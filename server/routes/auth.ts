import express from "express";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase";
import { authLimiter } from "../middleware/rateLimits";
import { normalizePhoneBR } from "../lib/crypto";
import {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL,
  UAZAPI_HOST, UAZAPI_TOKEN, UAZAPI_PLATFORM_SESSION,
} from "../config";

export const authRouter = express.Router();

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_SERVICE_ROLE_KEY;

// --- ROTAS DE AUTENTICAÇÃO (AUTH) ---
/**
 * Realiza o cadastro de um novo usuário (corretor) no sistema.
 * Cria também um perfil inicial na tabela 'brokers'.
 */
authRouter.post("/api/auth/signup", authLimiter, async (req, res) => {
  try {
    const { email, password, name, phone, account_type } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    }
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

authRouter.post("/api/auth/login", authLimiter, async (req, res) => {
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
