import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";

export const contactsRouter = express.Router();

contactsRouter.get("/api/contacts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_contacts")
      .select("id, name, phone, notes, created_at")
      .eq("broker_id", brokerId)
      .order("name", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

contactsRouter.post("/api/contacts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { name, phone, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nome é obrigatório." });
    if (!phone?.trim()) return res.status(400).json({ error: "Telefone é obrigatório." });

    const { data, error } = await supabase
      .from("imf_contacts")
      .insert({ broker_id: brokerId, name: name.trim(), phone: normalizePhoneBR(phone), notes: notes || null })
      .select("id, name, phone, notes, created_at")
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

contactsRouter.patch("/api/contacts/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { id } = req.params;
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.phone !== undefined) updates.phone = normalizePhoneBR(req.body.phone);
    if (req.body.notes !== undefined) updates.notes = req.body.notes || null;

    const { data, error } = await supabase
      .from("imf_contacts")
      .update(updates)
      .eq("id", id)
      .eq("broker_id", brokerId)
      .select("id, name, phone, notes, created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Contato não encontrado." });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

contactsRouter.delete("/api/contacts/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { id } = req.params;
    const { data, error } = await supabase
      .from("imf_contacts")
      .delete()
      .eq("id", id)
      .eq("broker_id", brokerId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Contato não encontrado." });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
