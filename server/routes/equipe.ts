import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, invalidateIdentityCache } from "../middleware/auth";
import { requireAccountCapability } from "../services/accountCapabilities";
import { MEMBER_WHATSAPP_SLOT_MAX, MEMBER_WHATSAPP_SLOT_PRICE, PUBLIC_APP_URL } from "../config";
import { subscriptionValueForMemberLimit } from "../services/billing";
import { disconnectUazapiInstance } from "../services/provisioning";
import { collectPages, collectForIds, reportPeriod } from "./relatorios";
import {
  hasPermission,
  setMemberPermission,
  applyPermissionProfile,
  invalidateMemberPermissionsCache,
  resolveMemberPermissions,
  MODULE_ACTIONS,
  PERMISSION_MODULES,
  PROFILE_KEYS,
  PROFILE_LABELS,
  BUILT_IN_PROFILES,
  isValidGrant,
  type PermissionModule,
  type PermissionAction,
  type ProfileKey,
} from "../services/permissions";

export const equipeRouter = express.Router();

equipeRouter.use("/api/equipe", requireUser, requireAccountCapability("team"));

const INVITE_TTL_MS = 48 * 3600_000;

// Etapa 9 do UX_MASTERPLAN.md — só a parte que dá pra construir sem inventar
// dado: meta pessoal do mês vs. progresso real (negócios fechados de
// verdade, via leads.closed_at). Roster de corretores, hierarquia,
// ranking e distribuição de leads dependem do produto suportar múltiplos
// usuários por conta — não existe ainda (hoje 1 conta = 1 corretor), fica
// como decisão em aberto (ver UX_MASTERPLAN.md).

function currentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
}

// Multi-usuário leve: qualquer membro vê a lista, só o dono original
// (imf_brokers.user_id) convida ou remove — sem hierarquia além disso.
async function isOwner(userId: string, brokerId: string): Promise<boolean> {
  const { data } = await supabase.from("imf_brokers").select("id").eq("id", brokerId).eq("user_id", userId).maybeSingle();
  return !!data;
}

// Conta o total de negócios fechados no mês para um user_id específico,
// escopado ao broker. Um lead pertence ao broker por property_id (imóvel do
// broker) OU, sem imóvel ainda, por broker_id direto — mesmo padrão dual de
// leadBrokerAccess/GET /api/leads/recent (leads.ts:34-55,75-81). É um SELECT
// de contagem, não um UPDATE, então o .or() aqui é seguro (o bug conhecido do
// supabase-js é só .or() combinado com .update().eq()).
async function closedDealsForUser(brokerId: string, targetUserId: string, month: string): Promise<number> {
  const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
  const ids = (propIds || []).map((p: any) => p.id);

  let query = supabase.from("leads").select("id", { count: "exact", head: true }).eq("owner_user_id", targetUserId).gte("closed_at", month);
  query = ids.length > 0
    ? query.or(`property_id.in.(${ids.join(",")}),and(property_id.is.null,broker_id.eq.${brokerId})`)
    : query.eq("broker_id", brokerId).is("property_id", null);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

// GET /goal: titular sem parâmetro vê a meta da CONTA (igual antes). Membro
// comum sem parâmetro vê a PRÓPRIA meta pessoal (autoatendimento), com
// fallback pra meta da conta se ainda não definiu a sua. `member_user_id` é
// só do titular, pra abrir a meta de UM membro específico (ex.: editor na
// tela de Equipe).
equipeRouter.get("/api/equipe/goal", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json({ goal: null, progress: 0 });

    const owner = await isOwner(userId, brokerId);
    const requestedMember = typeof req.query.member_user_id === "string" ? req.query.member_user_id : null;
    if (requestedMember && !(await hasPermission(userId, brokerId, "equipe", "editar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver a meta de outro membro." });
    }

    let targetUserId: string | null = null; // null = meta da conta inteira
    if (requestedMember) {
      const { data: memberRow } = await supabase.from("imf_broker_members").select("user_id").eq("broker_id", brokerId).eq("user_id", requestedMember).maybeSingle();
      if (!memberRow) return res.status(404).json({ error: "Membro não encontrado nesta conta." });
      targetUserId = requestedMember;
    } else if (!owner) {
      targetUserId = userId;
    }

    const month = currentMonthStart();
    let goalQuery = supabase.from("imf_broker_goals").select("deals_goal").eq("broker_id", brokerId).eq("month", month);
    goalQuery = targetUserId ? goalQuery.eq("user_id", targetUserId) : goalQuery.is("user_id", null);
    const { data: goalRow, error: goalError } = await goalQuery.maybeSingle();
    if (goalError) throw goalError;

    let effectiveGoal = goalRow?.deals_goal ?? null;
    let fallback = false;
    if (targetUserId && effectiveGoal === null) {
      const { data: accountGoalRow } = await supabase.from("imf_broker_goals").select("deals_goal").eq("broker_id", brokerId).eq("month", month).is("user_id", null).maybeSingle();
      effectiveGoal = accountGoalRow?.deals_goal ?? null;
      fallback = true;
    }

    let progress = 0;
    if (targetUserId) {
      progress = await closedDealsForUser(brokerId, targetUserId, month);
    } else {
      const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
      const ids = (propIds || []).map((p: any) => p.id);
      if (ids.length > 0) {
        const { count, error: countError } = await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .in("property_id", ids)
          .gte("closed_at", month);
        if (countError) throw countError;
        progress = count || 0;
      }
    }

    res.json({ goal: effectiveGoal, progress, month, scope: targetUserId ? "member" : "account", fallback });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/goal:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /goal: sem user_id -> só titular grava a meta da conta (bug corrigido
// aqui: antes qualquer membro conseguia reescrever a meta da conta inteira).
// Com user_id -> titular grava a de qualquer membro; um membro comum só
// grava a PRÓPRIA (nunca a de outro, nunca a da conta).
equipeRouter.post("/api/equipe/goal", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const owner = await isOwner(userId, brokerId);
    // Sem user_id no body: titular grava a meta da CONTA (igual antes); membro
    // comum grava a PRÓPRIA meta pessoal (autoatendimento - é o que o card
    // "Meta do mês" já chama hoje sem precisar de nenhuma mudança no front).
    const rawTargetUserId = req.body?.user_id ? String(req.body.user_id) : null;
    const targetUserId = rawTargetUserId || (owner ? null : userId);

    if (targetUserId && targetUserId !== userId && !(await hasPermission(userId, brokerId, "equipe", "editar"))) {
      return res.status(403).json({ error: "Você não tem permissão para definir a meta de outro membro." });
    }
    if (targetUserId && targetUserId !== userId) {
      const { data: memberRow } = await supabase.from("imf_broker_members").select("user_id").eq("broker_id", brokerId).eq("user_id", targetUserId).maybeSingle();
      if (!memberRow) return res.status(404).json({ error: "Membro não encontrado nesta conta." });
    }

    const { deals_goal } = req.body;
    const goal = Number(deals_goal);
    if (!goal || goal <= 0) return res.status(400).json({ error: "Meta precisa ser maior que zero." });

    const month = currentMonthStart();
    // As metas de conta (user_id NULL) e de pessoa (user_id preenchido) usam
    // dois índices únicos PARCIAIS (migration 20260805c) — o PostgREST não
    // mira um índice parcial via upsert(onConflict), então SELECT primeiro,
    // depois UPDATE ou INSERT (mesmo padrão já usado em properties.ts).
    let existingQuery = supabase.from("imf_broker_goals").select("id").eq("broker_id", brokerId).eq("month", month);
    existingQuery = targetUserId ? existingQuery.eq("user_id", targetUserId) : existingQuery.is("user_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    let data;
    if (existing) {
      const { data: updated, error } = await supabase
        .from("imf_broker_goals")
        .update({ deals_goal: goal, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      data = updated;
    } else {
      const { data: inserted, error } = await supabase
        .from("imf_broker_goals")
        .insert({ broker_id: brokerId, month, user_id: targetUserId, deals_goal: goal })
        .select()
        .single();
      if (error) throw error;
      data = inserted;
    }

    res.json(data);
  } catch (err: any) {
    console.error("Erro POST /api/equipe/goal:", err);
    res.status(500).json({ error: err.message });
  }
});

function effectiveWhatsappMemberLimit(broker: {
  plan?: string | null;
  member_limit?: number | null;
  trial_whatsapp_member_limit?: number | null;
}): number {
  return broker.plan === "experimentacao"
    ? Number(broker.trial_whatsapp_member_limit || 0)
    : Number(broker.member_limit || 0);
}

equipeRouter.get("/api/equipe/members", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: broker } = await supabase.from("imf_brokers").select("user_id, name, email").eq("id", brokerId).maybeSingle();
    const { data: members, error } = await supabase
      .from("imf_broker_members")
      .select("user_id, created_at, suspended_at")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const list = await Promise.all((members || []).map(async (m: any) => {
      const isOwnerRow = m.user_id === broker?.user_id;
      if (isOwnerRow) {
        return { user_id: m.user_id, name: broker?.name || "Dono da conta", email: broker?.email || "", is_owner: true, created_at: m.created_at, suspended_at: m.suspended_at ?? null };
      }
      const { data: userData } = await supabase.auth.admin.getUserById(m.user_id).catch(() => ({ data: { user: null } } as any));
      const u = userData?.user;
      return {
        user_id: m.user_id,
        name: u?.user_metadata?.full_name || u?.email?.split("@")[0] || "Membro",
        email: u?.email || "",
        is_owner: false,
        created_at: m.created_at,
        suspended_at: m.suspended_at ?? null,
      };
    }));

    res.json(list);
  } catch (err: any) {
    console.error("Erro GET /api/equipe/members:", err);
    res.status(500).json({ error: err.message });
  }
});

// Estado atual da cota de WhatsApp próprio de equipe (self-service desde
// 17/07 — antes só o admin ajustava member_limit manualmente por conta).
// Só faz sentido para imobiliária/incorporadora (corretor não tem Equipe).
equipeRouter.get("/api/equipe/whatsapp-slots", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("user_id, account_type, plan, member_limit, trial_whatsapp_member_limit")
      .eq("id", brokerId)
      .maybeSingle();
    if (!broker) return res.status(404).json({ error: "Broker not found" });

    const { count: inUse } = await supabase
      .from("imf_broker_members")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerId)
      .neq("user_id", broker.user_id)
      .eq("whatsapp_mode", "own");

    const isTrial = broker.plan === "experimentacao";
    const memberLimit = effectiveWhatsappMemberLimit(broker);
    res.json({
      applicable: broker.account_type !== "corretor",
      is_owner: await isOwner(userId, brokerId),
      is_trial: isTrial,
      editable: !isTrial,
      member_limit: memberLimit,
      in_use: inUse || 0,
      max_slots: isTrial ? memberLimit : MEMBER_WHATSAPP_SLOT_MAX,
      monthly_value: isTrial ? 0 : subscriptionValueForMemberLimit(memberLimit),
    });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/whatsapp-slots:", err);
    res.status(500).json({ error: err.message });
  }
});

// Muda a quantidade contratada de WhatsApp próprio de equipe. Efeito de
// acesso é imediato (o dono já pode convidar com o novo limite na hora);
// a cobrança em si só entra no valor da assinatura no PRÓXIMO ciclo — o job
// horário de excedente (prepareOverageBilling) resincroniza o valor da
// assinatura no Asaas antes de cada renovação, então não precisa mexer no
// Asaas aqui pra isso funcionar.
equipeRouter.patch("/api/equipe/whatsapp-slots", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "whatsapp-conexoes", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para alterar isso." });
    }

    const { data: broker } = await supabase.from("imf_brokers").select("user_id, account_type, plan").eq("id", brokerId).maybeSingle();
    if (!broker) return res.status(404).json({ error: "Broker not found" });
    if (broker.account_type === "corretor") {
      return res.status(400).json({ error: "Corretor não tem Equipe — WhatsApp próprio por membro não se aplica." });
    }
    if (broker.plan === "experimentacao") {
      return res.status(403).json({ error: "Durante a experimentação, a cota de WhatsApps próprios é definida pelo voucher." });
    }

    const desired = Number(req.body?.member_limit);
    if (!Number.isInteger(desired) || desired < 0 || desired > MEMBER_WHATSAPP_SLOT_MAX) {
      return res.status(400).json({ error: `Informe um número inteiro entre 0 e ${MEMBER_WHATSAPP_SLOT_MAX}.` });
    }

    const now = new Date().toISOString();
    const [{ count: inUse, error: inUseError }, { count: pending, error: pendingError }] = await Promise.all([
      supabase.from("imf_broker_members").select("id", { count: "exact", head: true })
        .eq("broker_id", brokerId).neq("user_id", broker.user_id).eq("whatsapp_mode", "own"),
      supabase.from("imf_broker_invites").select("id", { count: "exact", head: true })
        .eq("broker_id", brokerId).eq("whatsapp_mode", "own").is("used_at", null).gt("expires_at", now),
    ]);
    if (inUseError) throw inUseError;
    if (pendingError) throw pendingError;
    const reserved = (inUse || 0) + (pending || 0);
    if (desired < reserved) {
      return res.status(400).json({
        error: `Existem ${reserved} vaga(s) de WhatsApp próprio em uso ou reservadas por convite. Revogue os convites pendentes ou remova/troque membros antes de reduzir abaixo disso.`,
      });
    }

    const { data, error } = await supabase.from("imf_brokers").update({ member_limit: desired }).eq("id", brokerId).select("member_limit").single();
    if (error) throw error;

    res.json({
      member_limit: data.member_limit,
      monthly_value: subscriptionValueForMemberLimit(data.member_limit),
    });
  } catch (err: any) {
    console.error("Erro PATCH /api/equipe/whatsapp-slots:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.post("/api/equipe/members/invite", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "equipe", "criar"))) {
      return res.status(403).json({ error: "Você não tem permissão para convidar membros." });
    }

    // Dono escolhe, PARA ESSE convite específico, se o corretor vai ter
    // WhatsApp próprio ou compartilhar o da conta. Quando a cota paga acabou,
    // o primeiro request devolve a oferta; só um segundo request com confirmação
    // explícita aumenta a assinatura e cria o convite atomicamente no banco.
    const whatsappMode = req.body?.whatsapp_mode === "own" ? "own" : "shared";
    const confirmAddWhatsappSlot = req.body?.confirm_add_whatsapp_slot === true;
    const requestIdInput = req.body?.request_id;
    const parsedRequestId = requestIdInput === undefined
      ? { success: true as const, data: randomUUID() }
      : z.string().uuid().safeParse(requestIdInput);
    if (!parsedRequestId.success) {
      return res.status(400).json({ error: "Identificador da solicitação inválido." });
    }
    const requestId = parsedRequestId.data;
    let brokerRow: {
      user_id: string;
      plan: string | null;
      member_limit: number | null;
      trial_whatsapp_member_limit: number | null;
    } | null = null;

    if (whatsappMode === "own") {
      const { data } = await supabase
        .from("imf_brokers")
        .select("user_id, plan, member_limit, trial_whatsapp_member_limit")
        .eq("id", brokerId)
        .maybeSingle();
      brokerRow = data;
      if (!brokerRow) return res.status(404).json({ error: "Broker not found" });
    }

    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { data: inviteResult, error } = await supabase.rpc("imf_create_broker_invite", {
      p_broker_id: brokerId,
      p_code: code,
      p_expires_at: expiresAt,
      p_whatsapp_mode: whatsappMode,
      p_request_id: requestId,
      p_confirm_add_whatsapp_slot: confirmAddWhatsappSlot,
      p_whatsapp_slot_max: MEMBER_WHATSAPP_SLOT_MAX,
    });
    if (error) {
      const message = String(error.message || "");
      if (message.includes("TRIAL_WHATSAPP_LIMIT_REACHED")) {
        return res.status(409).json({
          code: "TRIAL_WHATSAPP_LIMIT_REACHED",
          error: "A cota de WhatsApps próprios deste voucher foi atingida. Convide com o número compartilhado ou solicite outra condição à Criate.",
          can_use_shared: true,
        });
      }
      if (message.includes("WHATSAPP_MEMBER_LIMIT_REACHED") && brokerRow) {
        const currentLimit = Number(brokerRow.member_limit || 0);
        const nextLimit = Math.min(currentLimit + 1, MEMBER_WHATSAPP_SLOT_MAX);
        return res.status(409).json({
          code: "WHATSAPP_SLOT_CONFIRMATION_REQUIRED",
          error: "Confirme a contratação de uma vaga adicional para continuar.",
          current_limit: currentLimit,
          next_limit: nextLimit,
          slot_price: MEMBER_WHATSAPP_SLOT_PRICE,
          slot_price_display: MEMBER_WHATSAPP_SLOT_PRICE.toFixed(2).replace(".", ","),
          next_monthly_value: subscriptionValueForMemberLimit(nextLimit),
          can_use_shared: true,
        });
      }
      if (message.includes("WHATSAPP_MEMBER_SLOT_MAX_REACHED")) {
        return res.status(409).json({
          code: "WHATSAPP_MEMBER_SLOT_MAX_REACHED",
          error: `O limite máximo de ${MEMBER_WHATSAPP_SLOT_MAX} WhatsApps próprios foi atingido. Fale com a Criate para ampliar a capacidade.`,
          can_use_shared: true,
        });
      }
      throw error;
    }

    const result = Array.isArray(inviteResult) ? inviteResult[0] : inviteResult;
    const slotAdded = Boolean(result?.slot_added);
    const memberLimit = Number(result?.member_limit ?? brokerRow?.member_limit ?? 0);
    const inviteCode = String(result?.invite_code || code);
    const inviteMode = result?.invite_whatsapp_mode === "own" ? "own" : "shared";
    const inviteExpiresAt = String(result?.invite_expires_at || expiresAt);

    res.status(201).json({
      code: inviteCode,
      url: `${PUBLIC_APP_URL}/equipe/entrar/${inviteCode}`,
      expires_at: inviteExpiresAt,
      whatsapp_mode: inviteMode,
      slot_added: slotAdded,
      member_limit: memberLimit,
      monthly_value: slotAdded ? subscriptionValueForMemberLimit(memberLimit) : undefined,
    });
  } catch (err: any) {
    console.error("Erro POST /api/equipe/members/invite:", err);
    const message = String(err?.message || "");
    if (message.includes("TRIAL_MEMBER_LIMIT_REACHED")) {
      return res.status(409).json({ error: "O limite de corretores desta experimentação foi atingido." });
    }
    if (message.includes("TRIAL_WHATSAPP_LIMIT_REACHED")) {
      return res.status(409).json({ error: "A cota de corretores com WhatsApp próprio desta experimentação foi atingida." });
    }
    if (message.includes("WHATSAPP_MEMBER_LIMIT_REACHED")) {
      return res.status(409).json({ error: "A cota de corretores com WhatsApp próprio desta conta foi atingida." });
    }
    if (message.includes("TRIAL_EXPIRED")) {
      return res.status(403).json({ error: "O período de experimentação terminou. Contrate um plano para continuar." });
    }
    res.status(500).json({ error: "Não foi possível criar o convite." });
  }
});

// Convites ainda não aceitos (used_at null) e ainda não expirados — só o dono vê,
// mesma regra de quem pode convidar/remover.
equipeRouter.get("/api/equipe/invites", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    if (!(await hasPermission(userId, brokerId, "equipe", "criar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver os convites." });
    }

    const { data, error } = await supabase
      .from("imf_broker_invites")
      .select("id, code, created_at, expires_at, whatsapp_mode")
      .eq("broker_id", brokerId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;

    res.json((data || []).map((i: any) => ({ ...i, url: `${PUBLIC_APP_URL}/equipe/entrar/${i.code}` })));
  } catch (err: any) {
    console.error("Erro GET /api/equipe/invites:", err);
    res.status(500).json({ error: err.message });
  }
});

// Revoga um convite pendente antes que alguém o aceite (ex.: convite enviado
// por engano ou pra número errado).
equipeRouter.delete("/api/equipe/invites/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "equipe", "criar"))) {
      return res.status(403).json({ error: "Você não tem permissão para revogar convites." });
    }

    const { error } = await supabase
      .from("imf_broker_invites")
      .delete()
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .is("used_at", null);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/equipe/invites/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.delete("/api/equipe/members/:userId", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "equipe", "excluir"))) {
      return res.status(403).json({ error: "Você não tem permissão para remover membros." });
    }

    const { data: broker } = await supabase.from("imf_brokers").select("user_id").eq("id", brokerId).maybeSingle();
    if (req.params.userId === broker?.user_id) {
      return res.status(400).json({ error: "Não é possível remover o dono da conta." });
    }

    const { error } = await supabase.from("imf_broker_members").delete().eq("broker_id", brokerId).eq("user_id", req.params.userId);
    if (error) throw error;
    // A identidade (userId -> brokerId / é dono) é cacheada por 60s para tirar
    // 2-3 queries de toda requisição autenticada. Numa REMOÇÃO isso não pode
    // esperar o TTL: sem invalidar, quem acabou de ser removido continuaria
    // enxergando a conta por até um minuto.
    invalidateIdentityCache(req.params.userId);
    invalidateMemberPermissionsCache(brokerId, req.params.userId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/equipe/members/:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Reatribuição de dados (leads/imóveis/agenda) ──────────────────────────
// owner_user_id nunca muda de mãos sozinho hoje - quando um corretor sai, os
// dados dele ficam órfãos pra sempre. Estas duas rotas dão ao titular uma
// forma explícita de mover posse pra outro membro ativo. A ORIGEM não
// precisa mais ser membro atual - permite tanto reatribuir antes de remover
// quanto limpar órfãos de quem já saiu, com o mesmo endpoint.
equipeRouter.get("/api/equipe/members/:userId/data-summary", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(callerId, brokerId, "equipe", "editar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver isso." });
    }

    const targetUserId = req.params.userId;
    const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const ids = (propIds || []).map((p: any) => p.id);

    let leadsQuery = supabase.from("leads").select("id", { count: "exact", head: true }).eq("owner_user_id", targetUserId);
    leadsQuery = ids.length > 0
      ? leadsQuery.or(`property_id.in.(${ids.join(",")}),and(property_id.is.null,broker_id.eq.${brokerId})`)
      : leadsQuery.eq("broker_id", brokerId).is("property_id", null);

    const [{ count: leads, error: leadsErr }, { count: properties, error: propErr }, { count: agenda, error: agendaErr }] = await Promise.all([
      leadsQuery,
      supabase.from("imf_properties").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("owner_user_id", targetUserId),
      supabase.from("imf_agenda").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("owner_user_id", targetUserId),
    ]);
    if (leadsErr) throw leadsErr;
    if (propErr) throw propErr;
    if (agendaErr) throw agendaErr;

    res.json({ leads: leads || 0, properties: properties || 0, agenda: agenda || 0 });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/members/:userId/data-summary:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.post("/api/equipe/members/:userId/reassign", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(callerId, brokerId, "equipe", "editar"))) {
      return res.status(403).json({ error: "Você não tem permissão para reatribuir dados." });
    }

    const fromUserId = req.params.userId;
    const toUserId = String(req.body?.to_user_id || "");
    if (!toUserId) return res.status(400).json({ error: "Informe o membro de destino." });
    if (toUserId === fromUserId) return res.status(400).json({ error: "Escolha um destino diferente da origem." });

    const { data: destMember } = await supabase.from("imf_broker_members").select("suspended_at").eq("broker_id", brokerId).eq("user_id", toUserId).maybeSingle();
    if (!destMember) return res.status(400).json({ error: "O destino precisa ser um membro desta conta." });
    if (destMember.suspended_at) return res.status(400).json({ error: "Não é possível reatribuir para um membro suspenso." });

    // imf_properties e imf_agenda têm broker_id direto - update simples, sem
    // risco do bug de .or() combinado com .update().
    const [{ data: movedProperties, error: propError }, { data: movedAgenda, error: agendaError }] = await Promise.all([
      supabase.from("imf_properties").update({ owner_user_id: toUserId }).eq("broker_id", brokerId).eq("owner_user_id", fromUserId).select("id"),
      supabase.from("imf_agenda").update({ owner_user_id: toUserId }).eq("broker_id", brokerId).eq("owner_user_id", fromUserId).select("id"),
    ]);
    if (propError) throw propError;
    if (agendaError) throw agendaError;

    // leads: SELECT primeiro, UPDATE por id depois - nunca .or() + .update()
    // juntos (bug conhecido do supabase-js, ver leadBrokerAccess em leads.ts).
    const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const ids = (propIds || []).map((p: any) => p.id);
    let leadsSelectQuery = supabase.from("leads").select("id").eq("owner_user_id", fromUserId);
    leadsSelectQuery = ids.length > 0
      ? leadsSelectQuery.or(`property_id.in.(${ids.join(",")}),and(property_id.is.null,broker_id.eq.${brokerId})`)
      : leadsSelectQuery.eq("broker_id", brokerId).is("property_id", null);
    const { data: leadRows, error: leadsSelectError } = await leadsSelectQuery;
    if (leadsSelectError) throw leadsSelectError;
    const leadIds = (leadRows || []).map((l: any) => l.id);

    let movedLeadsCount = 0;
    if (leadIds.length > 0) {
      const { data: updatedLeads, error: leadsUpdateError } = await supabase.from("leads").update({ owner_user_id: toUserId }).in("id", leadIds).select("id");
      if (leadsUpdateError) throw leadsUpdateError;
      movedLeadsCount = (updatedLeads || []).length;
    }

    res.json({
      ok: true,
      moved: {
        leads: movedLeadsCount,
        properties: (movedProperties || []).length,
        agenda: (movedAgenda || []).length,
      },
    });
  } catch (err: any) {
    console.error("Erro POST /api/equipe/members/:userId/reassign:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Suspender/reativar um membro, sem remover ─────────────────────────────
equipeRouter.patch("/api/equipe/members/:userId/suspend", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(callerId, brokerId, "equipe", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para suspender membros." });
    }

    const { data: broker } = await supabase.from("imf_brokers").select("user_id").eq("id", brokerId).maybeSingle();
    if (req.params.userId === broker?.user_id) {
      return res.status(400).json({ error: "Não é possível suspender o dono da conta." });
    }

    const { data: member, error } = await supabase
      .from("imf_broker_members")
      .update({ suspended_at: new Date().toISOString(), suspended_by: callerId })
      .eq("broker_id", brokerId)
      .eq("user_id", req.params.userId)
      .select("uazapi_instance_token, whatsapp_mode")
      .maybeSingle();
    if (error) throw error;
    if (!member) return res.status(404).json({ error: "Membro não encontrado." });

    // A identidade é cacheada por 60s - sem invalidar, o membro suspenso
    // continuaria com acesso por até um minuto (mesmo padrão do DELETE acima).
    invalidateIdentityCache(req.params.userId);
    invalidateMemberPermissionsCache(brokerId, req.params.userId);

    if (member.whatsapp_mode === "own" && member.uazapi_instance_token) {
      disconnectUazapiInstance(member.uazapi_instance_token).catch((e: any) => {
        console.error("Erro ao desconectar WhatsApp do membro suspenso:", e?.message);
      });
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro PATCH /api/equipe/members/:userId/suspend:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.patch("/api/equipe/members/:userId/reactivate", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(callerId, brokerId, "equipe", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para reativar membros." });
    }

    const { error } = await supabase
      .from("imf_broker_members")
      .update({ suspended_at: null, suspended_by: null })
      .eq("broker_id", brokerId)
      .eq("user_id", req.params.userId);
    if (error) throw error;

    invalidateIdentityCache(req.params.userId);
    invalidateMemberPermissionsCache(brokerId, req.params.userId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro PATCH /api/equipe/members/:userId/reactivate:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ranking — só o dono vê (visão gerencial); consistente com a regra de que
// cada membro só enxerga os próprios dados em qualquer outra tela.
equipeRouter.get("/api/equipe/ranking", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "equipe", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver o ranking." });
    }

    const { data: broker } = await supabase.from("imf_brokers").select("user_id, name").eq("id", brokerId).maybeSingle();
    const { data: members } = await supabase.from("imf_broker_members").select("user_id, created_at").eq("broker_id", brokerId);

    const month = currentMonthStart();
    const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const ids = (propIds || []).map((p: any) => p.id);
    const { data: devIdsData } = await supabase.from("imf_developments").select("id").eq("broker_id", brokerId);
    const devIds = (devIdsData || []).map((d: any) => d.id);

    const [{ data: closedLeads }, { data: soldUnits }] = await Promise.all([
      ids.length
        ? supabase.from("leads").select("owner_user_id").in("property_id", ids).gte("closed_at", month).not("owner_user_id", "is", null)
        : Promise.resolve({ data: [] as any[] }),
      devIds.length
        ? supabase.from("imf_units").select("sold_by_user_id, price_cents").in("development_id", devIds).eq("status", "vendido").not("sold_by_user_id", "is", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const closedByUser = new Map<string, number>();
    for (const l of closedLeads || []) closedByUser.set(l.owner_user_id, (closedByUser.get(l.owner_user_id) || 0) + 1);

    const salesByUser = new Map<string, { count: number; totalCents: number }>();
    for (const u of soldUnits || []) {
      const cur = salesByUser.get(u.sold_by_user_id) || { count: 0, totalCents: 0 };
      cur.count += 1;
      cur.totalCents += u.price_cents || 0;
      salesByUser.set(u.sold_by_user_id, cur);
    }

    const ranking = await Promise.all((members || []).map(async (m: any) => {
      const isOwnerRow = m.user_id === broker?.user_id;
      let name = "Membro";
      if (isOwnerRow) {
        name = broker?.name || "Dono da conta";
      } else {
        const { data: userData } = await supabase.auth.admin.getUserById(m.user_id).catch(() => ({ data: { user: null } } as any));
        name = userData?.user?.user_metadata?.full_name || userData?.user?.email?.split("@")[0] || "Membro";
      }
      const sales = salesByUser.get(m.user_id) || { count: 0, totalCents: 0 };
      return {
        user_id: m.user_id,
        name,
        is_owner: isOwnerRow,
        closed_leads_month: closedByUser.get(m.user_id) || 0,
        sales_count_total: sales.count,
        sales_total_cents: sales.totalCents,
      };
    }));

    ranking.sort((a, b) => (b.sales_total_cents - a.sales_total_cents) || (b.closed_leads_month - a.closed_leads_month));

    res.json({ month, ranking });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/ranking:", err);
    res.status(500).json({ error: err.message });
  }
});

// Desempenho de TODA a equipe num período (aba "Desempenho") — diferente do
// /ranking acima (mês corrente, 2 métricas): aqui é o mesmo período
// selecionável (3/6/12 meses) e as mesmas métricas que /api/relatorios/
// summary?member_user_id= já calcula pra UM membro, só que batidas pra
// todos de uma vez (reaproveita collectPages/collectForIds/reportPeriod de
// relatorios.ts, sem duplicar paginação). Inclui membros suspensos
// (marcados), pra não sumir o histórico deles do período.
equipeRouter.get("/api/equipe/performance", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await hasPermission(userId, brokerId, "equipe", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver o desempenho da equipe." });
    }

    const requestedMonths = Number(req.query.months);
    const months = [3, 6, 12].includes(requestedMonths) ? requestedMonths : 6;
    const { start, end } = reportPeriod(months);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const { data: broker } = await supabase.from("imf_brokers").select("user_id, name").eq("id", brokerId).maybeSingle();
    const { data: memberRows } = await supabase
      .from("imf_broker_members")
      .select("user_id, created_at, suspended_at")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: true });

    const properties = await collectPages(
      (from, to) => supabase.from("imf_properties").select("id").eq("broker_id", brokerId).order("id").range(from, to),
      "Falha ao consultar os imóveis",
    );
    const propertyIds = properties.map((p: any) => p.id as string);

    // Mesma convenção de "leads captados" que relatorios.ts já usa: só leads
    // presos a um imóvel do broker (.in("property_id", ids)) — não inclui o
    // caminho alternativo por broker_id direto que a reatribuição usa noutro
    // contexto. Fechamento é cohort separada por closed_at (inclui lead
    // captado antes da janela), igual ao summary.
    const capturedLeads = propertyIds.length ? await collectForIds(propertyIds, (ids, from, to) =>
      supabase.from("leads").select("id, owner_user_id")
        .in("property_id", ids)
        .gte("created_at", startIso).lte("created_at", endIso)
        .order("id").range(from, to), "Falha ao consultar os leads captados da equipe") : [];

    const closedDeals = propertyIds.length ? await collectForIds(propertyIds, (ids, from, to) =>
      supabase.from("leads").select("id, owner_user_id")
        .in("property_id", ids)
        .not("closed_at", "is", null)
        .gte("closed_at", startIso).lte("closed_at", endIso)
        .order("id").range(from, to), "Falha ao consultar os negócios fechados da equipe") : [];

    const developments = await collectPages(
      (from, to) => supabase.from("imf_developments").select("id").eq("broker_id", brokerId).order("id").range(from, to),
      "Falha ao consultar os empreendimentos",
    );
    const developmentIds = developments.map((d: any) => d.id as string);

    const soldUnits = developmentIds.length ? await collectForIds(developmentIds, (ids, from, to) =>
      supabase.from("imf_units").select("id, price_cents, sold_by_user_id")
        .in("development_id", ids)
        .eq("status", "vendido")
        .not("sold_at", "is", null)
        .gte("sold_at", startIso).lte("sold_at", endIso)
        .order("id").range(from, to), "Falha ao consultar as unidades vendidas da equipe") : [];

    const totalByUser = new Map<string, number>();
    for (const l of capturedLeads) if (l.owner_user_id) totalByUser.set(l.owner_user_id, (totalByUser.get(l.owner_user_id) || 0) + 1);

    const closedByUser = new Map<string, number>();
    for (const l of closedDeals) if (l.owner_user_id) closedByUser.set(l.owner_user_id, (closedByUser.get(l.owner_user_id) || 0) + 1);

    const salesByUser = new Map<string, { count: number; totalCents: number }>();
    for (const u of soldUnits) {
      if (!u.sold_by_user_id) continue;
      const cur = salesByUser.get(u.sold_by_user_id) || { count: 0, totalCents: 0 };
      cur.count += 1;
      cur.totalCents += u.price_cents || 0;
      salesByUser.set(u.sold_by_user_id, cur);
    }

    const members = await Promise.all((memberRows || []).map(async (m: any) => {
      const isOwnerRow = m.user_id === broker?.user_id;
      let name = "Membro";
      if (isOwnerRow) {
        name = broker?.name || "Administrador";
      } else {
        const { data: userData } = await supabase.auth.admin.getUserById(m.user_id).catch(() => ({ data: { user: null } } as any));
        name = userData?.user?.user_metadata?.full_name || userData?.user?.email?.split("@")[0] || "Membro";
      }
      const totalLeads = totalByUser.get(m.user_id) || 0;
      const closedLeads = closedByUser.get(m.user_id) || 0;
      const sales = salesByUser.get(m.user_id) || { count: 0, totalCents: 0 };
      const conversionRate = totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0;
      const returnPerLeadCents = totalLeads > 0 ? Math.round(sales.totalCents / totalLeads) : 0;
      return {
        user_id: m.user_id,
        name,
        is_owner: isOwnerRow,
        suspended_at: m.suspended_at ?? null,
        total_leads: totalLeads,
        closed_leads: closedLeads,
        conversion_rate: conversionRate,
        sales_count: sales.count,
        sales_total_cents: sales.totalCents,
        return_per_lead_cents: returnPerLeadCents,
      };
    }));

    members.sort((a, b) => (b.sales_total_cents - a.sales_total_cents) || (b.conversion_rate - a.conversion_rate));

    res.json({ months, periodStart: startIso, periodEnd: endIso, members });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/performance:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Permissões granulares por membro ──────────────────────────────────────
// Gerenciar a grade de outro membro é hard-coded pro isOwner() local acima,
// NUNCA pro requirePermission/hasPermission — mesmo um membro com
// equipe:gerenciar (perfil "Administrador") não mexe aqui. Motivo: se desse
// pra delegar via a própria grade, um membro poderia se auto-conceder
// qualquer coisa, furando o modelo inteiro por dentro.

equipeRouter.get("/api/equipe/permission-profiles", requireUser, async (_req, res) => {
  res.json(
    PROFILE_KEYS.map((key) => ({
      key,
      label: PROFILE_LABELS[key],
      grants: BUILT_IN_PROFILES[key],
    })),
  );
});

async function resolveTargetMember(brokerId: string, targetUserId: string) {
  const { data: broker } = await supabase.from("imf_brokers").select("user_id").eq("id", brokerId).maybeSingle();
  if (targetUserId === broker?.user_id) {
    return { error: "O titular não usa a grade de permissões — o acesso dele já é total e implícito." };
  }
  const { data: memberRow } = await supabase.from("imf_broker_members").select("user_id").eq("broker_id", brokerId).eq("user_id", targetUserId).maybeSingle();
  if (!memberRow) return { error: "Membro não encontrado nesta conta." };
  return { ok: true as const };
}

equipeRouter.get("/api/equipe/members/:userId/permissions", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await isOwner(callerId, brokerId))) return res.status(403).json({ error: "Só o titular gerencia permissões." });

    const check = await resolveTargetMember(brokerId, req.params.userId);
    if ("error" in check) return res.status(400).json({ error: check.error });

    const grants = await resolveMemberPermissions(brokerId, req.params.userId);
    res.json({
      module_actions: MODULE_ACTIONS,
      modules: PERMISSION_MODULES,
      grants: [...grants],
    });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/members/:userId/permissions:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.put("/api/equipe/members/:userId/permissions/:module/:action", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await isOwner(callerId, brokerId))) return res.status(403).json({ error: "Só o titular gerencia permissões." });

    const check = await resolveTargetMember(brokerId, req.params.userId);
    if ("error" in check) return res.status(400).json({ error: check.error });

    const grantKey = `${req.params.module}:${req.params.action}`;
    if (!isValidGrant(grantKey)) {
      return res.status(400).json({ error: "Combinação de módulo e ação inválida." });
    }
    const granted = req.body?.granted === true;

    await setMemberPermission(
      brokerId,
      req.params.userId,
      req.params.module as PermissionModule,
      req.params.action as PermissionAction,
      granted,
      callerId,
    );
    res.json({ ok: true, granted });
  } catch (err: any) {
    console.error("Erro PUT /api/equipe/members/:userId/permissions/:module/:action:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.post("/api/equipe/members/:userId/apply-profile", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await isOwner(callerId, brokerId))) return res.status(403).json({ error: "Só o titular gerencia permissões." });

    const check = await resolveTargetMember(brokerId, req.params.userId);
    if ("error" in check) return res.status(400).json({ error: check.error });

    const profileKey = req.body?.profile_key as ProfileKey;
    if (!PROFILE_KEYS.includes(profileKey)) {
      return res.status(400).json({ error: "Perfil inválido." });
    }

    const { added, removed } = await applyPermissionProfile(brokerId, req.params.userId, profileKey, callerId);
    res.json({ ok: true, added, removed });
  } catch (err: any) {
    console.error("Erro POST /api/equipe/members/:userId/apply-profile:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.get("/api/equipe/members/:userId/permissions/audit", requireUser, async (req, res) => {
  try {
    const callerId = (req as any).userId as string;
    const brokerId = await getBrokerId(callerId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await isOwner(callerId, brokerId))) return res.status(403).json({ error: "Só o titular vê o histórico de permissões." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    let query = supabase
      .from("imf_permission_audit_log")
      .select("id, actor_user_id, change_type, module, action, profile_key, diff, created_at")
      .eq("broker_id", brokerId)
      .eq("target_user_id", req.params.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (typeof req.query.before === "string" && req.query.before) {
      query = query.lt("created_at", req.query.before);
    }
    const { data, error } = await query;
    if (error) throw error;

    const actorIds = [...new Set((data || []).map((r: any) => r.actor_user_id).filter(Boolean))];
    const actorNames = new Map<string, string>();
    await Promise.all(actorIds.map(async (id: string) => {
      const { data: userData } = await supabase.auth.admin.getUserById(id).catch(() => ({ data: { user: null } } as any));
      const u = userData?.user;
      actorNames.set(id, u?.user_metadata?.full_name || u?.email?.split("@")[0] || "Alguém");
    }));

    res.json((data || []).map((r: any) => ({
      ...r,
      actor_name: r.actor_user_id ? (actorNames.get(r.actor_user_id) || "Alguém") : "Sistema",
    })));
  } catch (err: any) {
    console.error("Erro GET /api/equipe/members/:userId/permissions/audit:", err);
    res.status(500).json({ error: err.message });
  }
});
