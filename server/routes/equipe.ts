import express from "express";
import { randomBytes } from "node:crypto";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, invalidateIdentityCache } from "../middleware/auth";
import { MEMBER_WHATSAPP_SLOT_MAX, PUBLIC_APP_URL } from "../config";
import { subscriptionValueForMemberLimit } from "../services/billing";

export const equipeRouter = express.Router();

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

equipeRouter.get("/api/equipe/goal", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json({ goal: null, progress: 0 });

    const month = currentMonthStart();
    const { data: goalRow, error: goalError } = await supabase
      .from("imf_broker_goals")
      .select("deals_goal")
      .eq("broker_id", brokerId)
      .eq("month", month)
      .maybeSingle();
    if (goalError) throw goalError;

    const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const ids = (propIds || []).map((p: any) => p.id);

    let progress = 0;
    if (ids.length > 0) {
      const { count, error: countError } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .in("property_id", ids)
        .gte("closed_at", month);
      if (countError) throw countError;
      progress = count || 0;
    }

    res.json({ goal: goalRow?.deals_goal ?? null, progress, month });
  } catch (err: any) {
    console.error("Erro GET /api/equipe/goal:", err);
    res.status(500).json({ error: err.message });
  }
});

equipeRouter.post("/api/equipe/goal", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { deals_goal } = req.body;
    const goal = Number(deals_goal);
    if (!goal || goal <= 0) return res.status(400).json({ error: "Meta precisa ser maior que zero." });

    const month = currentMonthStart();
    const { data, error } = await supabase
      .from("imf_broker_goals")
      .upsert({ broker_id: brokerId, month, deals_goal: goal, updated_at: new Date().toISOString() }, { onConflict: "broker_id,month" })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error("Erro POST /api/equipe/goal:", err);
    res.status(500).json({ error: err.message });
  }
});

// Multi-usuário leve: qualquer membro vê a lista, só o dono original
// (imf_brokers.user_id) convida ou remove — sem hierarquia além disso.
async function isOwner(userId: string, brokerId: string): Promise<boolean> {
  const { data } = await supabase.from("imf_brokers").select("id").eq("id", brokerId).eq("user_id", userId).maybeSingle();
  return !!data;
}

equipeRouter.get("/api/equipe/members", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: broker } = await supabase.from("imf_brokers").select("user_id, name, email").eq("id", brokerId).maybeSingle();
    const { data: members, error } = await supabase
      .from("imf_broker_members")
      .select("user_id, created_at")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const list = await Promise.all((members || []).map(async (m: any) => {
      const isOwnerRow = m.user_id === broker?.user_id;
      if (isOwnerRow) {
        return { user_id: m.user_id, name: broker?.name || "Dono da conta", email: broker?.email || "", is_owner: true, created_at: m.created_at };
      }
      const { data: userData } = await supabase.auth.admin.getUserById(m.user_id).catch(() => ({ data: { user: null } } as any));
      const u = userData?.user;
      return {
        user_id: m.user_id,
        name: u?.user_metadata?.full_name || u?.email?.split("@")[0] || "Membro",
        email: u?.email || "",
        is_owner: false,
        created_at: m.created_at,
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

    const { data: broker } = await supabase.from("imf_brokers").select("account_type, member_limit").eq("id", brokerId).maybeSingle();
    if (!broker) return res.status(404).json({ error: "Broker not found" });

    const { count: inUse } = await supabase
      .from("imf_broker_members")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerId)
      .eq("whatsapp_mode", "own");

    const memberLimit = broker.member_limit || 0;
    res.json({
      applicable: broker.account_type !== "corretor",
      is_owner: await isOwner(userId, brokerId),
      member_limit: memberLimit,
      in_use: inUse || 0,
      max_slots: MEMBER_WHATSAPP_SLOT_MAX,
      monthly_value: subscriptionValueForMemberLimit(memberLimit),
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
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta pode alterar isso." });

    const { data: broker } = await supabase.from("imf_brokers").select("account_type").eq("id", brokerId).maybeSingle();
    if (!broker) return res.status(404).json({ error: "Broker not found" });
    if (broker.account_type === "corretor") {
      return res.status(400).json({ error: "Corretor não tem Equipe — WhatsApp próprio por membro não se aplica." });
    }

    const desired = Number(req.body?.member_limit);
    if (!Number.isInteger(desired) || desired < 0 || desired > MEMBER_WHATSAPP_SLOT_MAX) {
      return res.status(400).json({ error: `Informe um número inteiro entre 0 e ${MEMBER_WHATSAPP_SLOT_MAX}.` });
    }

    const { count: inUse } = await supabase
      .from("imf_broker_members")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerId)
      .eq("whatsapp_mode", "own");
    if (desired < (inUse || 0)) {
      return res.status(400).json({
        error: `Você tem ${inUse} membro(s) usando WhatsApp próprio hoje. Troque-os para compartilhado (ou remova-os da equipe) antes de reduzir abaixo disso.`,
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
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta pode convidar membros." });

    // Dono escolhe, PARA ESSE convite específico, se o corretor vai ter
    // WhatsApp próprio ou compartilhar o da conta — "própria" só até o
    // limite contratado (member_limit, self-service em Config → Equipe
    // desde 17/07, ou ainda ajustável manualmente pelo admin). Provisionamento
    // de verdade só acontece no aceite (POST /api/auth/join), com o valor
    // gravado aqui.
    const whatsappMode = req.body?.whatsapp_mode === "own" ? "own" : "shared";

    if (whatsappMode === "own") {
      const { data: brokerRow } = await supabase.from("imf_brokers").select("member_limit").eq("id", brokerId).maybeSingle();
      const limit = brokerRow?.member_limit || 0;
      if (limit <= 0) {
        return res.status(400).json({ error: "Seu plano não inclui WhatsApp próprio para membros da equipe." });
      }
      const { count } = await supabase
        .from("imf_broker_members")
        .select("id", { count: "exact", head: true })
        .eq("broker_id", brokerId)
        .eq("whatsapp_mode", "own");
      if ((count || 0) >= limit) {
        return res.status(400).json({ error: `Limite de ${limit} corretor(es) com WhatsApp próprio já atingido no seu plano.` });
      }
    }

    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { error } = await supabase
      .from("imf_broker_invites")
      .insert({ broker_id: brokerId, code, expires_at: expiresAt, whatsapp_mode: whatsappMode });
    if (error) throw error;

    res.status(201).json({ code, url: `${PUBLIC_APP_URL}/equipe/entrar/${code}`, expires_at: expiresAt, whatsapp_mode: whatsappMode });
  } catch (err: any) {
    console.error("Erro POST /api/equipe/members/invite:", err);
    res.status(500).json({ error: err.message });
  }
});

// Convites ainda não aceitos (used_at null) e ainda não expirados — só o dono vê,
// mesma regra de quem pode convidar/remover.
equipeRouter.get("/api/equipe/invites", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta pode ver os convites." });

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
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta pode revogar convites." });

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
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta pode remover membros." });

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
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/equipe/members/:userId:", err);
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
    if (!(await isOwner(userId, brokerId))) return res.status(403).json({ error: "Só o dono da conta vê o ranking." });

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
