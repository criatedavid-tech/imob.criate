import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";

export const corretoraRouter = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// CORRETORA (imobiliária) — vínculo N:1 (broker → corretora)
// ─────────────────────────────────────────────────────────────────────────

// Retorna a corretora vinculada ao corretor logado
corretoraRouter.get("/api/corretora", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    const { data: broker } = await supabase.from('imf_brokers')
      .select('corretora_id').eq('id', brokerId).single();

    if (!broker?.corretora_id) return res.json({ corretora: null });

    const { data: corretora } = await supabase.from('corretoras')
      .select('*').eq('id', broker.corretora_id).single();

    res.json({ corretora, isOwner: corretora?.owner_broker_id === brokerId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cria/atualiza a corretora e vincula o corretor logado (upsert por CNPJ)
corretoraRouter.post("/api/corretora", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    const { razao_social, cnpj, creci_empresa, endereco, telefone, email } = req.body;
    if (!razao_social || !cnpj) {
      return res.status(400).json({ error: "Razão social e CNPJ são obrigatórios." });
    }
    const cnpjClean = String(cnpj).replace(/\D/g, '');

    // Já existe corretora com este CNPJ? vincula a ela; senão cria
    const { data: existing } = await supabase.from('corretoras')
      .select('*').eq('cnpj', cnpjClean).maybeSingle();

    let corretora = existing;
    if (existing) {
      // Só o owner pode editar os dados da corretora existente
      if (existing.owner_broker_id === brokerId) {
        const { data: upd } = await supabase.from('corretoras').update({
          razao_social, creci_empresa: creci_empresa || null,
          endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
          email: email || null, updated_at: new Date().toISOString()
        }).eq('id', existing.id).select().single();
        corretora = upd || existing;
      }
    } else {
      const { data: created, error: cErr } = await supabase.from('corretoras').insert({
        razao_social, cnpj: cnpjClean, creci_empresa: creci_empresa || null,
        endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
        email: email || null, owner_broker_id: brokerId
      }).select().single();
      if (cErr) throw cErr;
      corretora = created;
    }

    // Vincula o corretor logado à corretora
    await supabase.from('imf_brokers')
      .update({ corretora_id: corretora.id, updated_at: new Date() })
      .eq('id', brokerId);

    res.json({ corretora, isOwner: corretora.owner_broker_id === brokerId });
  } catch (err: any) {
    console.error("Erro POST /api/corretora:", err);
    res.status(500).json({ error: err.message });
  }
});

// Lista os corretores vinculados à corretora (apenas o owner/admin da corretora vê)
corretoraRouter.get("/api/corretora/brokers", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    const { data: broker } = await supabase.from('imf_brokers')
      .select('corretora_id').eq('id', brokerId).single();
    if (!broker?.corretora_id) return res.json({ brokers: [] });

    const { data: corretora } = await supabase.from('corretoras')
      .select('owner_broker_id').eq('id', broker.corretora_id).single();
    if (corretora?.owner_broker_id !== brokerId) {
      return res.status(403).json({ error: "Apenas o administrador da corretora pode ver os corretores vinculados." });
    }

    const { data: brokers } = await supabase.from('imf_brokers')
      .select('id, name, email, phone, status, created_at')
      .eq('corretora_id', broker.corretora_id)
      .order('created_at', { ascending: true });

    res.json({ brokers: brokers || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
