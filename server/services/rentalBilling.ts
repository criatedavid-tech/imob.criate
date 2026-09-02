import { supabase } from "../supabase";
import { ensureClientAsaasPaymentWebhook, resolveAsaasCredentials, type AsaasCreds } from "./asaasCredentials";
import { fetchWithTimeout } from "../lib/http";

// ─────────────────────────────────────────────────────────────────────────
// Cobrança real de aluguel via Asaas — MESMO PADRÃO da assinatura do
// PANTUS Real Estate (ver server/services/billing.ts: asaasHeaders, POST /customers,
// POST /payments). Aqui o cliente Asaas é o INQUILINO, não o corretor.
//
// Durante a validação, CLIENT_FINANCIAL_SANDBOX_ONLY impede que uma credencial
// de produção chegue a este serviço. A liberação oficial exige uma mudança
// explícita de ambiente; a conta global da assinatura nunca é usada aqui.
// ─────────────────────────────────────────────────────────────────────────

interface RentalContract {
  id: string;
  broker_id: string;
  tenant_name: string;
  tenant_phone: string | null;
  tenant_cpf_cnpj: string | null;
  asaas_customer_id: string | null;
  rent_amount_cents: number;
  due_day: number;
}

function todayIsoInBrasilia(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function ensureAsaasTenantCustomer(contract: RentalContract, creds: AsaasCreds): Promise<string> {
  if (contract.asaas_customer_id) return contract.asaas_customer_id;
  if (!contract.tenant_cpf_cnpj) throw new Error("CPF/CNPJ do inquilino é obrigatório pra gerar cobrança.");

  const resp = await fetchWithTimeout(`${creds.baseUrl}/customers`, {
    method: "POST",
    headers: creds.headers,
    body: JSON.stringify({
      name: contract.tenant_name,
      cpfCnpj: contract.tenant_cpf_cnpj.replace(/\D/g, ""),
      phone: (contract.tenant_phone || "").replace(/\D/g, ""),
      externalReference: contract.id,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.errors?.[0]?.description || "Falha ao registrar inquilino no Asaas.");

  await supabase.from("imf_rental_contracts").update({ asaas_customer_id: data.id }).eq("id", contract.id);
  return data.id;
}

// Gera a cobrança do aluguel pro mês de referência (idempotente por
// contract_id+reference_month — não duplica se já existe cobrança pendente/paga).
export async function generateRentCharge(contractId: string, referenceMonth: Date): Promise<{
  payment: { id: string; boleto_url: string | null; pix_copy_paste: string | null; due_date: string; amount_cents: number };
}> {
  const { data: contract, error } = await supabase
    .from("imf_rental_contracts")
    .select("id, broker_id, tenant_name, tenant_phone, tenant_cpf_cnpj, asaas_customer_id, rent_amount_cents, due_day")
    .eq("id", contractId)
    .single();
  if (error || !contract) throw new Error("Contrato não encontrado.");

  // A cobrança só pode ser criada na conta própria da imobiliária. A conta
  // global da Criate é exclusiva da assinatura SaaS e nunca recebe aluguel.
  const creds = await resolveAsaasCredentials(contract.broker_id);
  // Falha antes de criar cliente/cobrança caso a confirmação assíncrona não
  // possa voltar para o PANTUS Real Estate. Assim o teste cobre emissão e conciliação.
  await ensureClientAsaasPaymentWebhook(creds);

  const refMonthStart = new Date(referenceMonth.getFullYear(), referenceMonth.getMonth(), 1);
  const refMonthIso = refMonthStart.toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("imf_rental_payments")
    .select("id, status, boleto_url, pix_copy_paste, due_date, amount_cents, asaas_payment_id")
    .eq("contract_id", contractId)
    .eq("reference_month", refMonthIso)
    .maybeSingle();

  if (existing && existing.status !== "failed") {
    return {
      payment: {
        id: existing.asaas_payment_id || existing.id,
        boleto_url: existing.boleto_url,
        pix_copy_paste: existing.pix_copy_paste,
        due_date: existing.due_date,
        amount_cents: existing.amount_cents,
      },
    };
  }

  const customerId = await ensureAsaasTenantCustomer(contract as RentalContract, creds);

  // Achado testando ao vivo: se o dia de vencimento do contrato já passou
  // neste mês (ex.: due_day=10 e hoje é dia 14), a Asaas rejeita com "não é
  // permitido data de vencimento inferior a hoje" — e como a cobrança é
  // sempre gerada pro mês corrente (referenceMonth = "agora"), esse contrato
  // ficava permanentemente impossível de cobrar até o mês seguinte. Vencimento
  // atrasado vence HOJE em vez de manter a data original no passado.
  const rawDueDate = new Date(refMonthStart.getFullYear(), refMonthStart.getMonth(), contract.due_day);
  const rawDueDateIso = rawDueDate.toISOString().split("T")[0];
  const todayIso = todayIsoInBrasilia();
  const dueDateIso = rawDueDateIso < todayIso ? todayIso : rawDueDateIso;
  const amount = contract.rent_amount_cents / 100;

  const payResp = await fetchWithTimeout(`${creds.baseUrl}/payments`, {
    method: "POST",
    headers: creds.headers,
    body: JSON.stringify({
      customer: customerId,
      billingType: "BOLETO", // Asaas inclui QR/copia-e-cola PIX automaticamente no boleto
      value: amount,
      dueDate: dueDateIso,
      description: `Aluguel — ${refMonthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`,
      externalReference: contractId,
    }),
  });
  const payment = await payResp.json();
  if (!payResp.ok) throw new Error(payment.errors?.[0]?.description || "Falha ao gerar cobrança no Asaas.");

  // PIX copia-e-cola vem num endpoint separado.
  let pixCopyPaste: string | null = null;
  try {
    const pixResp = await fetchWithTimeout(`${creds.baseUrl}/payments/${payment.id}/pixQrCode`, { headers: creds.headers });
    if (pixResp.ok) {
      const pix = await pixResp.json();
      pixCopyPaste = pix.payload || null;
    }
  } catch {
    // PIX é um complemento — não falha a cobrança se essa chamada extra der erro.
  }

  const row = {
    contract_id: contractId,
    reference_month: refMonthIso,
    asaas_payment_id: payment.id,
    source: "asaas",
    billing_type: "BOLETO",
    amount_cents: contract.rent_amount_cents,
    rent_amount_cents: contract.rent_amount_cents,
    charges_cents: 0,
    discount_cents: 0,
    amount_paid_cents: 0,
    line_items: [{ code: "rent", label: "Aluguel", amount_cents: contract.rent_amount_cents }],
    due_date: dueDateIso,
    status: "pending" as const,
    boleto_url: payment.bankSlipUrl || payment.invoiceUrl || null,
    pix_copy_paste: pixCopyPaste,
  };

  if (existing) {
    await supabase.from("imf_rental_payments").update(row).eq("id", existing.id);
  } else {
    await supabase.from("imf_rental_payments").insert(row);
  }

  return {
    payment: {
      id: payment.id,
      boleto_url: row.boleto_url,
      pix_copy_paste: pixCopyPaste,
      due_date: dueDateIso,
      amount_cents: contract.rent_amount_cents,
    },
  };
}

// Chamado pelo webhook Asaas compartilhado (routes/billing.ts) quando o
// customer do evento não é um corretor — pode ser um inquilino.
export async function handleRentalPaymentWebhook(event: any): Promise<boolean> {
  const p = event.payment;
  if (!p) return false;

  const { data: row } = await supabase
    .from("imf_rental_payments")
    .select("id, amount_cents, manual_status")
    .eq("asaas_payment_id", p.id)
    .maybeSingle();
  if (!row) return false; // não é uma cobrança de aluguel — deixa o handler de assinatura tratar

  if (event.event === "PAYMENT_RECEIVED" || event.event === "PAYMENT_CONFIRMED") {
    await supabase.from("imf_rental_payments").update({
      status: "paid",
      amount_paid_cents: row.amount_cents,
      paid_at: p.confirmedDate || p.paymentDate || new Date().toISOString(),
      manual_status: null,
      manual_status_at: null,
      manual_status_by_user_id: null,
      status_source: "asaas",
      asaas_last_status: p.status || event.event,
      asaas_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  } else if (event.event === "PAYMENT_OVERDUE") {
    await supabase.from("imf_rental_payments").update({
      ...(row.manual_status === "paid" ? {} : { status: "overdue" }),
      status_source: row.manual_status === "paid" ? "manual" : "asaas",
      asaas_last_status: p.status || event.event,
      asaas_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  } else if (event.event === "PAYMENT_DELETED") {
    await supabase.from("imf_rental_payments").update({
      ...(row.manual_status === "paid" ? {} : { status: "failed" }),
      status_source: row.manual_status === "paid" ? "manual" : "asaas",
      asaas_last_status: p.status || event.event,
      asaas_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  }
  return true;
}

export type ReconciledRentalStatus = "pending" | "paid" | "overdue" | "canceled" | "failed" | null;

export function rentalStatusFromAsaas(status: string | null | undefined): ReconciledRentalStatus {
  switch (String(status || "").toUpperCase()) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "paid";
    case "OVERDUE":
      return "overdue";
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "pending";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
      return "canceled";
    case "DELETED":
      return "failed";
    default:
      return null;
  }
}

async function brokerIdForRentalContract(contractId: string): Promise<string | null> {
  const { data } = await supabase.from("imf_rental_contracts")
    .select("broker_id").eq("id", contractId).maybeSingle();
  return data?.broker_id || null;
}

export async function syncRentalPaymentWithAsaas(paymentId: string): Promise<any> {
  const { data: row, error } = await supabase.from("imf_rental_payments")
    .select("id, contract_id, source, asaas_payment_id, status, amount_cents, manual_status")
    .eq("id", paymentId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Cobranca nao encontrada.");
  if (row.source !== "asaas" || !row.asaas_payment_id) throw new Error("Esta cobranca nao pertence ao Asaas.");

  const brokerId = await brokerIdForRentalContract(row.contract_id);
  if (!brokerId) throw new Error("Conta da cobranca nao encontrada.");
  const creds = await resolveAsaasCredentials(brokerId);
  const response = await fetchWithTimeout(`${creds.baseUrl}/payments/${row.asaas_payment_id}`, {
    headers: creds.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.errors?.[0]?.description || "Nao foi possivel consultar a cobranca no Asaas.");

  const reconciled = rentalStatusFromAsaas(payload.status);
  const checkedAt = new Date().toISOString();
  const updates: Record<string, any> = {
    asaas_last_status: String(payload.status || "UNKNOWN"),
    asaas_checked_at: checkedAt,
    updated_at: checkedAt,
  };
  if (reconciled === "paid") {
    Object.assign(updates, {
      status: "paid",
      amount_paid_cents: row.amount_cents,
      paid_at: payload.confirmedDate || payload.paymentDate || checkedAt,
      manual_status: null,
      manual_status_at: null,
      manual_status_by_user_id: null,
      status_source: "asaas",
    });
  } else if (reconciled && row.manual_status !== "paid") {
    Object.assign(updates, {
      status: reconciled,
      amount_paid_cents: 0,
      paid_at: null,
      status_source: row.manual_status === "unpaid" ? "manual" : "asaas",
    });
  }

  const { data: updated, error: updateError } = await supabase.from("imf_rental_payments")
    .update(updates).eq("id", row.id).select().single();
  if (updateError) throw updateError;
  return updated;
}

export async function runRentalPaymentReconciliationTick(): Promise<void> {
  const { data, error } = await supabase.from("imf_rental_payments")
    .select("id")
    .eq("source", "asaas")
    .not("asaas_payment_id", "is", null)
    .in("status", ["pending", "overdue"])
    .order("asaas_checked_at", { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) throw error;
  for (const row of data || []) {
    try {
      await syncRentalPaymentWithAsaas(row.id);
    } catch (error: any) {
      console.error(`[Locacao] falha ao reconciliar cobranca ${row.id}:`, error?.message || "erro desconhecido");
    }
  }
}
