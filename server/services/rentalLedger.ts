export type RentalPaymentStatus =
  | "pending"
  | "partial"
  | "paid"
  | "overdue"
  | "negotiated"
  | "canceled"
  | "failed";

export interface RentalFinancialTerms {
  rent_amount_cents: number;
  due_day: number;
  start_date: string;
  end_date?: string | null;
  iptu_amount_cents?: number | null;
  iptu_payer?: "inquilino" | "proprietario" | null;
  condominium_amount_cents?: number | null;
  condominium_payer?: "inquilino" | "proprietario" | null;
  fire_insurance_amount_cents?: number | null;
  fire_insurance_payer?: "inquilino" | "proprietario" | null;
  other_charges_description?: string | null;
  other_charges_cents?: number | null;
  other_charges_payer?: "inquilino" | "proprietario" | null;
}

interface RentalLineItem {
  code: "rent" | "iptu" | "condominium" | "fire_insurance" | "other";
  label: string;
  amount_cents: number;
}

export interface RentalCompetency {
  reference_month: string;
  due_date: string;
  rent_amount_cents: number;
  charges_cents: number;
  discount_cents: number;
  amount_cents: number;
  line_items: RentalLineItem[];
}

const REFERENCE_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function todayIsoInBrasilia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function normalizeReferenceMonth(value: string): string {
  const match = REFERENCE_MONTH_PATTERN.exec(value);
  if (!match) throw new Error("Competencia invalida. Use o formato AAAA-MM.");
  return `${match[1]}-${match[2]}-01`;
}

function monthOf(value: string): string {
  return value.slice(0, 7);
}

function nonNegativeCents(value?: number | null): number {
  return Number.isInteger(value) && (value || 0) > 0 ? Number(value) : 0;
}

export function buildRentalCompetency(
  contract: RentalFinancialTerms,
  referenceMonthInput: string,
): RentalCompetency {
  const referenceMonth = normalizeReferenceMonth(referenceMonthInput);
  const referenceKey = monthOf(referenceMonth);
  const startKey = monthOf(contract.start_date);
  const endKey = contract.end_date ? monthOf(contract.end_date) : null;

  if (referenceKey < startKey || (endKey && referenceKey > endKey)) {
    throw new Error("A competencia esta fora do periodo deste contrato.");
  }
  if (!Number.isInteger(contract.rent_amount_cents) || contract.rent_amount_cents <= 0) {
    throw new Error("O contrato nao possui um aluguel valido.");
  }
  if (!Number.isInteger(contract.due_day) || contract.due_day < 1 || contract.due_day > 28) {
    throw new Error("O contrato nao possui um dia de vencimento valido.");
  }

  const lineItems: RentalLineItem[] = [
    { code: "rent", label: "Aluguel", amount_cents: contract.rent_amount_cents },
  ];
  const addTenantCharge = (
    code: RentalLineItem["code"],
    label: string,
    amount: number | null | undefined,
    payer: "inquilino" | "proprietario" | null | undefined,
  ) => {
    const cents = nonNegativeCents(amount);
    if (payer === "inquilino" && cents > 0) lineItems.push({ code, label, amount_cents: cents });
  };

  addTenantCharge("iptu", "IPTU", contract.iptu_amount_cents, contract.iptu_payer);
  addTenantCharge("condominium", "Condominio", contract.condominium_amount_cents, contract.condominium_payer);
  addTenantCharge("fire_insurance", "Seguro incendio", contract.fire_insurance_amount_cents, contract.fire_insurance_payer);
  addTenantCharge(
    "other",
    contract.other_charges_description?.trim() || "Outros encargos",
    contract.other_charges_cents,
    contract.other_charges_payer,
  );

  const chargesCents = lineItems
    .filter((item) => item.code !== "rent")
    .reduce((total, item) => total + item.amount_cents, 0);

  return {
    reference_month: referenceMonth,
    due_date: `${referenceKey}-${String(contract.due_day).padStart(2, "0")}`,
    rent_amount_cents: contract.rent_amount_cents,
    charges_cents: chargesCents,
    discount_cents: 0,
    amount_cents: contract.rent_amount_cents + chargesCents,
    line_items: lineItems,
  };
}

export function effectiveRentalPaymentStatus(
  status: RentalPaymentStatus,
  dueDate: string,
  today = todayIsoInBrasilia(),
): RentalPaymentStatus {
  return (status === "pending" || status === "partial") && dueDate < today ? "overdue" : status;
}

type RentalFinancialStatus = "adimplente" | "inadimplente" | "sem_cobranca";

export interface RentalFinancialHealth {
  financial_status: RentalFinancialStatus;
  overdue_amount_cents: number;
  overdue_count: number;
}

export interface RentalFinancialHealthPayment {
  status: RentalPaymentStatus;
  due_date: string;
  amount_cents: number;
  amount_paid_cents?: number | null;
}

/**
 * Resume a saude financeira de um contrato sem confundir cobranca futura com
 * inadimplencia. Uma negociacao continua em aberto ate o pagamento ser
 * confirmado; cobrancas canceladas ou com falha nao tornam o inquilino
 * inadimplente.
 */
export function summarizeRentalFinancialHealth(
  openPayments: RentalFinancialHealthPayment[],
  currentMonthStatus: RentalPaymentStatus | null | undefined,
  today = todayIsoInBrasilia(),
): RentalFinancialHealth {
  let overdueAmountCents = 0;
  let overdueCount = 0;

  for (const payment of openPayments) {
    const remaining = Math.max(0, payment.amount_cents - (payment.amount_paid_cents || 0));
    if (remaining === 0 || ["paid", "canceled", "failed"].includes(payment.status)) continue;

    const effectiveStatus = effectiveRentalPaymentStatus(payment.status, payment.due_date, today);
    if (effectiveStatus === "overdue" || effectiveStatus === "negotiated") {
      overdueAmountCents += remaining;
      overdueCount += 1;
    }
  }

  const hasCurrentCharge = Boolean(
    currentMonthStatus && !["canceled", "failed"].includes(currentMonthStatus),
  );

  return {
    financial_status: overdueCount > 0
      ? "inadimplente"
      : hasCurrentCharge
        ? "adimplente"
        : "sem_cobranca",
    overdue_amount_cents: overdueAmountCents,
    overdue_count: overdueCount,
  };
}

export function summarizeTenantFinancialHealth(
  activeContracts: RentalFinancialHealth[],
): RentalFinancialHealth {
  const overdueAmountCents = activeContracts.reduce((sum, item) => sum + item.overdue_amount_cents, 0);
  const overdueCount = activeContracts.reduce((sum, item) => sum + item.overdue_count, 0);

  if (overdueCount > 0) {
    return { financial_status: "inadimplente", overdue_amount_cents: overdueAmountCents, overdue_count: overdueCount };
  }
  if (activeContracts.length === 0 || activeContracts.some((item) => item.financial_status === "sem_cobranca")) {
    return { financial_status: "sem_cobranca", overdue_amount_cents: 0, overdue_count: 0 };
  }
  return { financial_status: "adimplente", overdue_amount_cents: 0, overdue_count: 0 };
}
