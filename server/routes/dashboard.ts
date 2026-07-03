import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const dashboardRouter = express.Router();

// NOVO: implementado em 30/04/2026 - não altera legado
dashboardRouter.get("/api/dashboard/metrics", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 });

    // Count properties
    const { count: propertyCount, error: propError } = await supabase
      .from('imf_properties')
      .select('*', { count: 'exact', head: true })
      .eq('broker_id', brokerId);

    if (propError) throw propError;

    // Count leads for these properties
    // First get property IDs
    const { data: propIds, error: idsError } = await supabase
      .from('imf_properties')
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

dashboardRouter.get("/api/dashboard/charts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: propIds } = await supabase
      .from('imf_properties')
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
