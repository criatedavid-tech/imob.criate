import express from "express";
import { z } from "zod";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { reservationPaymentLimiter } from "../middleware/rateLimits";
import { normalizePhoneBR } from "../lib/crypto";
import {
  cancelActiveUnitReservation,
  completePaidUnitReservation,
  expireFinancialReservations,
  generateUnitReservationPix,
  getActiveUnitReservation,
} from "../services/unitReservationBilling";

export const lancamentosRouter = express.Router();

function hasValidCpfCnpjChecksum(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const calculate = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (digits.length === 11) {
    const d1 = calculate(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = calculate(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return digits.endsWith(`${d1}${d2}`);
  }
  const d1 = calculate(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calculate(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${d1}${d2}`);
}

const financialReservationSchema = z.object({
  request_key: z.string().uuid("Chave de idempotencia invalida."),
  buyer_name: z.string().trim().min(2, "Nome do comprador e obrigatorio.").max(120),
  buyer_phone: z.string().trim().max(30).optional().default("").refine(
    (value) => !value || value.replace(/\D/g, "").length >= 10,
    "Telefone invalido.",
  ),
  buyer_cpf_cnpj: z.string().trim().refine(hasValidCpfCnpjChecksum, "CPF/CNPJ invalido."),
  signal_amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  hold_hours: z.number().int().min(1).max(168).default(24),
});

// Etapa 7 do UX_MASTERPLAN.md — empreendimento + espelho de unidades,
// simulador local e reserva com trava por tempo e sinal PIX opcional.

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
  await expireFinancialReservations(developmentId);
  const nowIso = new Date().toISOString();
  const { data: expiredUnits } = await supabase
    .from("imf_units")
    .select("id")
    .eq("development_id", developmentId)
    .eq("status", "reservado")
    .lt("reserved_until", nowIso);

  const { data: development } = await supabase
    .from("imf_developments")
    .select("broker_id")
    .eq("id", developmentId)
    .maybeSingle();
  if (!development) return;

  for (const unit of expiredUnits || []) {
    const financial = await getActiveUnitReservation(development.broker_id, unit.id);
    if (financial) continue;
    await supabase
      .from("imf_units")
      .update({ status: "disponivel", reserved_until: null, buyer_name: null, buyer_phone: null })
      .eq("id", unit.id)
      .eq("status", "reservado")
      .lt("reserved_until", nowIso);
  }
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
lancamentosRouter.get("/api/lancamentos/units/:id/reservation", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: unit } = await supabase
      .from("imf_units")
      .select("id, development_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const financialAccess = await isBrokerOwner(userId, brokerId);
    if (!financialAccess) return res.json({ reservation: null, financial_access: false });
    const reservation = await getActiveUnitReservation(brokerId, unit.id);
    res.json({ reservation, financial_access: true });
  } catch (error: any) {
    console.error("Erro GET reserva financeira da unidade:", error?.message || "erro desconhecido");
    res.status(500).json({ error: "Nao foi possivel carregar a reserva." });
  }
});

lancamentosRouter.post(
  "/api/lancamentos/units/:id/reservations",
  requireUser,
  reservationPaymentLimiter,
  validateBody(financialReservationSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });
      if (!(await isBrokerOwner(userId, brokerId))) {
        return res.status(403).json({ error: "Apenas o titular da conta pode gerar cobrancas de reserva." });
      }

      const { data: unit } = await supabase
        .from("imf_units")
        .select("id, development_id, status")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      const documentDigits = req.body.buyer_cpf_cnpj.replace(/\D/g, "");
      const { data: existing } = await supabase
        .from("imf_unit_reservations")
        .select("id, unit_id, buyer_document_last4")
        .eq("broker_id", brokerId)
        .eq("request_key", req.body.request_key)
        .maybeSingle();
      if (existing) {
        if (existing.unit_id !== unit.id) {
          return res.status(409).json({ error: "A chave de idempotencia ja foi usada em outra unidade." });
        }
        if (existing.buyer_document_last4 !== documentDigits.slice(-4)) {
          return res.status(409).json({ error: "O documento nao corresponde a esta tentativa de reserva." });
        }
        const reservation = await generateUnitReservationPix(existing.id, documentDigits);
        return res.json({ reservation, idempotent_replay: true });
      }

      if (unit.status !== "disponivel") {
        return res.status(409).json({ error: "A unidade nao esta disponivel." });
      }

      const reservedUntil = new Date(Date.now() + req.body.hold_hours * 3_600_000).toISOString();
      const { data: created, error: createError } = await supabase.rpc("imf_create_unit_reservation", {
        p_broker_id: brokerId,
        p_unit_id: unit.id,
        p_created_by_user_id: userId,
        p_request_key: req.body.request_key,
        p_buyer_name: req.body.buyer_name,
        p_buyer_phone: req.body.buyer_phone ? normalizePhoneBR(req.body.buyer_phone) : "",
        p_buyer_document_last4: documentDigits.slice(-4),
        p_signal_amount_cents: req.body.signal_amount_cents,
        p_reserved_until: reservedUntil,
      });

      if (createError || !created) {
        if (createError?.code === "23505") {
          const { data: raced } = await supabase
            .from("imf_unit_reservations")
            .select("id, unit_id, buyer_document_last4")
            .eq("broker_id", brokerId)
            .eq("request_key", req.body.request_key)
            .maybeSingle();
          if (raced?.id && raced.unit_id === unit.id && raced.buyer_document_last4 === documentDigits.slice(-4)) {
            const reservation = await generateUnitReservationPix(raced.id, documentDigits);
            return res.json({ reservation, idempotent_replay: true });
          }
        }
        if (["23505", "55000"].includes(createError?.code || "")) {
          return res.status(409).json({ error: "A unidade ja possui uma reserva ativa." });
        }
        if (createError?.code === "22003") {
          return res.status(400).json({ error: "O sinal nao pode superar o preco da unidade." });
        }
        if (createError?.code === "42501") return res.status(403).json({ error: "Acesso negado." });
        throw new Error("Falha ao registrar a reserva.");
      }

      const createdRow = Array.isArray(created) ? created[0] : created;
      const reservation = await generateUnitReservationPix(createdRow.id, documentDigits);
      res.status(201).json({ reservation, idempotent_replay: false });
    } catch (error: any) {
      const message = String(error?.message || "Falha ao gerar o PIX.").slice(0, 300);
      console.error("Erro POST reserva PIX da unidade:", message.replace(/\b\d{11,14}\b/g, "[documento]"));
      const status = message.includes("nao esta configurado") || message.includes("não está configurado") ? 503 : 502;
      res.status(status).json({ error: message });
    }
  },
);

lancamentosRouter.patch("/api/lancamentos/units/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: unit } = await supabase.from("imf_units").select("id, development_id, status").eq("id", req.params.id).maybeSingle();
    if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
      return res.status(403).json({ error: "Acesso negado." });
    }

    const { action, buyer_name, buyer_phone, hold_hours, price_cents, code, quartos, vagas_garagem, area_m2, orientacao, andar, area_lote_m2, testada_m } = req.body;
    if (orientacao && orientacao !== "nascente" && orientacao !== "poente") {
      return res.status(400).json({ error: "orientacao deve ser 'nascente' ou 'poente'." });
    }
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    let completeFinancialReservation = false;

    if (action === "reservar") {
      if (!buyer_name) return res.status(400).json({ error: "buyer_name é obrigatório pra reservar." });
      if (unit.status !== "disponivel") return res.status(409).json({ error: "A unidade nao esta disponivel." });
      updates.status = "reservado";
      updates.buyer_name = String(buyer_name).trim().slice(0, 120);
      updates.buyer_phone = buyer_phone ? normalizePhoneBR(String(buyer_phone)) : null;
      const safeHoldHours = Math.min(168, Math.max(1, Number(hold_hours) || 1));
      updates.reserved_until = new Date(Date.now() + safeHoldHours * 3600_000).toISOString();
    } else if (action === "vender") {
      const financial = await getActiveUnitReservation(brokerId, unit.id);
      if (financial && financial.status !== "paid") {
        return res.status(409).json({ error: "Confirme o pagamento do sinal antes de concluir a venda." });
      }
      completeFinancialReservation = financial?.status === "paid";
      updates.status = "vendido";
      updates.buyer_name = buyer_name ? String(buyer_name).trim().slice(0, 120) : undefined;
      updates.buyer_phone = buyer_phone ? normalizePhoneBR(String(buyer_phone)) : undefined;
      updates.reserved_until = null;
      // Quem fecha a venda — usado por Financeiro/Relatórios pra não
      // misturar a receita de um corretor com a de outro na mesma conta.
      updates.sold_by_user_id = userId;
    } else if (action === "liberar") {
      try {
        await cancelActiveUnitReservation(brokerId, unit.id, "cancelled");
      } catch (cancelError: any) {
        return res.status(409).json({ error: cancelError?.message || "Nao foi possivel cancelar a reserva financeira." });
      }
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
      const minutes = Math.min(10_080, Math.max(1, Number(req.body.extend_minutes) || 30));
      updates.reserved_until = new Date(Date.now() + minutes * 60_000).toISOString();
      await supabase.from("imf_unit_reservations").update({
        reserved_until: updates.reserved_until,
        updated_at: updates.updated_at,
      }).eq("broker_id", brokerId).eq("unit_id", unit.id).in("status", ["creating", "pending", "overdue", "payment_failed"]);
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

    let updateQuery = supabase
      .from("imf_units")
      .update(updates)
      .eq("id", req.params.id);
    if (action) updateQuery = updateQuery.eq("status", unit.status);
    const { data, error } = await updateQuery.select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(409).json({ error: "A unidade foi alterada por outra operacao. Recarregue e tente novamente." });
    if (completeFinancialReservation) await completePaidUnitReservation(brokerId, unit.id);
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

    const { count: reservationHistory } = await supabase
      .from("imf_unit_reservations")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit.id);
    if ((reservationHistory || 0) > 0) {
      return res.status(409).json({ error: "A unidade possui historico financeiro e nao pode ser excluida." });
    }

    const { error } = await supabase.from("imf_units").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/lancamentos/units/:id:", err);
    res.status(500).json({ error: err.message });
  }
});
