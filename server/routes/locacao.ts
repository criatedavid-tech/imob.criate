import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const locacaoRouter = express.Router();

// Etapa 6 do UX_MASTERPLAN.md — núcleo real: contrato de locação (CRUD +
// encerrar). Reajuste/repasse/boletos/DIMOB/vistoria/portal ficam para depois.

locacaoRouter.get("/api/locacao/contracts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .select("*, imf_properties(title)")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json((data || []).map((c: any) => ({
      ...c,
      property: c.imf_properties?.title || null,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/contracts:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.post("/api/locacao/contracts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const {
      property_id, tenant_name, tenant_phone, owner_name, owner_phone,
      rent_amount_cents, due_day, start_date, end_date, notes,
    } = req.body;

    if (!tenant_name || !owner_name) {
      return res.status(400).json({ error: "tenant_name e owner_name são obrigatórios." });
    }
    if (!rent_amount_cents || !due_day || !start_date) {
      return res.status(400).json({ error: "rent_amount_cents, due_day e start_date são obrigatórios." });
    }

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .insert({
        broker_id: brokerId,
        property_id: property_id || null,
        tenant_name, tenant_phone: tenant_phone || null,
        owner_name, owner_phone: owner_phone || null,
        rent_amount_cents, due_day, start_date,
        end_date: end_date || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/locacao/contracts:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.patch("/api/locacao/contracts/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const allowed = [
      "tenant_name", "tenant_phone", "owner_name", "owner_phone",
      "rent_amount_cents", "due_day", "start_date", "end_date", "status", "notes",
    ];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .update(updates)
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: "Acesso negado." });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/locacao/contracts/:id:", err);
    res.status(500).json({ error: err.message });
  }
});
