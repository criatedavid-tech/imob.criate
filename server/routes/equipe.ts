import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const equipeRouter = express.Router();

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
