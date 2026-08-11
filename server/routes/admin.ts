import express from "express";
import { z } from "zod";
import { supabase } from "../supabase";
import { invalidateAccountAccessCache, requireAdmin } from "../middleware/auth";
import { fetchWithTimeout } from "../lib/http";
import { normalizePhoneBRFull } from "../lib/crypto";
import {
  UAZAPI_HOST, UAZAPI_TOKEN, PLAN_INCLUDED_TICKETS, PLAN_OVERAGE_PRICE, PUBLIC_APP_URL,
  MEMBER_WHATSAPP_SLOT_MAX,
} from "../config";
import {
  generateTrialVoucherCode,
  hashTrialVoucherCode,
  trialVoucherCodeHint,
} from "../security/trialVoucherCode";
import { cancelAsaasSubscription } from "../services/billing";
import {
  disconnectUazapiInstance,
  ensureBrokerInstance,
  ensurePlatformInstance,
  getUazapiWebhookState,
  isUazapiWebhookReady,
  platformWebhookUrl,
  provisionUazapiInstanceNative,
  setUazapiPlatformWebhook,
} from "../services/provisioning";
import { getSystemHealth, getBrokerHealth, requeueDeadRows, releaseStaleLeases } from "../services/systemHealth";
import { purgeResolvedQueueRows } from "../services/maintenance";
import { runWebhookKeeperTick } from "../services/webhookKeeper";
import { runWebhookInboxTick, runWebhookOutboxTick } from "../services/inboundWebhookQueue";
import {
  ACCOUNT_CAPABILITIES,
  resolveAccountCapabilities,
  type AccountCapability,
} from "../services/accountCapabilities";

export const adminRouter = express.Router();

const MAX_PAGINATION_OFFSET = 10_000_000;
const trialVoucherCreateSchema = z.object({
  account_type: z.enum(["corretor", "imobiliaria", "incorporadora"]),
  invite_expires_at: z.string().datetime({ offset: true }),
  trial_days: z.number().int().min(1).max(180),
  member_limit: z.number().int().min(0).max(100),
  whatsapp_member_limit: z.number().int().min(0).max(Math.min(100, MEMBER_WHATSAPP_SLOT_MAX)),
}).superRefine((input, ctx) => {
  if (input.account_type !== "corretor" && input.whatsapp_member_limit > input.member_limit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whatsapp_member_limit"],
      message: "A cota de WhatsApps próprios não pode superar a quantidade de corretores convidados.",
    });
  }
});

// Alteração de um voucher já emitido. Ambos os campos são opcionais para a
// tela poder mandar só o que mudou, mas ao menos um precisa vir.
const trialVoucherUpdateSchema = z.object({
  invite_expires_at: z.string().datetime({ offset: true }).optional(),
  trial_days: z.number().int().min(1).max(180).optional(),
}).refine(
  (input) => input.invite_expires_at !== undefined || input.trial_days !== undefined,
  { message: "Informe ao menos um campo para alterar." },
);

// ─────────────────────────────────────────────────────────────────────────
// PAINEL ADMIN
// ─────────────────────────────────────────────────────────────────────────

// Lista todos os corretores com dados de assinatura
adminRouter.get("/api/admin/brokers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > MAX_PAGINATION_OFFSET) {
      return res.status(400).json({ error: `limit deve estar entre 1 e 200; offset deve ser um inteiro entre 0 e ${MAX_PAGINATION_OFFSET}.` });
    }
    const { data, error, count } = await supabase
      .from('imf_brokers')
      .select('id, name, email, phone, status, plan, account_type, valid_until, created_at, is_admin, asaas_customer_id, uazapi_instance_id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const total = count || 0;
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Has-More', String(offset + (data?.length || 0) < total));
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Métricas globais da plataforma
adminRouter.get("/api/admin/metrics", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const [brokersRes, propertiesRes, leadsRes, activeRes, revenueRes] = await Promise.all([
      supabase.from('imf_brokers').select('id', { count: 'exact', head: true }),
      supabase.from('imf_properties').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('imf_brokers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
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
adminRouter.patch("/api/admin/brokers/:id/status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { status } = req.body;
  if (!['ativo', 'pendente', 'bloqueado'].includes(status)) {
    return res.status(400).json({ error: "Status inválido" });
  }
  try {
    const { data, error } = await supabase
      .from('imf_brokers').update({ status }).eq('id', req.params.id).select().single();
    if (error) throw error;
    invalidateAccountAccessCache(data.user_id);

    // Ativação manual (sandbox/teste, sem passar pelo checkout real) não
    // provisionava WhatsApp — a conta ficava com "instância ainda sendo
    // configurada" pra sempre. Auto-cura na hora, mesmo caminho usado pelo
    // pagamento real (ensureBrokerInstance, com trava atômica própria).
    if (status === 'ativo' && UAZAPI_HOST && UAZAPI_TOKEN) {
      ensureBrokerInstance(data).catch((e: any) =>
        console.error(`[Admin] falha ao auto-provisionar broker ${data.id} na ativação:`, e?.message));
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Quantos corretores da equipe podem ter WhatsApp PRÓPRIO (em vez de
// compartilhar o da conta) — sem sistema formal de tiers de plano ainda,
// então isso funciona como um ajuste manual do admin (mesmo padrão de
// PLAN_OVERAGE_PRICE). 0/null = recurso indisponível pra essa conta (padrão).
// Validado em server/routes/equipe.ts::POST /api/equipe/members/invite.
adminRouter.patch("/api/admin/brokers/:id/member-limit", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const memberLimit = Number(req.body?.member_limit);
  if (!Number.isInteger(memberLimit) || memberLimit < 0) {
    return res.status(400).json({ error: "member_limit precisa ser um número inteiro ≥ 0." });
  }
  try {
    const { data, error } = await supabase
      .from('imf_brokers').update({ member_limit: memberLimit }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ajusta a duração do período de experimentação de uma conta já criada —
// POST /api/admin/trial-vouchers só define os dias na hora de gerar o
// convite; esta rota cobre estender ou encurtar depois que a conta já
// resgatou o voucher e está rodando. trial_days aqui é o total desde
// trial_started_at (que nunca muda), não "dias a mais". Não mexe em
// status: uma conta já inativa por expiração continua precisando do botão
// "Ativar conta" separadamente depois de estender o prazo.
adminRouter.patch("/api/admin/brokers/:id/trial-days", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const trialDays = Number(req.body?.trial_days);
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 180) {
    return res.status(400).json({ error: "trial_days precisa ser um número inteiro entre 1 e 180." });
  }
  try {
    const { data: broker, error: fetchError } = await supabase
      .from('imf_brokers').select('plan, trial_started_at').eq('id', req.params.id).single();
    if (fetchError) throw fetchError;
    if (broker.plan !== 'experimentacao') {
      return res.status(400).json({ error: "Esta conta não está em experimentação." });
    }
    if (!broker.trial_started_at) {
      return res.status(400).json({ error: "Conta sem data de início de experimentação registrada." });
    }
    const trialEndsAt = new Date(new Date(broker.trial_started_at).getTime() + trialDays * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from('imf_brokers').update({ trial_ends_at: trialEndsAt.toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Detalhes de um corretor (imóveis, leads, assinaturas)
adminRouter.get("/api/admin/brokers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const [brokerRes, propsRes, subsRes] = await Promise.all([
      supabase.from('imf_brokers').select('*').eq('id', req.params.id).single(),
      supabase.from('imf_properties').select('id, title, status, created_at').eq('broker_id', req.params.id).order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*').eq('broker_id', req.params.id).order('created_at', { ascending: false })
    ]);
    if (brokerRes.error) throw brokerRes.error;
    const capabilities = await resolveAccountCapabilities(req.params.id);
    res.json({
      broker: brokerRes.data,
      properties: propsRes.data || [],
      subscriptions: subsRes.data || [],
      capabilities,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Vouchers de experimentação. O segredo bruto só volta nesta criação; a
// listagem guarda apenas uma dica visual e o hash irreversível no banco.
adminRouter.post("/api/admin/trial-vouchers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const parsed = trialVoucherCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Dados inválidos.",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    const input = parsed.data;
    const expiresAt = new Date(input.invite_expires_at);
    const now = new Date();
    const latestAllowed = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    if (expiresAt <= now || expiresAt > latestAllowed) {
      return res.status(400).json({ error: "A validade do convite deve estar entre agora e 365 dias." });
    }

    const code = generateTrialVoucherCode();
    const memberLimit = input.account_type === "corretor" ? 0 : input.member_limit;
    const whatsappMemberLimit = input.account_type === "corretor" ? 0 : input.whatsapp_member_limit;
    const { data, error } = await supabase
      .from("imf_trial_vouchers")
      .insert({
        code_hash: hashTrialVoucherCode(code),
        code_hint: trialVoucherCodeHint(code),
        account_type: input.account_type,
        invite_expires_at: expiresAt.toISOString(),
        trial_days: input.trial_days,
        member_limit: memberLimit,
        whatsapp_member_limit: whatsappMemberLimit,
        created_by: (req as any).userId,
      })
      .select("id, code_hint, account_type, invite_expires_at, trial_days, member_limit, whatsapp_member_limit, status, created_at")
      .single();
    if (error) throw error;

    res.status(201).json({
      ...data,
      code,
      url: `${PUBLIC_APP_URL}/experimentacao/${encodeURIComponent(code)}`,
    });
  } catch (err: any) {
    console.error("Erro POST /api/admin/trial-vouchers:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível gerar o voucher." });
  }
});

adminRouter.get("/api/admin/trial-vouchers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const now = new Date().toISOString();
    const { error: expiryError } = await supabase
      .from("imf_trial_vouchers")
      .update({ status: "expired", updated_at: now })
      .eq("status", "active")
      .lte("invite_expires_at", now);
    if (expiryError) throw expiryError;

    const { data, error } = await supabase
      .from("imf_trial_vouchers")
      .select("id, code_hint, account_type, invite_expires_at, trial_days, member_limit, whatsapp_member_limit, status, created_at, used_at, broker_id, cancelled_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const brokerIds = Array.from(new Set((data || []).map((row: any) => row.broker_id).filter(Boolean)));
    const brokersById = new Map<string, { name: string; email: string; plan: string; status: string }>();
    if (brokerIds.length > 0) {
      const { data: brokerRows, error: brokerError } = await supabase
        .from("imf_brokers")
        .select("id, name, email, plan, status")
        .in("id", brokerIds);
      if (brokerError) throw brokerError;
      for (const broker of brokerRows || []) brokersById.set(broker.id, {
        name: broker.name,
        email: broker.email,
        plan: broker.plan,
        status: broker.status,
      });
    }

    res.json((data || []).map((row: any) => ({
      ...row,
      used_by_account: row.broker_id ? brokersById.get(row.broker_id) || null : null,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/admin/trial-vouchers:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível listar os vouchers." });
  }
});

// Corrige um convite JÁ ENVIADO sem precisar cancelar e gerar outro: o código
// e o link continuam os mesmos, só o prazo e/ou a duração do teste mudam.
// Condicionado a status='active' porque, uma vez resgatado, trial_days já foi
// copiado para a conta e mexer aqui não teria efeito nenhum — nesse caso o
// controle certo é PATCH /api/admin/brokers/:id/trial-days. A condição também
// serve de trava contra um resgate acontecendo em paralelo.
adminRouter.patch("/api/admin/trial-vouchers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(400).json({ error: "Voucher inválido." });
    }
    const parsed = trialVoucherUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Dados inválidos.",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.invite_expires_at !== undefined) {
      // Mesma janela da emissão: não adianta prorrogar para o passado (o
      // próprio GET marcaria como expirado no carregamento seguinte).
      const expiresAt = new Date(parsed.data.invite_expires_at);
      const now = new Date();
      const latestAllowed = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      if (expiresAt <= now || expiresAt > latestAllowed) {
        return res.status(400).json({ error: "A validade do convite deve estar entre agora e 365 dias." });
      }
      patch.invite_expires_at = expiresAt.toISOString();
    }
    if (parsed.data.trial_days !== undefined) patch.trial_days = parsed.data.trial_days;

    const { data, error } = await supabase
      .from("imf_trial_vouchers")
      .update(patch)
      .eq("id", req.params.id)
      .eq("status", "active")
      .select("id, code_hint, account_type, invite_expires_at, trial_days, member_limit, whatsapp_member_limit, status, created_at, used_at, broker_id, cancelled_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(409).json({ error: "Somente vouchers ativos e ainda não utilizados podem ser alterados." });
    }
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/admin/trial-vouchers/:id:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível alterar o voucher." });
  }
});

adminRouter.patch("/api/admin/trial-vouchers/:id/cancel", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(400).json({ error: "Voucher inválido." });
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("imf_trial_vouchers")
      .update({ status: "cancelled", cancelled_at: now, cancelled_by: (req as any).userId, updated_at: now })
      .eq("id", req.params.id)
      .eq("status", "active")
      .select("id, status, cancelled_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "Somente vouchers ativos podem ser cancelados." });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/admin/trial-vouchers/:id/cancel:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível cancelar o voucher." });
  }
});

// Revoga tanto um convite ainda não usado quanto o acesso concedido por um
// voucher já resgatado. A RPC bloqueia voucher + conta na mesma transação para
// não existir estado intermediário (conta bloqueada com voucher ainda válido,
// ou o inverso). Contas que já contrataram outro plano não são afetadas.
adminRouter.patch("/api/admin/trial-vouchers/:id/revoke", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(400).json({ error: "Voucher inválido." });
    }

    // A primeira versão dos vouchers podia deixar um registro como `used`
    // antes de salvar broker_id/used_by. Não há acesso de conta a revogar
    // nesses casos. Encerramos somente o voucher com uma atualização
    // condicionada, para não correr o risco de atingir um vínculo criado em
    // paralelo entre a leitura e a gravação.
    const { data: voucher, error: voucherError } = await supabase
      .from("imf_trial_vouchers")
      .select("id, status, broker_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (voucherError) throw voucherError;
    if (!voucher) return res.status(404).json({ error: "Voucher não encontrado." });

    if (voucher.status === "used" && !voucher.broker_id) {
      const now = new Date().toISOString();
      const { data: legacyVoucher, error: legacyError } = await supabase
        .from("imf_trial_vouchers")
        .update({
          status: "cancelled",
          cancelled_at: now,
          cancelled_by: (req as any).userId,
          updated_at: now,
        })
        .eq("id", req.params.id)
        .eq("status", "used")
        .is("broker_id", null)
        .select("id, status, cancelled_at")
        .maybeSingle();
      if (legacyError) throw legacyError;
      if (!legacyVoucher) {
        return res.status(409).json({ error: "O voucher mudou enquanto era revogado. Atualize o painel e tente novamente." });
      }
      console.log(`[ADMIN] Voucher legado revogado sem conta vinculada: voucher=${req.params.id} por user=${(req as any).userId}`);
      return res.json({
        voucher_id: legacyVoucher.id,
        voucher_status: legacyVoucher.status,
        broker_id: null,
        broker_status: null,
        revoked_access: false,
        cancelled_at: legacyVoucher.cancelled_at,
      });
    }

    const { data, error } = await supabase.rpc("imf_revoke_trial_voucher", {
      p_voucher_id: req.params.id,
      p_admin_user_id: (req as any).userId,
    });
    if (error) {
      console.warn("[Admin] revogação de voucher recusada:", { code: error.code || "UNKNOWN" });
      return res.status(409).json({
        error: "Não foi possível revogar. O voucher pode já estar encerrado ou a conta pode não estar mais em experimentação.",
      });
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return res.status(404).json({ error: "Voucher não encontrado." });

    if (result.broker_id) {
      // A conta pode ter titular e vários membros com decisões de acesso em
      // cache. Revogação é rara e precisa valer para todos imediatamente.
      invalidateAccountAccessCache();
    }
    console.log(`[ADMIN] Voucher revogado: voucher=${req.params.id} acesso=${Boolean(result.revoked_access)} por user=${(req as any).userId}`);
    res.json(result);
  } catch (err: any) {
    console.error("Erro PATCH /api/admin/trial-vouchers/:id/revoke:", {
      name: err?.name || "Error",
      code: err?.code || "UNKNOWN",
    });
    res.status(500).json({ error: "Não foi possível revogar o voucher." });
  }
});

// Define o conjunto final de funcoes da conta. A RPC grava apenas overrides
// sobre os padroes do account_type e faz a substituicao inteira em transacao.
adminRouter.patch("/api/admin/brokers/:id/capabilities", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const requested = req.body?.capabilities;
    if (!Array.isArray(requested)) {
      return res.status(400).json({ error: "capabilities precisa ser uma lista." });
    }

    const unique = Array.from(new Set(requested));
    if (unique.some((value) => typeof value !== "string" || !ACCOUNT_CAPABILITIES.includes(value as AccountCapability))) {
      return res.status(400).json({ error: "A lista contem uma funcionalidade invalida." });
    }

    const before = await resolveAccountCapabilities(req.params.id);
    if (!before.migrationReady) {
      return res.status(503).json({ error: "A migration de funcionalidades ainda nao foi aplicada no banco." });
    }

    const { error } = await supabase.rpc("imf_set_account_capabilities", {
      p_broker_id: req.params.id,
      p_enabled_capabilities: unique,
      p_updated_by: (req as any).userId || null,
    });
    if (error) throw error;

    res.json(await resolveAccountCapabilities(req.params.id));
  } catch (err: any) {
    console.error("Erro PATCH /api/admin/brokers/:id/capabilities:", err?.message);
    res.status(500).json({ error: "Nao foi possivel atualizar as funcionalidades da conta." });
  }
});

// Disparo manual de provisionamento (admin) — mesma rota do usuário normal
// pós-pagamento:
//   1. Garante status=ativo + valid_until (preserva 2099 se já estiver configurado)
//   2. Chama provisionUazapiInstanceNative (cria a instância UAZAPI direta)
adminRouter.post("/api/admin/brokers/:id/provision", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('*').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // Garante que o corretor está ativo antes de provisionar
    // Preserva valid_until já definido (ex: 2099) ou define +1 mês
    const currentValidUntil = broker.valid_until ? new Date(broker.valid_until) : null;
    const needsValidUntil = !currentValidUntil || currentValidUntil < new Date();
    if (needsValidUntil) {
      const validUntil = new Date();
      validUntil.setMonth(validUntil.getMonth() + 1);
      await supabase.from('imf_brokers').update({
        status: 'ativo',
        plan: broker.plan || 'mensal',
        valid_until: validUntil.toISOString()
      }).eq('id', broker.id);
      broker.status = 'ativo';
      broker.valid_until = validUntil.toISOString();
    } else if (broker.status !== 'ativo') {
      await supabase.from('imf_brokers').update({ status: 'ativo' }).eq('id', broker.id);
      broker.status = 'ativo';
    }

    if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
      return res.status(503).json({ error: 'UAZAPI não configurada.' });
    }

    await provisionUazapiInstanceNative(broker);

    res.json({ success: true, message: 'Instância WhatsApp provisionada com sucesso.' });
  } catch (err: any) {
    console.error('[Provision] erro:', err?.message);
    res.status(500).json({ error: err.message });
  }
});

// Cancelar plano (mantém valid_until, cancela no Asaas)
adminRouter.post("/api/admin/brokers/:id/cancel-plan", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('asaas_subscription_id, asaas_customer_id, name').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // Cancela assinatura no Asaas se existir
    if (broker.asaas_subscription_id) {
      try {
        await cancelAsaasSubscription(broker.asaas_subscription_id);
      } catch (error: any) {
        console.error('[Asaas] cancelamento administrativo falhou:', error?.message);
        return res.status(502).json({
          error: 'Não foi possível confirmar o cancelamento no Asaas. O plano local não foi alterado; tente novamente.',
        });
      }
    }

    // Marca corretor como cancelado — acesso mantido até valid_until (cronjob/webhook vai expirar)
    await supabase.from('imf_brokers').update({ status: 'bloqueado' }).eq('id', req.params.id);

    // Log admin
    const adminId = (req as any).userId;
    console.log(`[ADMIN] Plano cancelado: broker=${req.params.id} por user=${adminId}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir conta de corretor
adminRouter.delete("/api/admin/brokers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('user_id, asaas_subscription_id').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // 1. Cancela assinatura no Asaas
    if (broker.asaas_subscription_id) {
      try {
        await cancelAsaasSubscription(broker.asaas_subscription_id);
      } catch (error: any) {
        console.error('[Asaas] cancelamento antes da exclusão falhou:', error?.message);
        return res.status(502).json({
          error: 'Não foi possível confirmar o cancelamento no Asaas. A conta não foi excluída; tente novamente.',
        });
      }
    }

    // 2. Remove dados do corretor. Nem toda tabela que referencia
    // imf_brokers tem ON DELETE CASCADE (ex.: imf_properties, leads,
    // imf_rental_contracts) e imf_agenda não tem FK nenhuma — por isso a
    // limpeza roda numa função transacional (migration 20260806e) que
    // apaga essas tabelas na ordem certa antes do broker, com rollback
    // automático se qualquer passo falhar.
    const { error: deleteBrokerError } = await supabase.rpc('admin_delete_broker_cascade', {
      p_broker_id: req.params.id,
    });
    if (deleteBrokerError) {
      console.error('[Admin] Falha ao excluir broker:', deleteBrokerError.message);
      return res.status(500).json({ error: `Não foi possível excluir a conta: ${deleteBrokerError.message}` });
    }

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
adminRouter.get("/api/admin/brokers/:id/ticket-usage", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const brokerId = req.params.id;
    const { data: broker } = await supabase.from('imf_brokers')
      .select('valid_until, name').eq('id', brokerId).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    const [{ count: ticketsRaw }, { data: adjData }] = await Promise.all([
      supabase.from('imf_ticket_events')
        .select('id', { count: 'exact', head: true })
        .eq('broker_id', brokerId)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString()),
      // SEM filtro de período: admin vê e pode estornar qualquer ajuste da história
      supabase.from('imf_ticket_adjustments')
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
adminRouter.post("/api/admin/brokers/:id/ticket-adjustment", async (req, res) => {
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
    const { data: broker } = await supabase.from('imf_brokers')
      .select('valid_until').eq('id', brokerId).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    // Negativo: estorno de qualquer ajuste histórico (sem filtro de período)
    if (amount < 0) {
      const { data: existing } = await supabase.from('imf_ticket_adjustments')
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

    const { data, error } = await supabase.from('imf_ticket_adjustments').insert({
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
// SAÚDE DO SISTEMA (só admin) — diagnóstico + intervenção manual
// Existe para responder sem abrir o SQL: o pipeline está drenando? tem
// mensagem parada? qual corretor está com o WhatsApp caído? E, principalmente,
// para AGIR quando a resposta for ruim.
// ─────────────────────────────────────────────────────────────────────────

adminRouter.get("/api/admin/health", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    res.json(await getSystemHealth());
  } catch (err: any) {
    console.error("Erro GET /api/admin/health:", err);
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get("/api/admin/health/brokers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    res.json(await getBrokerHealth());
  } catch (err: any) {
    console.error("Erro GET /api/admin/health/brokers:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ações de intervenção. Todas idempotentes e com efeito limitado — o pior caso
// é reprocessar algo que já estava certo, nunca perder dado.
adminRouter.post("/api/admin/health/actions/:action", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const queue = req.body?.queue === "outbox" ? "imf_webhook_outbox" : "imf_webhook_inbox";
  try {
    switch (req.params.action) {
      case "requeue-dead": {
        const moved = await requeueDeadRows(queue);
        return res.json({ ok: true, action: "requeue-dead", queue, affected: moved });
      }
      case "release-stale-leases": {
        const released = await releaseStaleLeases(queue);
        return res.json({ ok: true, action: "release-stale-leases", queue, affected: released });
      }
      case "purge-queues": {
        await purgeResolvedQueueRows();
        return res.json({ ok: true, action: "purge-queues" });
      }
      case "reassert-webhooks": {
        // Reaponta o webhook da UAZAPI de todas as instâncias para este backend.
        // É o botão para quando o inbound "cai" e ninguém sabe por quê.
        await runWebhookKeeperTick();
        return res.json({ ok: true, action: "reassert-webhooks" });
      }
      case "drain-queues": {
        // Força um ciclo das filas agora, sem esperar o worker.
        await Promise.all([runWebhookInboxTick(), runWebhookOutboxTick()]);
        return res.json({ ok: true, action: "drain-queues" });
      }
      default:
        return res.status(400).json({ error: "Ação desconhecida." });
    }
  } catch (err: any) {
    console.error(`Erro POST /api/admin/health/actions/${req.params.action}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// WHATSAPP PAI — instância central (Fase 3)
// ─────────────────────────────────────────────────────────────────────────
// Diferente do WhatsApp de um corretor (uma instância por conta, cada um
// conecta a sua), o Pai é UMA instância só, compartilhada por TODA a
// plataforma — todo corretor que já vinculou o próprio número (Config →
// WhatsApp Pai) passa a ser reconhecido assim que ela está conectada,
// sem precisar fazer nada de novo. Só o super admin gerencia essa conexão.
const WHATSAPP_PAI_KEY = "pai";
const WHATSAPP_PAI_LABEL = "WhatsApp Pai (central)";

adminRouter.get("/api/admin/whatsapp-pai/status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { token, status: provisioningStatus, error: provisioningError } = await ensurePlatformInstance(WHATSAPP_PAI_KEY, WHATSAPP_PAI_LABEL);
    if (!token) {
      return res.json({ provisioned: false, connected: false, loggedIn: false, provisioningStatus, provisioningError });
    }

    const r = await fetchWithTimeout(`${UAZAPI_HOST}/instance/status`, { headers: { token } });
    if (!r.ok) throw new Error(`UAZAPI respondeu ${r.status}`);
    const data = await r.json();
    const { data: platform, error: platformError } = await supabase.from("imf_platform_instances")
      .select("webhook_enabled")
      .eq("key", WHATSAPP_PAI_KEY)
      .maybeSingle();
    if (platformError) throw platformError;
    const webhookState = await getUazapiWebhookState(token);
    const expectedWebhookUrl = platformWebhookUrl(PUBLIC_APP_URL);

    res.json({
      provisioned: true,
      connected: !!data?.status?.connected,
      loggedIn: !!data?.status?.loggedIn,
      profileName: data?.instance?.profileName || null,
      owner: data?.instance?.owner || null,
      webhookDesired: platform?.webhook_enabled === true,
      webhookEnabled: webhookState?.enabled ?? null,
      webhookUrl: webhookState?.url ?? null,
      webhookEvents: webhookState?.events ?? null,
      webhookReady: !!expectedWebhookUrl
        && !!webhookState
        && isUazapiWebhookReady(webhookState, expectedWebhookUrl),
    });
  } catch (err: any) {
    console.error("Erro GET /api/admin/whatsapp-pai/status:", err);
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post("/api/admin/whatsapp-pai/connect", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { token, status: provisioningStatus, error: provisioningError } = await ensurePlatformInstance(WHATSAPP_PAI_KEY, WHATSAPP_PAI_LABEL);
    if (!token) {
      return res.status(400).json({ error: provisioningError || "Instância ainda sendo preparada.", provisioningStatus });
    }

    // phone opcional: com ele, a UAZAPI gera código de pareamento em vez de
    // QR — mesma regra de brokers.ts (número COM o 9º dígito).
    const phone = req.body?.phone ? normalizePhoneBRFull(String(req.body.phone)) : undefined;
    const r = await fetchWithTimeout(`${UAZAPI_HOST}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(phone ? { phone } : {}),
    });
    if (!r.ok) throw new Error(`UAZAPI respondeu ${r.status}`);
    const data = await r.json();

    const { data: platform, error: platformError } = await supabase.from("imf_platform_instances")
      .select("webhook_enabled")
      .eq("key", WHATSAPP_PAI_KEY)
      .maybeSingle();
    if (platformError) throw platformError;
    if (platform?.webhook_enabled) {
      const webhookReady = await setUazapiPlatformWebhook(token);
      if (!webhookReady) {
        return res.status(503).json({ error: "WhatsApp conectado, mas o webhook público não pôde ser reafirmado." });
      }
    }

    res.json({
      connected: !!data?.connected,
      qrcode: data?.instance?.qrcode || null,
      paircode: data?.instance?.paircode || null,
    });
  } catch (err: any) {
    console.error("Erro POST /api/admin/whatsapp-pai/connect:", err);
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post("/api/admin/whatsapp-pai/webhook/enable", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { token, error } = await ensurePlatformInstance(WHATSAPP_PAI_KEY, WHATSAPP_PAI_LABEL);
    if (!token) return res.status(400).json({ error: error || "Instância ainda sendo preparada." });

    const statusResponse = await fetchWithTimeout(`${UAZAPI_HOST}/instance/status`, { headers: { token } });
    const statusData = await statusResponse.json().catch(() => null);
    if (!statusResponse.ok || !statusData?.status?.connected || !statusData?.status?.loggedIn) {
      return res.status(409).json({ error: "Conecte e autentique o número antes de ativar o recebimento." });
    }
    if (!await setUazapiPlatformWebhook(token, PUBLIC_APP_URL, true)) {
      return res.status(503).json({ error: "Não foi possível ativar o webhook no provedor." });
    }
    const { error: updateError } = await supabase.from("imf_platform_instances")
      .update({ webhook_enabled: true })
      .eq("key", WHATSAPP_PAI_KEY);
    if (updateError) {
      await setUazapiPlatformWebhook(token, PUBLIC_APP_URL, false);
      throw updateError;
    }
    res.json({ webhookEnabled: true });
  } catch (err: any) {
    console.error("Erro POST /api/admin/whatsapp-pai/webhook/enable:", err);
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post("/api/admin/whatsapp-pai/webhook/disable", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: instance, error: instanceError } = await supabase.from("imf_platform_instances")
      .select("uazapi_instance_token")
      .eq("key", WHATSAPP_PAI_KEY)
      .maybeSingle();
    if (instanceError) throw instanceError;
    if (!instance?.uazapi_instance_token) {
      return res.status(400).json({ error: "Nenhuma instância provisionada." });
    }
    const { error: updateError } = await supabase.from("imf_platform_instances")
      .update({ webhook_enabled: false })
      .eq("key", WHATSAPP_PAI_KEY);
    if (updateError) throw updateError;
    if (!await setUazapiPlatformWebhook(instance.uazapi_instance_token, PUBLIC_APP_URL, false)) {
      await supabase.from("imf_platform_instances")
        .update({ webhook_enabled: true })
        .eq("key", WHATSAPP_PAI_KEY);
      return res.status(503).json({ error: "Não foi possível desativar o webhook no provedor." });
    }
    res.json({ webhookEnabled: false });
  } catch (err: any) {
    console.error("Erro POST /api/admin/whatsapp-pai/webhook/disable:", err);
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post("/api/admin/whatsapp-pai/disconnect", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: instance } = await supabase.from("imf_platform_instances").select("uazapi_instance_token").eq("key", WHATSAPP_PAI_KEY).maybeSingle();
    if (!instance?.uazapi_instance_token) {
      return res.status(400).json({ error: "Nenhuma instância provisionada pra desconectar." });
    }
    await disconnectUazapiInstance(instance.uazapi_instance_token);
    res.json({ disconnected: true });
  } catch (err: any) {
    console.error("Erro POST /api/admin/whatsapp-pai/disconnect:", err);
    res.status(500).json({ error: err.message });
  }
});
