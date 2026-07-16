import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";

export const contactsRouter = express.Router();

const MAX_PAGINATION_OFFSET = 10_000_000;

contactsRouter.get("/api/contacts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > MAX_PAGINATION_OFFSET) {
      return res.status(400).json({ error: `limit deve estar entre 1 e 200; offset deve ser um inteiro entre 0 e ${MAX_PAGINATION_OFFSET}.` });
    }

    const { data, error, count } = await supabase
      .from("imf_contacts")
      .select("id, name, phone, notes, created_at", { count: "exact" })
      .eq("broker_id", brokerId)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const total = count || 0;
    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Has-More", String(offset + (data?.length || 0) < total));
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
