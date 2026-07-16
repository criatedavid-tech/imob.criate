import { fetchWithTimeout } from "../lib/http";
import { supabase } from "../supabase";
import { resolveAsaasCredentials, type AsaasCreds } from "./asaasCredentials";

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

async function findAsaasCustomerByExternalReference(reservationId: string, creds: AsaasCreds): Promise<string | null> {
  const resp = await fetchWithTimeout(
    `${creds.baseUrl}/customers?externalReference=${encodeURIComponent(`unit-reservation:${reservationId}`)}&limit=1`,
    { headers: creds.headers },
  );
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Falha ao verificar comprador no Asaas."));
  return Array.isArray(payload?.data) && payload.data[0]?.id ? payload.data[0].id : null;
}

async function ensureAsaasBuyerCustomer(row: UnitReservationRow, creds: AsaasCreds, buyerDocument?: string): Promise<string> {
  if (row.asaas_customer_id) return row.asaas_customer_id;

  let customerId = await findAsaasCustomerByExternalReference(row.id, creds);
  if (!customerId) {
    const documentDigits = (buyerDocument || "").replace(/\D/g, "");
    if (![11, 14].includes(documentDigits.length)) {
      throw new Error("CPF/CNPJ precisa ser informado novamente para gerar o PIX.");
    }
    const resp = await fetchWithTimeout(`${creds.baseUrl}/customers`, {
      method: "POST",
      headers: creds.headers,
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

async function findAsaasPaymentByExternalReference(reservationId: string, creds: AsaasCreds): Promise<any | null> {
  const resp = await fetchWithTimeout(
    `${creds.baseUrl}/payments?externalReference=${encodeURIComponent(`unit-reservation:${reservationId}`)}&limit=1`,
    { headers: creds.headers },
  );
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Falha ao verificar cobrança no Asaas."));
  return Array.isArray(payload?.data) && payload.data[0]?.id ? payload.data[0] : null;
}

async function loadPixQrCode(paymentId: string, creds: AsaasCreds): Promise<{ pixQrCode: string | null; pixCopyPaste: string | null }> {
  const resp = await fetchWithTimeout(`${creds.baseUrl}/payments/${paymentId}/pixQrCode`, {
    headers: creds.headers,
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(safeAsaasMessage(payload, "Cobrança criada, mas não foi possível obter o PIX."));
  return {
    pixQrCode: typeof payload?.encodedImage === "string" ? payload.encodedImage : null,
    pixCopyPaste: typeof payload?.payload === "string" ? payload.payload : null,
  };
}

export async function generateUnitReservationPix(reservationId: string, buyerDocument?: string): Promise<UnitReservationPublic> {
  let row = await loadReservation(reservationId);
  if (!["creating", "pending", "payment_failed", "overdue"].includes(row.status)) {
    return toPublicReservation(row);
  }

  // Chave de cobrança: a própria da incorporadora se configurada; senão a
  // conta global da Criate (fallback). O sinal cai na conta dona da chave.
  const creds = await resolveAsaasCredentials(row.broker_id);
  if (!creds.hasKey) throw new Error("Asaas não está configurado no servidor.");

  const customerId = await ensureAsaasBuyerCustomer(row, creds, buyerDocument);
  let payment = row.asaas_payment_id
    ? { id: row.asaas_payment_id, dueDate: row.due_date }
    : await findAsaasPaymentByExternalReference(row.id, creds);

  if (!payment) {
    const { data: unit } = await supabase.from("imf_units").select("code, development_id").eq("id", row.unit_id).single();
    const { data: development } = unit
      ? await supabase.from("imf_developments").select("name").eq("id", unit.development_id).single()
      : { data: null };
    if (!unit || !development) throw new Error("Unidade da reserva não encontrada.");

    const dueDate = new Date().toISOString().split("T")[0];
    const resp = await fetchWithTimeout(`${creds.baseUrl}/payments`, {
      method: "POST",
      headers: creds.headers,
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
    pix = await loadPixQrCode(payment.id, creds);
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
    // Mesma chave usada pra criar o pagamento — cancela na conta certa.
    const creds = await resolveAsaasCredentials(brokerId);
    const resp = await fetchWithTimeout(`${creds.baseUrl}/payments/${data.asaas_payment_id}`, {
      method: "DELETE",
      headers: creds.headers,
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

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export async function expireDueUnitReservations(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "unit_reservation_expiry",
    p_ttl_seconds: 600,
  });
  if (lockError) {
    console.error("[Reserva PIX] falha ao adquirir lock de expiração:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const nowIso = new Date().toISOString();
    const { data: expired, error: expiredError } = await supabase
      .from("imf_unit_reservations")
      .select("id, broker_id, unit_id")
      .in("status", ["creating", "pending", "overdue", "payment_failed"])
      .lt("reserved_until", nowIso)
      .order("reserved_until", { ascending: true })
      .limit(50);
    if (expiredError) throw expiredError;

    // Fora da requisição HTTP e com concorrência baixa para não saturar o Asaas.
    await runWithConcurrency(expired || [], 3, async (row: any) => {
      try {
        await cancelActiveUnitReservation(row.broker_id, row.unit_id, "expired");
      } catch (error: any) {
        console.error(
          `[Reserva PIX] falha ao expirar reserva da unidade ${row.unit_id}:`,
          safeAsaasMessage(null, error?.message || "falha desconhecida"),
        );
      }
    });

    // Também cobre reservas manuais sem PIX. Reservas financeiras cuja baixa
    // falhou continuam ativas e, por isso, não entram em releasableIds.
    const { data: expiredUnits, error: unitsError } = await supabase
      .from("imf_units")
      .select("id")
      .eq("status", "reservado")
      .lt("reserved_until", nowIso)
      .limit(200);
    if (unitsError) throw unitsError;

    const unitIds = (expiredUnits || []).map((unit: any) => unit.id);
    if (!unitIds.length) return;
    const { data: activeFinancial, error: activeError } = await supabase
      .from("imf_unit_reservations")
      .select("unit_id")
      .in("unit_id", unitIds)
      .in("status", ACTIVE_RESERVATION_STATUSES);
    if (activeError) throw activeError;
    const protectedIds = new Set((activeFinancial || []).map((row: any) => row.unit_id));
    const releasableIds = unitIds.filter((id: string) => !protectedIds.has(id));
    if (!releasableIds.length) return;

    const { error: releaseError } = await supabase
      .from("imf_units")
      .update({
        status: "disponivel",
        reserved_until: null,
        buyer_name: null,
        buyer_phone: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", releasableIds)
      .eq("status", "reservado")
      .lt("reserved_until", nowIso);
    if (releaseError) throw releaseError;
  } catch (error: any) {
    console.error("[Reserva PIX] job de expiração falhou:", error?.message || error);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "unit_reservation_expiry" });
    if (error) console.warn("[Reserva PIX] falha ao liberar lock de expiração:", error.message);
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
