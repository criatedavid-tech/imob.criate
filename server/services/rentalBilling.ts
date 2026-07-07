import { supabase } from "../supabase";
import { ASAAS_BASE_URL } from "../config";
import { asaasHeaders } from "./billing";

// ─────────────────────────────────────────────────────────────────────────
// Cobrança real de aluguel via Asaas — MESMO PADRÃO da assinatura do
// ImobiFlow (ver server/services/billing.ts: asaasHeaders, POST /customers,
// POST /payments). Aqui o cliente Asaas é o INQUILINO, não o corretor.
//
// ⚠️ NÃO testado ao vivo: o .env local aponta ASAAS_ENV=production (Asaas de
// verdade, dinheiro real) — não existe sandbox configurado neste ambiente.
// Gerar uma cobrança de teste aqui criaria um cliente e um boleto reais.
// Este código segue fielmente o mesmo formato de chamada já comprovado em
// produção pela assinatura (mesmos headers, mesmo /customers, mesmo
// /payments) — mas o primeiro disparo real deve ser feito com cautela,
// olhando o resultado, não em lote.
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

async function ensureAsaasTenantCustomer(contract: RentalContract): Promise<string> {
  if (contract.asaas_customer_id) return contract.asaas_customer_id;
  if (!contract.tenant_cpf_cnpj) throw new Error("CPF/CNPJ do inquilino é obrigatório pra gerar cobrança.");

  const resp = await fetch(`${ASAAS_BASE_URL}/customers`, {
    method: "POST",
    headers: asaasHeaders(),
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

  const customerId = await ensureAsaasTenantCustomer(contract as RentalContract);

  const dueDate = new Date(refMonthStart.getFullYear(), refMonthStart.getMonth(), contract.due_day);
  const dueDateIso = dueDate.toISOString().split("T")[0];
  const amount = contract.rent_amount_cents / 100;

  const payResp = await fetch(`${ASAAS_BASE_URL}/payments`, {
    method: "POST",
    headers: asaasHeaders(),
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
    const pixResp = await fetch(`${ASAAS_BASE_URL}/payments/${payment.id}/pixQrCode`, { headers: asaasHeaders() });
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
    billing_type: "BOLETO",
    amount_cents: contract.rent_amount_cents,
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
    .select("id")
    .eq("asaas_payment_id", p.id)
    .maybeSingle();
  if (!row) return false; // não é uma cobrança de aluguel — deixa o handler de assinatura tratar

  if (event.event === "PAYMENT_RECEIVED" || event.event === "PAYMENT_CONFIRMED") {
    await supabase.from("imf_rental_payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", row.id);
  } else if (event.event === "PAYMENT_OVERDUE") {
    await supabase.from("imf_rental_payments").update({ status: "overdue" }).eq("id", row.id);
  } else if (event.event === "PAYMENT_DELETED") {
    await supabase.from("imf_rental_payments").update({ status: "failed" }).eq("id", row.id);
  }
  return true;
}
