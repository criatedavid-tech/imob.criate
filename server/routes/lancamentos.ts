import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const lancamentosRouter = express.Router();

// Etapa 7 do UX_MASTERPLAN.md — núcleo real: empreendimento + espelho de
// unidades, reserva com trava por tempo (expira sozinha). Tabela de preço
// avançada/simulador/proposta+PIX/backoffice de documentos ficam para depois.

async function ownsDevelopment(brokerId: string, developmentId: string): Promise<boolean> {
  const { data } = await supabase
    .from("imf_developments")
    .select("id")
    .eq("id", developmentId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  return !!data;
}

// Libera sozinha reserva vencida — chamado antes de devolver unidades pro cliente,
// pra tela nunca mostrar "reservado" com prazo já expirado.
async function releaseExpiredReservations(developmentId: string) {
  await supabase
    .from("imf_units")
    .update({ status: "disponivel", reserved_until: null, buyer_name: null, buyer_phone: null })
    .eq("development_id", developmentId)
    .eq("status", "reservado")
    .lt("reserved_until", new Date().toISOString());
}

lancamentosRouter.get("/api/lancamentos/developments", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: developments, error } = await supabase
      .from("imf_developments")
      .select("*, imf_units(status)")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json((developments || []).map((d: any) => {
      const units = d.imf_units || [];
      return {
        id: d.id,
        name: d.name,
        location: d.location,
        created_at: d.created_at,
        total_units: units.length,
        disponivel: units.filter((u: any) => u.status === "disponivel").length,
        reservado: units.filter((u: any) => u.status === "reservado").length,
        vendido: units.filter((u: any) => u.status === "vendido").length,
      };
    }));
  } catch (err: any) {
    console.error("Erro GET /api/lancamentos/developments:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.post("/api/lancamentos/developments", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { name, location, tipo, amenities, subtipo, images } = req.body;
    if (!name) return res.status(400).json({ error: "name é obrigatório." });
    if (tipo && tipo !== "vertical" && tipo !== "horizontal") {
      return res.status(400).json({ error: "tipo deve ser 'vertical' ou 'horizontal'." });
    }
    if (subtipo && subtipo !== "loteamento" && subtipo !== "condominio_casas") {
      return res.status(400).json({ error: "subtipo deve ser 'loteamento' ou 'condominio_casas'." });
    }

    const { data, error } = await supabase
      .from("imf_developments")
      .insert({
        broker_id: brokerId,
        name,
        location: location || null,
        tipo: tipo || "vertical",
        subtipo: tipo === "horizontal" ? (subtipo || "loteamento") : null,
        amenities: Array.isArray(amenities) ? amenities : [],
        images: Array.isArray(images) ? images.slice(0, 15) : [],
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/lancamentos/developments:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.patch("/api/lancamentos/developments/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsDevelopment(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const { name, location, tipo, amenities, subtipo, images } = req.body;
    if (tipo && tipo !== "vertical" && tipo !== "horizontal") {
      return res.status(400).json({ error: "tipo deve ser 'vertical' ou 'horizontal'." });
    }
    if (subtipo && subtipo !== "loteamento" && subtipo !== "condominio_casas") {
      return res.status(400).json({ error: "subtipo deve ser 'loteamento' ou 'condominio_casas'." });
    }

    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (location !== undefined) updates.location = location || null;
    if (tipo !== undefined) updates.tipo = tipo;
    if (amenities !== undefined) updates.amenities = Array.isArray(amenities) ? amenities : [];
    if (images !== undefined) updates.images = Array.isArray(images) ? images.slice(0, 15) : [];
    if (tipo !== undefined) updates.subtipo = tipo === "horizontal" ? (subtipo || "loteamento") : null;
    else if (subtipo !== undefined) updates.subtipo = subtipo;

    const { data, error } = await supabase
      .from("imf_developments")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/lancamentos/developments/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.delete("/api/lancamentos/developments/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsDevelopment(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    // Unidades somem juntas — FK imf_units.development_id é ON DELETE CASCADE.
    const { error } = await supabase.from("imf_developments").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/lancamentos/developments/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.get("/api/lancamentos/developments/:id/units", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsDevelopment(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    await releaseExpiredReservations(req.params.id);

    const { data, error } = await supabase
      .from("imf_units")
      .select("*")
      .eq("development_id", req.params.id)
      .order("code", { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error("Erro GET /api/lancamentos/developments/:id/units:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.post("/api/lancamentos/developments/:id/units", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsDevelopment(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const { code, price_cents, quartos, vagas_garagem, area_m2, orientacao, andar, area_lote_m2, testada_m } = req.body;
    if (!code) return res.status(400).json({ error: "code é obrigatório." });
    if (orientacao && orientacao !== "nascente" && orientacao !== "poente") {
      return res.status(400).json({ error: "orientacao deve ser 'nascente' ou 'poente'." });
    }

    const { data, error } = await supabase
      .from("imf_units")
      .insert({
        development_id: req.params.id,
        code,
        price_cents: price_cents || null,
        quartos: quartos ?? null,
        vagas_garagem: vagas_garagem ?? null,
        area_m2: area_m2 ?? null,
        orientacao: orientacao || null,
        andar: andar ?? null,
        area_lote_m2: area_lote_m2 ?? null,
        testada_m: testada_m ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Já existe uma unidade com esse código neste empreendimento." });
      throw error;
    }
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/lancamentos/developments/:id/units:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ação única pra reservar/vender/liberar — evita 3 endpoints quase iguais.
lancamentosRouter.patch("/api/lancamentos/units/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: unit } = await supabase.from("imf_units").select("id, development_id").eq("id", req.params.id).maybeSingle();
    if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const { action, buyer_name, buyer_phone, hold_hours, price_cents, code, quartos, vagas_garagem, area_m2, orientacao, andar, area_lote_m2, testada_m } = req.body;
    if (orientacao && orientacao !== "nascente" && orientacao !== "poente") {
      return res.status(400).json({ error: "orientacao deve ser 'nascente' ou 'poente'." });
    }
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    if (action === "reservar") {
      if (!buyer_name) return res.status(400).json({ error: "buyer_name é obrigatório pra reservar." });
      updates.status = "reservado";
      updates.buyer_name = buyer_name;
      updates.buyer_phone = buyer_phone || null;
      updates.reserved_until = new Date(Date.now() + (Number(hold_hours) || 1) * 3600_000).toISOString();
    } else if (action === "vender") {
      updates.status = "vendido";
      updates.buyer_name = buyer_name || undefined;
      updates.buyer_phone = buyer_phone || undefined;
      updates.reserved_until = null;
      // Quem fecha a venda — usado por Financeiro/Relatórios pra não
      // misturar a receita de um corretor com a de outro na mesma conta.
      updates.sold_by_user_id = userId;
    } else if (action === "liberar") {
      updates.status = "disponivel";
      updates.buyer_name = null;
      updates.buyer_phone = null;
      updates.reserved_until = null;
      updates.sold_by_user_id = null;
    } else if (action === "estender") {
      // Estende a partir de AGORA (não da data original) — reflete o pedido
      // real do cockpit ("estendo mais 30min?"), não soma em cima do prazo vencido.
      const { data: current } = await supabase.from("imf_units").select("status").eq("id", req.params.id).maybeSingle();
      if (current?.status !== "reservado") return res.status(400).json({ error: "Só dá pra estender uma unidade reservada." });
      const minutes = Number(req.body.extend_minutes) || 30;
      updates.reserved_until = new Date(Date.now() + minutes * 60_000).toISOString();
    } else {
      if (price_cents !== undefined) updates.price_cents = price_cents;
      if (code !== undefined) updates.code = code;
      if (quartos !== undefined) updates.quartos = quartos;
      if (vagas_garagem !== undefined) updates.vagas_garagem = vagas_garagem;
      if (area_m2 !== undefined) updates.area_m2 = area_m2;
      if (orientacao !== undefined) updates.orientacao = orientacao || null;
      if (andar !== undefined) updates.andar = andar;
      if (area_lote_m2 !== undefined) updates.area_lote_m2 = area_lote_m2;
      if (testada_m !== undefined) updates.testada_m = testada_m;
    }

    const { data, error } = await supabase
      .from("imf_units")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/lancamentos/units/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

lancamentosRouter.delete("/api/lancamentos/units/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: unit } = await supabase.from("imf_units").select("id, development_id").eq("id", req.params.id).maybeSingle();
    if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const { error } = await supabase.from("imf_units").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/lancamentos/units/:id:", err);
    res.status(500).json({ error: err.message });
  }
});
