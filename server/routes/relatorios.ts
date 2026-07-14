import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";

export const relatoriosRouter = express.Router();

// Etapa 11 do UX_MASTERPLAN.md — a parte que é dado real e determinístico:
// métricas de conversão, leads ao longo do tempo, receita do período. A camada
// "a IA escreve o relatório em linguagem natural" pluga no mesmo agente
// (server/services/agent.ts) quando a chave de IA tiver cota — por ora o resumo
// é montado a partir dos números reais, sem inventar nada.
relatoriosRouter.get("/api/relatorios/summary", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) {
      return res.json({ totalLeads: 0, closedLeads: 0, conversionRate: 0, byStage: {}, byMonth: [], revenueCents: 0, visitsDone: 0, visitsTotal: 0 });
    }
    const owner = await isBrokerOwner(userId, brokerId);

    const months = Math.min(12, Math.max(3, Number(req.query.months) || 6));
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1), 1);
    since.setHours(0, 0, 0, 0);

    const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const ids = (propIds || []).map((p: any) => p.id);

    let leads: any[] = [];
    if (ids.length > 0) {
      let leadsQuery = supabase.from("leads").select("status, created_at, closed_at").in("property_id", ids).gte("created_at", since.toISOString());
      if (!owner) leadsQuery = leadsQuery.eq("owner_user_id", userId);
      const { data } = await leadsQuery;
      leads = data || [];
    }

    const byStage: Record<string, number> = {};
    let closedLeads = 0;
    for (const l of leads) {
      const s = l.status || "new";
      byStage[s] = (byStage[s] || 0) + 1;
      if (l.closed_at) closedLeads++;
    }
    const totalLeads = leads.length;
    const conversionRate = totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0;

    // leads por mês (buckets dos últimos N meses, na ordem cronológica)
    const buckets: { key: string; label: string; count: number }[] = [];
    const base = new Date(since);
    for (let i = 0; i < months; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("pt-BR", { month: "short" }),
        count: 0,
      });
    }
    for (const l of leads) {
      const d = new Date(l.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.find((x) => x.key === key);
      if (b) b.count++;
    }

    // receita do período: locação ativa (mensal) + unidades vendidas (total)
    const { data: rentals } = await supabase
      .from("imf_rental_contracts")
      .select("rent_amount_cents")
      .eq("broker_id", brokerId)
      .eq("status", "ativo");
    const rentalMonthly = (rentals || []).reduce((s: number, c: any) => s + (c.rent_amount_cents || 0), 0);

    const { data: devs } = await supabase.from("imf_developments").select("id").eq("broker_id", brokerId);
    const devIds = (devs || []).map((d: any) => d.id);
    let salesTotal = 0;
    if (devIds.length > 0) {
      let soldQuery = supabase.from("imf_units").select("price_cents").in("development_id", devIds).eq("status", "vendido");
      if (!owner) soldQuery = soldQuery.eq("sold_by_user_id", userId);
      const { data: sold } = await soldQuery;
      salesTotal = (sold || []).reduce((s: number, u: any) => s + (u.price_cents || 0), 0);
    }

    // visitas do período (realizadas vs total)
    let visitsQuery = supabase.from("imf_agenda").select("status").eq("broker_id", brokerId).gte("scheduled_at", since.toISOString());
    if (!owner) visitsQuery = visitsQuery.eq("owner_user_id", userId);
    const { data: visits } = await visitsQuery;
    const visitsTotal = (visits || []).length;
    const visitsDone = (visits || []).filter((v: any) => v.status === "realizado").length;

    res.json({
      months,
      totalLeads,
      closedLeads,
      conversionRate,
      byStage,
      byMonth: buckets.map((b) => ({ label: b.label, count: b.count })),
      revenueCents: rentalMonthly + salesTotal,
      rentalMonthlyCents: rentalMonthly,
      salesTotalCents: salesTotal,
      visitsDone,
      visitsTotal,
    });
  } catch (err: any) {
    console.error("Erro GET /api/relatorios/summary:", err);
    res.status(500).json({ error: err.message });
  }
});
