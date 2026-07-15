import { ASAAS_API_KEY, ASAAS_BASE_URL } from "../config";
import { fetchWithTimeout } from "../lib/http";
import { supabase } from "../supabase";
import { asaasHeaders } from "./billing";

const ACTIVE_RESERVATION_STATUSES = ["creating", "pending", "paid", "overdue", "payment_failed"];

function assertDatabaseWrite(error: any, message: string): void {
  if (error) throw new Error(message);
}

interface UnitReservationRow {
  id: string;
  broker_id: string;
  unit_id: string;
  request_key: string;
  buyer_name: string;
  buyer_phone: string | null;
  buyer_document_last4: string;
  signal_amount_cents: number;
  status: string;
  reserved_until: string | null;
  asaas_customer_id: string | null;
  asaas_payment_id: string | null;
  due_date: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  paid_at?: string | null;
}

export interface UnitReservationPublic {
  id: string;
  unit_id: string;
  request_key: string;
  buyer_name: string;
  buyer_phone: string | null;
  buyer_document_last4: string;
  signal_amount_cents: number;
  status: string;
  reserved_until: string | null;
  due_date: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  payment_id: string | null;
}

function toPublicReservation(row: UnitReservationRow): UnitReservationPublic {
  return {
    id: row.id,
    unit_id: row.unit_id,
    request_key: row.request_key,
    buyer_name: row.buyer_name,
    buyer_phone: row.buyer_phone,
    buyer_document_last4: row.buyer_document_last4,
    signal_amount_cents: Number(row.signal_amount_cents),
    status: row.status,
    reserved_until: row.reserved_until,
    due_date: row.due_date,
    pix_qr_code: row.pix_qr_code,
    pix_copy_paste: row.pix_copy_paste,
    payment_id: row.asaas_payment_id,
  };
}

function safeAsaasMessage(payload: any, fallback: string): string {
  const raw = String(payload?.errors?.[0]?.description || payload?.error?.description || fallback)
    .slice(0, 400)
    .replace(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/g, "[documento]")
    .replace(/\b\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-\s]?\d{2}\b/g, "[documento]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]")
    .replace(/(?:access[_-]?token|api[_-]?key|authorization)\s*[:=]\s*[^,\s]+/gi, "[segredo]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw || fallback;
}

async function loadReservation(reservationId: string): Promise<UnitReservationRow> {
  const { data, error } = await supabase
    .from("imf_unit_reservations")
    .select("id, broker_id, unit_id, request_key, buyer_name, buyer_phone, buyer_document_last4, signal_amount_cents, status, reserved_until, asaas_customer_id, asaas_payment_id, due_date, pix_qr_code, pix_copy_paste, paid_at")
    .eq("id", reservationId)
    .single();
  if (error || !data) throw new Error("Reserva não encontrada.");
  return data as UnitReservationRow;
}

async function findAsaasCustomerByExternalReference(reservationId: string): Promise<string | null> {
  const resp = await fetchWithTimeout(
    `${ASAAS_BASE_URL}/customers?externalReference=${encodeURIComponent(`unit-reservation:${reservationId}`)}&limit=1`,
    { headers: asaasHeaders() },
  );
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Falha ao verificar comprador no Asaas."));
  return Array.isArray(payload?.data) && payload.data[0]?.id ? payload.data[0].id : null;
}

async function ensureAsaasBuyerCustomer(row: UnitReservationRow, buyerDocument?: string): Promise<string> {
  if (row.asaas_customer_id) return row.asaas_customer_id;

  let customerId = await findAsaasCustomerByExternalReference(row.id);
  if (!customerId) {
    const documentDigits = (buyerDocument || "").replace(/\D/g, "");
    if (![11, 14].includes(documentDigits.length)) {
      throw new Error("CPF/CNPJ precisa ser informado novamente para gerar o PIX.");
    }
    const resp = await fetchWithTimeout(`${ASAAS_BASE_URL}/customers`, {
      method: "POST",
      headers: asaasHeaders(),
      body: JSON.stringify({
        name: row.buyer_name,
        cpfCnpj: documentDigits,
        ...(row.buyer_phone ? { phone: row.buyer_phone.replace(/\D/g, "") } : {}),
        externalReference: `unit-reservation:${row.id}`,
      }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || !payload?.id) {
      throw new Error(safeAsaasMessage(payload, "Falha ao registrar comprador no Asaas."));
    }
    customerId = payload.id;
  }

  const { error: customerPersistError } = await supabase.from("imf_unit_reservations").update({
    asaas_customer_id: customerId,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  assertDatabaseWrite(customerPersistError, "Falha ao vincular o comprador à reserva.");
  return customerId;
}

async function findAsaasPaymentByExternalReference(reservationId: string): Promise<any | null> {
  const resp = await fetchWithTimeout(
    `${ASAAS_BASE_URL}/payments?externalReference=${encodeURIComponent(`unit-reservation:${reservationId}`)}&limit=1`,
    { headers: asaasHeaders() },
  );
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Falha ao verificar cobrança no Asaas."));
  return Array.isArray(payload?.data) && payload.data[0]?.id ? payload.data[0] : null;
}

async function loadPixQrCode(paymentId: string): Promise<{ pixQrCode: string | null; pixCopyPaste: string | null }> {
  const resp = await fetchWithTimeout(`${ASAAS_BASE_URL}/payments/${paymentId}/pixQrCode`, {
    headers: asaasHeaders(),
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Cobrança criada, mas não foi possível obter o PIX."));
  return {
    pixQrCode: typeof payload?.encodedImage === "string" ? payload.encodedImage : null,
    pixCopyPaste: typeof payload?.payload === "string" ? payload.payload : null,
  };
}

export async function generateUnitReservationPix(reservationId: string, buyerDocument?: string): Promise<UnitReservationPublic> {
  if (!ASAAS_API_KEY) throw new Error("Asaas não está configurado no servidor.");
  let row = await loadReservation(reservationId);
  if (!["creating", "pending", "payment_failed", "overdue"].includes(row.status)) {
    return toPublicReservation(row);
  }

  const customerId = await ensureAsaasBuyerCustomer(row, buyerDocument);
  let payment = row.asaas_payment_id
    ? { id: row.asaas_payment_id, dueDate: row.due_date }
    : await findAsaasPaymentByExternalReference(row.id);

  if (!payment) {
    const { data: unit } = await supabase.from("imf_units").select("code, development_id").eq("id", row.unit_id).single();
    const { data: development } = unit
      ? await supabase.from("imf_developments").select("name").eq("id", unit.development_id).single()
      : { data: null };
    if (!unit || !development) throw new Error("Unidade da reserva não encontrada.");

    const dueDate = new Date().toISOString().split("T")[0];
    const resp = await fetchWithTimeout(`${ASAAS_BASE_URL}/payments`, {
      method: "POST",
      headers: asaasHeaders(),
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: row.signal_amount_cents / 100,
        dueDate,
        description: `Sinal de reserva — ${development.name}, unidade ${unit.code}`.slice(0, 120),
        externalReference: `unit-reservation:${row.id}`,
      }),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || !payload?.id) {
      await supabase.from("imf_unit_reservations").update({ status: "payment_failed", updated_at: new Date().toISOString() }).eq("id", row.id);
      throw new Error(safeAsaasMessage(payload, "Falha ao gerar cobrança PIX no Asaas."));
    }
    payment = payload;
  }

  const dueDate = payment.dueDate || row.due_date || new Date().toISOString().split("T")[0];
  const { error: paymentPersistError } = await supabase.from("imf_unit_reservations").update({
    asaas_customer_id: customerId,
    asaas_payment_id: payment.id,
    due_date: dueDate,
    status: "pending",
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  assertDatabaseWrite(paymentPersistError, "Falha ao vincular a cobrança à reserva.");

  let pix: { pixQrCode: string | null; pixCopyPaste: string | null };
  try {
    pix = await loadPixQrCode(payment.id);
  } catch (error) {
    await supabase.from("imf_unit_reservations").update({
      status: "payment_failed",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    throw error;
  }
  const { error: pixPersistError } = await supabase.from("imf_unit_reservations").update({
    pix_qr_code: pix.pixQrCode,
    pix_copy_paste: pix.pixCopyPaste,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  assertDatabaseWrite(pixPersistError, "Falha ao salvar os dados do PIX da reserva.");

  row = await loadReservation(row.id);
  return toPublicReservation(row);
}

export async function getActiveUnitReservation(brokerId: string, unitId: string): Promise<UnitReservationPublic | null> {
  const { data, error } = await supabase
    .from("imf_unit_reservations")
    .select("id, broker_id, unit_id, request_key, buyer_name, buyer_phone, buyer_document_last4, signal_amount_cents, status, reserved_until, asaas_customer_id, asaas_payment_id, due_date, pix_qr_code, pix_copy_paste, paid_at")
    .eq("broker_id", brokerId)
    .eq("unit_id", unitId)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar a reserva financeira.");
  return data ? toPublicReservation(data as UnitReservationRow) : null;
}

export async function cancelActiveUnitReservation(
  brokerId: string,
  unitId: string,
  finalStatus: "cancelled" | "expired" = "cancelled",
): Promise<boolean> {
  const { data, error: lookupError } = await supabase
    .from("imf_unit_reservations")
    .select("id, status, asaas_payment_id")
    .eq("broker_id", brokerId)
    .eq("unit_id", unitId)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error("Falha ao consultar a reserva financeira.");
  if (!data) return false;
  if (data.status === "paid") throw new Error("O sinal já foi pago; a reserva exige conciliação ou reembolso antes de ser liberada.");

  if (data.asaas_payment_id) {
    const resp = await fetchWithTimeout(`${ASAAS_BASE_URL}/payments/${data.asaas_payment_id}`, {
      method: "DELETE",
      headers: asaasHeaders(),
    });
    if (!resp.ok && resp.status !== 404) {
      const payload = await resp.json().catch(() => ({}));
      throw new Error(safeAsaasMessage(payload, "Não foi possível cancelar o PIX da reserva."));
    }
  }

  const { error: cancelPersistError } = await supabase.from("imf_unit_reservations").update({
    status: finalStatus,
    pix_qr_code: null,
    pix_copy_paste: null,
    updated_at: new Date().toISOString(),
  }).eq("id", data.id);
  assertDatabaseWrite(cancelPersistError, "Falha ao registrar o cancelamento da reserva.");
  return true;
}

export async function completePaidUnitReservation(brokerId: string, unitId: string): Promise<void> {
  const { data, error: lookupError } = await supabase
    .from("imf_unit_reservations")
    .select("id, status")
    .eq("broker_id", brokerId)
    .eq("unit_id", unitId)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error("Falha ao consultar a reserva financeira.");
  if (!data) return;
  if (data.status !== "paid") {
    throw new Error("Confirme o pagamento do sinal antes de concluir a venda.");
  }
  const { error } = await supabase.from("imf_unit_reservations").update({
    status: "completed",
    pix_qr_code: null,
    pix_copy_paste: null,
    updated_at: new Date().toISOString(),
  }).eq("id", data.id).eq("status", "paid");
  if (error) throw new Error("Não foi possível concluir o histórico da reserva.");
}

export async function expireFinancialReservations(developmentId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: development } = await supabase.from("imf_developments").select("broker_id").eq("id", developmentId).maybeSingle();
  if (!development) return;
  const { data: expired } = await supabase
    .from("imf_unit_reservations")
    .select("unit_id")
    .eq("broker_id", development.broker_id)
    .in("status", ["creating", "pending", "overdue", "payment_failed"])
    .lt("reserved_until", nowIso);

  for (const row of expired || []) {
    await cancelActiveUnitReservation(development.broker_id, row.unit_id, "expired").catch((error) => {
      console.error(`[Reserva PIX] falha ao expirar reserva da unidade ${row.unit_id}:`, safeAsaasMessage(null, error?.message || "falha desconhecida"));
    });
  }
}

export async function handleUnitReservationPaymentWebhook(event: any): Promise<boolean> {
  const payment = event?.payment;
  if (!payment?.id) return false;
  const { data: row, error: lookupError } = await supabase
    .from("imf_unit_reservations")
    .select("id, unit_id, status")
    .eq("asaas_payment_id", payment.id)
    .maybeSingle();
  if (lookupError) throw new Error("Falha ao localizar o pagamento da reserva.");
  if (!row) return false;

  if (event.event === "PAYMENT_RECEIVED" || event.event === "PAYMENT_CONFIRMED") {
    const paidAt = new Date().toISOString();
    if (!["completed", "refunded"].includes(row.status)) {
      await supabase.from("imf_unit_reservations").update({
        status: "paid",
        paid_at: paidAt,
        reserved_until: null,
        pix_qr_code: null,
        pix_copy_paste: null,
        updated_at: paidAt,
      }).eq("id", row.id);
    }
    await supabase.from("imf_units").update({ reserved_until: null, updated_at: paidAt }).eq("id", row.unit_id).eq("status", "reservado");
  } else if (event.event === "PAYMENT_OVERDUE") {
    await supabase.from("imf_unit_reservations").update({ status: "overdue", updated_at: new Date().toISOString() }).eq("id", row.id).in("status", ["creating", "pending", "payment_failed"]);
  } else if (event.event === "PAYMENT_DELETED") {
    await supabase.from("imf_unit_reservations").update({ status: "cancelled", pix_qr_code: null, pix_copy_paste: null, updated_at: new Date().toISOString() }).eq("id", row.id).in("status", ["creating", "pending", "overdue", "payment_failed"]);
  } else if (["PAYMENT_REFUNDED", "PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_CHARGEBACK_REQUESTED"].includes(event.event)) {
    await supabase.from("imf_unit_reservations").update({ status: "refunded", pix_qr_code: null, pix_copy_paste: null, updated_at: new Date().toISOString() }).eq("id", row.id);
  }
  return true;
}
