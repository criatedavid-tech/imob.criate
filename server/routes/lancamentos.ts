import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { reservationPaymentLimiter } from "../middleware/rateLimits";
import { normalizePhoneBR } from "../lib/crypto";
import {
  cancelActiveUnitReservation,
  completePaidUnitReservation,
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

const DOCUMENT_BUCKET = "imf-reservation-documents";
const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;
const MAX_DOCUMENT_DATA_URL_LENGTH = Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 128;
const RESERVATION_DOCUMENT_PUBLIC_FIELDS =
  "id, label, status, rejection_reason, requested_at, uploaded_at, reviewed_at, file_mime_type, file_size_bytes";

const reservationDocumentRequestSchema = z.object({
  label: z.string().trim().min(2, "Informe o nome do documento.").max(120, "O nome do documento e muito longo."),
});

const reservationDocumentUploadSchema = z.object({
  file_data: z.string().min(1, "Selecione um arquivo.").max(
    MAX_DOCUMENT_DATA_URL_LENGTH,
    "O arquivo supera o limite de 6 MB.",
  ),
});

const reservationDocumentReviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("aprovado") }),
  z.object({
    status: z.literal("rejeitado"),
    rejection_reason: z.string().trim().min(2, "Informe o motivo da rejeicao.").max(500),
  }),
]);

type DecodedDocument = {
  buffer: Buffer;
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  extension: "pdf" | "jpg" | "png" | "webp";
};

function decodeReservationDocument(fileData: string): DecodedDocument {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(fileData);
  if (!match || match[2].length % 4 !== 0) throw new Error("Formato de arquivo invalido.");

  const [, declaredMimeType, encoded] = match;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES || buffer.toString("base64") !== encoded) {
    throw new Error(buffer.length > MAX_DOCUMENT_BYTES ? "O arquivo supera o limite de 6 MB." : "Arquivo base64 invalido.");
  }

  let detected: Omit<DecodedDocument, "buffer"> | null = null;
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    detected = { contentType: "application/pdf", extension: "pdf" };
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    detected = { contentType: "image/jpeg", extension: "jpg" };
  } else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    detected = { contentType: "image/png", extension: "png" };
  } else if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    detected = { contentType: "image/webp", extension: "webp" };
  }

  if (!detected || declaredMimeType.toLowerCase() !== detected.contentType) {
    throw new Error("Envie um PDF, JPEG, PNG ou WebP valido.");
  }
  return { buffer, ...detected };
}

const ACTIVE_FINANCIAL_STATUSES = ["creating", "pending", "paid", "overdue", "payment_failed"];

async function ensureUnitReservedForFinancialRecord(unit: any, reservation: any): Promise<boolean> {
  if (unit.status === "reservado") {
    const sameExpiry = (!unit.reserved_until && !reservation.reserved_until)
      || new Date(unit.reserved_until).getTime() === new Date(reservation.reserved_until).getTime();
    return unit.buyer_name === reservation.buyer_name
      && (unit.buyer_phone || null) === (reservation.buyer_phone || null)
      && sameExpiry;
  }
  if (unit.status !== "disponivel") return false;

  const { data, error } = await supabase
    .from("imf_units")
    .update({
      status: "reservado",
      buyer_name: reservation.buyer_name,
      buyer_phone: reservation.buyer_phone || null,
      reserved_until: reservation.reserved_until,
      updated_at: new Date().toISOString(),
    })
    .eq("id", unit.id)
    .eq("status", "disponivel")
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Falha ao travar a unidade para a reserva.");
  return !!data;
}

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

async function ownsUnit(brokerId: string, unitId: string): Promise<boolean> {
  const { data: unit } = await supabase
    .from("imf_units")
    .select("development_id")
    .eq("id", unitId)
    .maybeSingle();
  return !!unit && ownsDevelopment(brokerId, unit.development_id);
}

async function getReservationDocument(brokerId: string, documentId: string) {
  const { data, error } = await supabase
    .from("imf_reservation_documents")
    .select("id, broker_id, reservation_id, status, file_path")
    .eq("id", documentId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar o documento.");
  return data;
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

// Fase 3 - documentos da reserva. O Storage e a tabela sao privados; todas as
// operacoes passam pelo backend e ficam restritas ao titular da conta.
lancamentosRouter.get("/api/lancamentos/units/:id/documents", requireUser, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsUnit(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const financialAccess = await isBrokerOwner(userId, brokerId);
    if (!financialAccess) {
      return res.json({ documents: [], reservation_id: null, financial_access: false });
    }

    const reservation = await getActiveUnitReservation(brokerId, req.params.id);
    if (!reservation) {
      return res.json({ documents: [], reservation_id: null, financial_access: true });
    }

    const { data, error } = await supabase
      .from("imf_reservation_documents")
      .select(RESERVATION_DOCUMENT_PUBLIC_FIELDS)
      .eq("broker_id", brokerId)
      .eq("reservation_id", reservation.id)
      .order("requested_at", { ascending: true });
    if (error) throw new Error("Falha ao carregar os documentos.");
    res.json({ documents: data || [], reservation_id: reservation.id, financial_access: true });
  } catch (error: any) {
    console.error("Erro GET documentos da reserva:", error?.message || "erro desconhecido");
    res.status(500).json({ error: "Nao foi possivel carregar os documentos da reserva." });
  }
});

lancamentosRouter.post(
  "/api/lancamentos/units/:id/documents",
  requireUser,
  validateBody(reservationDocumentRequestSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });
      if (!(await isBrokerOwner(userId, brokerId))) {
        return res.status(403).json({ error: "Apenas o titular da conta pode solicitar documentos." });
      }
      if (!(await ownsUnit(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

      const reservation = await getActiveUnitReservation(brokerId, req.params.id);
      if (!reservation) return res.status(409).json({ error: "A unidade nao possui uma reserva financeira ativa." });

      const { data, error } = await supabase
        .from("imf_reservation_documents")
        .insert({
          broker_id: brokerId,
          reservation_id: reservation.id,
          label: req.body.label,
          requested_by_user_id: userId,
        })
        .select(RESERVATION_DOCUMENT_PUBLIC_FIELDS)
        .single();
      if (error) throw new Error("Falha ao solicitar o documento.");
      res.status(201).json(data);
    } catch (error: any) {
      console.error("Erro POST documento da reserva:", error?.message || "erro desconhecido");
      res.status(500).json({ error: "Nao foi possivel solicitar o documento." });
    }
  },
);

lancamentosRouter.post(
  "/api/lancamentos/reservation-documents/:docId/upload",
  requireUser,
  validateBody(reservationDocumentUploadSchema),
  async (req, res) => {
    let uploadedPath: string | null = null;
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });
      if (!(await isBrokerOwner(userId, brokerId))) {
        return res.status(403).json({ error: "Apenas o titular da conta pode enviar documentos da reserva." });
      }

      const document = await getReservationDocument(brokerId, req.params.docId);
      if (!document) return res.status(404).json({ error: "Documento nao encontrado." });
      if (!["pendente", "rejeitado"].includes(document.status)) {
        return res.status(409).json({ error: "Este documento nao esta aguardando envio." });
      }

      const { data: activeReservation, error: reservationError } = await supabase
        .from("imf_unit_reservations")
        .select("id")
        .eq("id", document.reservation_id)
        .eq("broker_id", brokerId)
        .in("status", ACTIVE_FINANCIAL_STATUSES)
        .maybeSingle();
      if (reservationError) throw new Error("Falha ao validar a reserva.");
      if (!activeReservation) return res.status(409).json({ error: "A reserva financeira nao esta mais ativa." });

      let decoded: DecodedDocument;
      try {
        decoded = decodeReservationDocument(req.body.file_data);
      } catch (decodeError: any) {
        return res.status(400).json({ error: decodeError?.message || "Arquivo invalido." });
      }

      uploadedPath = `${brokerId}/${document.reservation_id}/${document.id}/${randomUUID()}.${decoded.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(uploadedPath, decoded.buffer, {
          contentType: decoded.contentType,
          upsert: false,
          cacheControl: "0",
        });
      if (uploadError) throw new Error("Falha ao armazenar o documento.");

      const uploadedAt = new Date().toISOString();
      const { data, error: updateError } = await supabase
        .from("imf_reservation_documents")
        .update({
          file_path: uploadedPath,
          file_mime_type: decoded.contentType,
          file_size_bytes: decoded.buffer.length,
          status: "enviado",
          rejection_reason: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          uploaded_at: uploadedAt,
          updated_at: uploadedAt,
        })
        .eq("id", document.id)
        .eq("broker_id", brokerId)
        .eq("status", document.status)
        .select(RESERVATION_DOCUMENT_PUBLIC_FIELDS)
        .maybeSingle();
      if (updateError) throw new Error("Falha ao registrar o envio do documento.");
      if (!data) {
        await supabase.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]);
        uploadedPath = null;
        return res.status(409).json({ error: "O documento foi alterado por outra operacao. Recarregue e tente novamente." });
      }

      const previousPath = document.file_path;
      uploadedPath = null;
      if (previousPath) {
        const { error: removeError } = await supabase.storage.from(DOCUMENT_BUCKET).remove([previousPath]);
        if (removeError) console.error("Falha ao remover versao rejeitada do documento:", removeError.message);
      }
      res.json(data);
    } catch (error: any) {
      if (uploadedPath) await supabase.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]);
      console.error("Erro POST upload de documento da reserva:", error?.message || "erro desconhecido");
      res.status(500).json({ error: "Nao foi possivel enviar o documento." });
    }
  },
);

lancamentosRouter.patch(
  "/api/lancamentos/reservation-documents/:docId",
  requireUser,
  validateBody(reservationDocumentReviewSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });
      if (!(await isBrokerOwner(userId, brokerId))) {
        return res.status(403).json({ error: "Apenas o titular da conta pode revisar documentos." });
      }

      const document = await getReservationDocument(brokerId, req.params.docId);
      if (!document) return res.status(404).json({ error: "Documento nao encontrado." });
      if (document.status !== "enviado") {
        return res.status(409).json({ error: "Apenas documentos enviados podem ser aprovados ou rejeitados." });
      }

      const reviewedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from("imf_reservation_documents")
        .update({
          status: req.body.status,
          rejection_reason: req.body.status === "rejeitado" ? req.body.rejection_reason : null,
          reviewed_by_user_id: userId,
          reviewed_at: reviewedAt,
          updated_at: reviewedAt,
        })
        .eq("id", document.id)
        .eq("broker_id", brokerId)
        .eq("status", "enviado")
        .select(RESERVATION_DOCUMENT_PUBLIC_FIELDS)
        .maybeSingle();
      if (error) throw new Error("Falha ao revisar o documento.");
      if (!data) return res.status(409).json({ error: "O documento ja foi revisado por outra operacao." });
      res.json(data);
    } catch (error: any) {
      console.error("Erro PATCH revisao de documento da reserva:", error?.message || "erro desconhecido");
      res.status(500).json({ error: "Nao foi possivel revisar o documento." });
    }
  },
);

lancamentosRouter.get("/api/lancamentos/reservation-documents/:docId/signed-url", requireUser, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await isBrokerOwner(userId, brokerId))) {
      return res.status(403).json({ error: "Apenas o titular da conta pode visualizar documentos." });
    }

    const document = await getReservationDocument(brokerId, req.params.docId);
    if (!document) return res.status(404).json({ error: "Documento nao encontrado." });
    if (!document.file_path) return res.status(409).json({ error: "Este documento ainda nao possui arquivo." });

    const expiresIn = 300;
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(document.file_path, expiresIn);
    if (error || !data?.signedUrl) throw new Error("Falha ao gerar o link temporario.");
    res.json({ signed_url: data.signedUrl, expires_in: expiresIn });
  } catch (error: any) {
    console.error("Erro GET signed URL de documento da reserva:", error?.message || "erro desconhecido");
    res.status(500).json({ error: "Nao foi possivel abrir o documento." });
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
        .select("id, development_id, status, buyer_name, buyer_phone, reserved_until, price_cents")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!unit || !(await ownsDevelopment(brokerId, unit.development_id))) {
        return res.status(403).json({ error: "Acesso negado." });
      }
      if (unit.price_cents && req.body.signal_amount_cents > unit.price_cents) {
        return res.status(400).json({ error: "O sinal nao pode superar o preco da unidade." });
      }

      const documentDigits = req.body.buyer_cpf_cnpj.replace(/\D/g, "");
      const { data: existing } = await supabase
        .from("imf_unit_reservations")
        .select("id, unit_id, buyer_document_last4, buyer_name, buyer_phone, reserved_until, status")
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
        if (ACTIVE_FINANCIAL_STATUSES.includes(existing.status)
          && !(await ensureUnitReservedForFinancialRecord(unit, existing))) {
          return res.status(409).json({ error: "A unidade foi ocupada por outra operacao." });
        }
        const reservation = await generateUnitReservationPix(existing.id, documentDigits);
        return res.json({ reservation, idempotent_replay: true });
      }

      if (unit.status !== "disponivel") {
        return res.status(409).json({ error: "A unidade nao esta disponivel." });
      }

      const reservedUntil = new Date(Date.now() + req.body.hold_hours * 3_600_000).toISOString();
      const normalizedPhone = req.body.buyer_phone ? normalizePhoneBR(req.body.buyer_phone) : null;
      const { data: created, error: createError } = await supabase
        .from("imf_unit_reservations")
        .insert({
          broker_id: brokerId,
          unit_id: unit.id,
          created_by_user_id: userId,
          request_key: req.body.request_key,
          buyer_name: req.body.buyer_name,
          buyer_phone: normalizedPhone,
          buyer_document_last4: documentDigits.slice(-4),
          // Compatibilidade com a primeira versão aplicada da migração, na qual
          // buyer_cpf_cnpj era NOT NULL. Nunca persiste o documento real.
          buyer_cpf_cnpj: `0000000${documentDigits.slice(-4)}`,
          signal_amount_cents: req.body.signal_amount_cents,
          status: "creating",
          reserved_until: reservedUntil,
        })
        .select("id, unit_id, buyer_document_last4, buyer_name, buyer_phone, reserved_until, status")
        .single();

      if (createError || !created) {
        if (createError?.code === "23505") {
          const { data: raced } = await supabase
            .from("imf_unit_reservations")
            .select("id, unit_id, buyer_document_last4, buyer_name, buyer_phone, reserved_until, status")
            .eq("broker_id", brokerId)
            .eq("request_key", req.body.request_key)
            .maybeSingle();
          if (raced?.id && raced.unit_id === unit.id && raced.buyer_document_last4 === documentDigits.slice(-4)) {
            if (ACTIVE_FINANCIAL_STATUSES.includes(raced.status)
              && !(await ensureUnitReservedForFinancialRecord(unit, raced))) {
              return res.status(409).json({ error: "A unidade foi ocupada por outra operacao." });
            }
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

      if (!(await ensureUnitReservedForFinancialRecord(unit, created))) {
        await supabase.from("imf_unit_reservations").update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        }).eq("id", created.id).eq("status", "creating");
        return res.status(409).json({ error: "A unidade foi ocupada por outra operacao." });
      }

      const reservation = await generateUnitReservationPix(created.id, documentDigits);
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
      if (financial) {
        const { data: documents, error: documentsError } = await supabase
          .from("imf_reservation_documents")
          .select("status")
          .eq("broker_id", brokerId)
          .eq("reservation_id", financial.id);
        if (documentsError) throw new Error("Falha ao validar os documentos da reserva.");

        const statuses = (documents || []).map((document: any) => document.status as string);
        const notApproved = statuses.filter((status) => status !== "aprovado");
        if (statuses.length > 0 && notApproved.length > 0) {
          const pending = statuses.filter((status) => status === "pendente").length;
          const sent = statuses.filter((status) => status === "enviado").length;
          const rejected = statuses.filter((status) => status === "rejeitado").length;
          return res.status(409).json({
            error: `A venda esta bloqueada: ${notApproved.length} de ${statuses.length} documento(s) ainda nao aprovado(s) (${pending} pendente(s), ${sent} enviado(s), ${rejected} rejeitado(s)).`,
            documents: { total: statuses.length, approved: statuses.length - notApproved.length, pending, sent, rejected },
          });
        }
      }
      completeFinancialReservation = financial?.status === "paid";
      updates.status = "vendido";
      updates.buyer_name = buyer_name ? String(buyer_name).trim().slice(0, 120) : undefined;
      updates.buyer_phone = buyer_phone ? normalizePhoneBR(String(buyer_phone)) : undefined;
      updates.reserved_until = null;
      // Quem fecha a venda — usado por Financeiro/Relatórios pra não
      // misturar a receita de um corretor com a de outro na mesma conta.
      updates.sold_by_user_id = userId;
      updates.sold_at = updates.updated_at;
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
      updates.sold_at = null;
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
