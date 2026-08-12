import express from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase";
import { authLimiter, publicReadLimiter } from "../middleware/rateLimits";
import { validateBody } from "../middleware/validate";
import { normalizePhoneBR } from "../lib/crypto";
import { isValidPublicInviteCode } from "../security/publicInviteCode";
import { isValidPublicResetToken } from "../security/publicResetToken";
import { hashTrialVoucherCode, isValidTrialVoucherCode } from "../security/trialVoucherCode";
import {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_APP_URL,
} from "../config";
import { provisionUazapiInstanceForMember } from "../services/provisioning";
import { compensateInviteAcceptanceFailure } from "../services/inviteAcceptance";
import { executePasswordReset, PasswordResetTokenError } from "../services/passwordReset";
import { BASIC_ACCESS_DEFAULTS } from "../services/permissions";
import { getUazapiPlatformToken, sendUazapiText } from "../services/uazapi";

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
  voucher_code: z.string().optional().refine(
    (value) => value === undefined || isValidTrialVoucherCode(value),
    "Voucher de experimentação inválido.",
  ),
});

authRouter.post("/api/auth/signup", authLimiter, validateBody(signupSchema), async (req, res) => {
  let createdUserId: string | null = null;
  let accountCreated = false;
  try {
    const { email, password, name, phone, account_type, voucher_code } = req.body;
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

    // Preflight melhora a mensagem e evita criar auth.users quando o voucher
    // já está indisponível. A garantia contra corrida fica na RPC transacional.
    if (voucher_code) {
      const { data: voucher, error: voucherError } = await supabase
        .from("imf_trial_vouchers")
        .select("id")
        .eq("code_hash", hashTrialVoucherCode(voucher_code))
        .eq("status", "active")
        .gt("invite_expires_at", new Date().toISOString())
        .maybeSingle();
      if (voucherError) throw voucherError;
      if (!voucher) {
        return res.status(410).json({ error: "Este voucher é inválido, expirou ou já foi utilizado." });
      }
    }

    // Cria o usuário JÁ confirmado (via admin/service_role) — evita a race
    // condition de confirmar o e-mail depois e não conseguir a sessão na hora.
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true
    });
    if (createErr) throw createErr;

    if (created.user) {
      createdUserId = created.user.id;
      let trial: any = null;

      if (voucher_code) {
        const { data, error } = await supabase.rpc("imf_redeem_trial_voucher", {
          p_code_hash: hashTrialVoucherCode(voucher_code),
          p_user_id: created.user.id,
          p_name: name.trim(),
          p_phone: normalizePhoneBR(phone),
          p_email: cleanEmail,
        });
        if (error || !data?.[0]) throw error || new Error("TRIAL_VOUCHER_REDEMPTION_FAILED");
        trial = data[0];
        accountCreated = true;
      } else {
        const { data: profile, error: profileError } = await supabase.from('imf_brokers').insert([{
          user_id: created.user.id,
          name: name.trim(),
          phone: normalizePhoneBR(phone),
          email: cleanEmail,
          ai_name: 'Minha Assistente IA',
          broker_address: '',
          account_type: accountType,
          status: 'pendente'
        }]).select("id").single();
        if (profileError || !profile) throw profileError || new Error("PROFILE_NOT_CREATED");

        const { error: membershipError } = await supabase
          .from("imf_broker_members")
          .insert({ broker_id: profile.id, user_id: created.user.id });
        if (membershipError) throw membershipError;
        accountCreated = true;
      }

      // Usuário já nasce confirmado → signInWithPassword retorna a sessão na hora
      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      try {
        const { data: loginData, error: loginErr } = await authClient.auth
          .signInWithPassword({ email: cleanEmail, password });

        if (loginErr || !loginData?.session) {
          console.error("Signup auto-login falhou:", loginErr);
          // A conta já está íntegra; o frontend pode fazer login explícito.
          return res.json({ user: created.user, session: null, trial });
        }

        return res.json({ user: loginData.user, session: loginData.session, trial });
      } catch (loginError: any) {
        console.error("Signup auto-login indisponível:", {
          name: loginError?.name || "Error",
          code: loginError?.code || "UNKNOWN",
        });
        return res.json({ user: created.user, session: null, trial });
      }
    }

    res.json({ user: created.user, session: null });
  } catch (err: any) {
    // Evita identidades órfãs quando perfil, membership ou resgate falham.
    if (createdUserId && !accountCreated) {
      try {
        await supabase.from("imf_brokers").delete().eq("user_id", createdUserId);
        await supabase.auth.admin.deleteUser(createdUserId);
      } catch (rollbackError: any) {
        console.error("Signup rollback failed:", {
          name: rollbackError?.name || "Error",
          code: rollbackError?.code || "UNKNOWN",
        });
      }
    }
    console.error("Auth Signup Error:", err);
    const errorText = String(err?.message || "");
    const msg = errorText.includes('already registered')
      ? 'Este e-mail já possui uma conta. Faça login ou recupere sua senha.'
      : errorText.includes("TRIAL_")
        ? 'Este voucher é inválido, expirou ou já foi utilizado.'
        : 'Não foi possível criar a conta. Tente novamente.';
    res.status(400).json({ error: msg });
  }
});

// Consulta pública mínima para montar a tela do convite. Não retorna hash,
// criador, usuário que resgatou nem qualquer dado da conta.
authRouter.get("/api/auth/trial-vouchers/:code", publicReadLimiter, async (req, res) => {
  try {
    const code = req.params.code;
    if (!isValidTrialVoucherCode(code)) {
      return res.status(404).json({ error: "Voucher não encontrado." });
    }

    const { data: voucher, error } = await supabase
      .from("imf_trial_vouchers")
      .select("id, account_type, invite_expires_at, trial_days, member_limit, whatsapp_member_limit, status")
      .eq("code_hash", hashTrialVoucherCode(code))
      .maybeSingle();
    if (error) throw error;
    if (!voucher) return res.status(404).json({ error: "Voucher não encontrado." });

    if (voucher.status === "active" && new Date(voucher.invite_expires_at) <= new Date()) {
      await supabase
        .from("imf_trial_vouchers")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", voucher.id)
        .eq("status", "active");
      voucher.status = "expired";
    }

    if (voucher.status !== "active") {
      return res.status(410).json({ error: "Este voucher expirou ou já foi utilizado." });
    }

    res.json({
      account_type: voucher.account_type,
      invite_expires_at: voucher.invite_expires_at,
      trial_days: voucher.trial_days,
      member_limit: voucher.account_type === "corretor" ? 0 : voucher.member_limit,
      whatsapp_member_limit: voucher.account_type === "corretor" ? 0 : voucher.whatsapp_member_limit,
    });
  } catch (err: any) {
    console.error("Trial voucher lookup error:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível verificar o voucher." });
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
    const resetLink = `${PUBLIC_APP_URL}/reset-password?token=${token}`;
    const phone = normalizePhoneBR(broker.phone);

    const platformToken = await getUazapiPlatformToken().catch(() => null);
    if (platformToken && phone) {
      const wppText =
        `🏠 *Real Estate*\n\n` +
        `Você solicitou a recuperação de senha.\n\n` +
        `Clique no link abaixo para criar uma nova senha ` +
        `*(válido por 15 minutos)*:\n\n` +
        `${resetLink}\n\n` +
        `_Se não foi você, ignore esta mensagem._`;

      const sent = await sendUazapiText(platformToken, phone, wppText);
      if (!sent.ok) console.warn(`[WPP] Envio de reset falhou: status ${sent.status}`);
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
authRouter.get("/api/auth/join/:code", publicReadLimiter, async (req, res) => {
  try {
    if (!isValidPublicInviteCode(req.params.code)) {
      return res.status(404).json({ error: "Convite não encontrado." });
    }

    const { data: invite } = await supabase
      .from("imf_broker_invites")
      .select("broker_id, expires_at, used_at, whatsapp_mode, imf_brokers(name, plan, trial_ends_at)")
      .eq("code", req.params.code)
      .maybeSingle();

    if (!invite) return res.status(404).json({ error: "Convite não encontrado." });
    if (invite.used_at) return res.status(410).json({ error: "Este convite já foi utilizado." });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: "Este convite expirou." });

    const broker = (invite as any).imf_brokers;
    if (broker?.plan === "experimentacao" && (!broker?.trial_ends_at || new Date(broker.trial_ends_at) <= new Date())) {
      return res.status(410).json({ error: "O período de experimentação desta conta terminou." });
    }

    res.json({ brokerName: broker?.name || "a conta", whatsappMode: invite.whatsapp_mode });
  } catch (err: any) {
    console.error("Erro GET /api/auth/join/:code:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível verificar o convite" });
  }
});

const joinSchema = z.object({
  code: z.string().refine(isValidPublicInviteCode, "Convite inválido."),
  name: z.string().trim().min(1, "Nome é obrigatório.").max(120, "Nome muito longo."),
  phone: z.string().trim().max(30, "Telefone muito longo.").optional().default(""),
  email: z.string().trim().email("E-mail inválido."),
  password: z.string().min(6, "Senha precisa ter pelo menos 6 caracteres.").max(128, "Senha muito longa."),
});

authRouter.post("/api/auth/join", authLimiter, validateBody(joinSchema), async (req, res) => {
  let claimedCode: string | null = null;
  let createdUserId: string | null = null;
  let membershipCreated = false;

  try {
    const { code, name, phone, email, password } = req.body;

    // Reivindica o convite de forma atômica — só segue se ninguém usou antes.
    const { data: claimedRows, error: claimError } = await supabase
      .rpc("imf_claim_broker_invite", { p_code: code });
    const claimed = claimedRows?.[0] || null;
    if (claimError) throw claimError;
    if (!claimed) return res.status(410).json({ error: "Convite inválido, expirado ou já utilizado." });
    claimedCode = code;

    const cleanEmail = email.toLowerCase();
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    if (!created.user) throw new Error("AUTH_USER_NOT_CREATED");
    createdUserId = created.user.id;

    const { data: memberRow, error: memberError } = await supabase
      .from("imf_broker_members")
      .insert({ broker_id: claimed.broker_id, user_id: created.user.id, whatsapp_mode: claimed.whatsapp_mode })
      .select("id")
      .single();
    if (memberError) throw memberError;
    membershipCreated = true;

    // Acesso básico padrão pro membro novo (não passa pela RPC de
    // auditoria — é estado inicial da conta, não uma mudança feita por
    // alguém). Best-effort: um membro sem nenhuma linha aqui simplesmente
    // não tem permissão nenhuma até o titular conceder, então uma falha
    // aqui não trava o cadastro nem deixa a conta num estado inválido.
    const { error: permissionsSeedError } = await supabase.from("imf_member_permissions").insert(
      BASIC_ACCESS_DEFAULTS.map((grantKey) => {
        const [module, action] = grantKey.split(":");
        return { broker_id: claimed.broker_id, user_id: created.user.id, module, action };
      }),
    );
    if (permissionsSeedError) {
      console.error("Falha ao semear acesso básico do membro:", {
        code: (permissionsSeedError as any)?.code || "UNKNOWN",
      });
    }

    const { error: finalizeError } = await supabase
      .from("imf_broker_invites")
      .update({ used_by: created.user.id })
      .eq("code", code);
    if (finalizeError) {
      console.error("Falha ao finalizar auditoria do convite:", {
        code: finalizeError.code || "UNKNOWN",
      });
    }

    // Guarda nome/telefone no próprio usuário auth (não tem imf_brokers próprio) —
    // fica disponível via user_metadata pra quem listar os membros depois.
    const { error: metadataError } = await supabase.auth.admin.updateUserById(created.user.id, {
      user_metadata: { full_name: name.trim(), phone: normalizePhoneBR(phone || "") },
    });
    if (metadataError) {
      console.error("Falha ao atualizar metadados do membro:", {
        code: (metadataError as any)?.code || "UNKNOWN",
      });
    }

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
    if (claimedCode && !membershipCreated) {
      try {
        await compensateInviteAcceptanceFailure(
          { code: claimedCode, createdUserId, membershipCreated },
          {
            deleteCreatedUser: async (userId) => {
              const { error } = await supabase.auth.admin.deleteUser(userId);
              if (error) throw error;
            },
            releaseInvite: async (code) => {
              const { error } = await supabase
                .from("imf_broker_invites")
                .update({ used_at: null })
                .eq("code", code)
                .is("used_by", null);
              if (error) throw error;
            },
          },
        );
      } catch (rollbackError: any) {
        console.error("Falha ao compensar aceite de convite:", {
          name: rollbackError?.name || "Error",
          code: rollbackError?.code || "UNKNOWN",
        });
      }
    }

    console.error("Erro POST /api/auth/join:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    const errorText = String(err?.message || "");
    if (errorText.includes("TRIAL_MEMBER_LIMIT_REACHED")) {
      return res.status(409).json({ error: "O limite de corretores desta experimentação foi atingido." });
    }
    if (errorText.includes("TRIAL_WHATSAPP_LIMIT_REACHED")) {
      return res.status(409).json({ error: "A cota de corretores com WhatsApp próprio desta experimentação foi atingida." });
    }
    if (errorText.includes("WHATSAPP_MEMBER_LIMIT_REACHED")) {
      return res.status(409).json({ error: "A cota de corretores com WhatsApp próprio desta conta foi atingida." });
    }
    if (errorText.includes("TRIAL_EXPIRED")) {
      return res.status(403).json({ error: "O período de experimentação terminou. Contrate um plano para continuar." });
    }
    const msg = errorText.includes("already registered")
      ? "Este e-mail já possui uma conta. Faça login."
      : "Não foi possível entrar na equipe. Tente novamente.";
    res.status(400).json({ error: msg });
  }
});

const resetPasswordSchema = z.object({
  token: z.string().refine(isValidPublicResetToken, "Token inválido."),
  newPassword: z.string().min(6, "A senha deve ter pelo menos 6 caracteres.").max(128, "Senha muito longa."),
});

// Reivindica o token de forma atômica e atualiza a senha.
authRouter.post("/api/auth/reset-password", authLimiter, validateBody(resetPasswordSchema), async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    await executePasswordReset(
      { token, newPassword, now: new Date() },
      {
        findCandidate: async (candidateToken) => {
          const { data, error } = await supabase
            .from("imf_brokers")
            .select("id, user_id, reset_token_expires_at")
            .eq("reset_token", candidateToken)
            .maybeSingle();
          if (error) throw error;
          if (!data) return null;
          return {
            id: data.id,
            userId: data.user_id,
            expiresAt: data.reset_token_expires_at,
          };
        },
        claimToken: async (candidateId, candidateToken, nowIso) => {
          const { data, error } = await supabase
            .from("imf_brokers")
            .update({ reset_token: null, reset_token_expires_at: null })
            .eq("id", candidateId)
            .eq("reset_token", candidateToken)
            .gt("reset_token_expires_at", nowIso)
            .select("id")
            .maybeSingle();
          if (error) throw error;
          return !!data;
        },
        updatePassword: async (userId, password) => {
          const { error } = await supabase.auth.admin.updateUserById(userId, { password });
          if (error) throw error;
        },
        restoreToken: async (candidate, candidateToken) => {
          const { error } = await supabase
            .from("imf_brokers")
            .update({
              reset_token: candidateToken,
              reset_token_expires_at: candidate.expiresAt,
            })
            .eq("id", candidate.id)
            .is("reset_token", null);
          if (error) throw error;
        },
        reportRestoreFailure: (restoreError: any) => {
          console.error("Falha ao restaurar token de redefinição:", {
            name: restoreError?.name || "Error",
            code: restoreError?.code || "UNKNOWN",
          });
        },
      },
    );

    res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err: any) {
    if (err instanceof PasswordResetTokenError) {
      const error = err.kind === "expired"
        ? "Link expirado. Solicite uma nova recuperação de senha."
        : "Link inválido ou já utilizado.";
      return res.status(400).json({ error });
    }
    console.error("Reset password error:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(400).json({ error: 'Erro ao atualizar senha. Tente novamente.' });
  }
});
