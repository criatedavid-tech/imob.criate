import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRentalCompetency,
  effectiveRentalPaymentStatus,
  normalizeReferenceMonth,
  summarizeRentalFinancialHealth,
  summarizeTenantFinancialHealth,
  todayIsoInBrasilia,
} from "../server/services/rentalLedger";

const contract = {
  rent_amount_cents: 250_000,
  due_day: 10,
  start_date: "2026-01-15",
  end_date: "2026-12-31",
  iptu_amount_cents: 15_000,
  iptu_payer: "proprietario" as const,
  condominium_amount_cents: 45_000,
  condominium_payer: "inquilino" as const,
  fire_insurance_amount_cents: 3_000,
  fire_insurance_payer: "inquilino" as const,
  other_charges_description: "Agua",
  other_charges_cents: 8_000,
  other_charges_payer: "inquilino" as const,
};

test("competencia soma somente os encargos atribuidos ao inquilino", () => {
  const competency = buildRentalCompetency(contract, "2026-08");

  assert.equal(competency.reference_month, "2026-08-01");
  assert.equal(competency.due_date, "2026-08-10");
  assert.equal(competency.rent_amount_cents, 250_000);
  assert.equal(competency.charges_cents, 56_000);
  assert.equal(competency.amount_cents, 306_000);
  assert.deepEqual(competency.line_items.map((item) => item.code), [
    "rent",
    "condominium",
    "fire_insurance",
    "other",
  ]);
});

test("competencia fora da vigencia e mes malformado sao rejeitados", () => {
  assert.throws(() => buildRentalCompetency(contract, "2025-12"), /fora do periodo/i);
  assert.throws(() => buildRentalCompetency(contract, "2027-01"), /fora do periodo/i);
  assert.throws(() => normalizeReferenceMonth("08/2026"), /formato AAAA-MM/i);
});

test("status vencido considera saldo parcial e nunca sobrescreve pagamento integral", () => {
  assert.equal(effectiveRentalPaymentStatus("pending", "2026-08-09", "2026-08-10"), "overdue");
  assert.equal(effectiveRentalPaymentStatus("pending", "2026-08-10", "2026-08-10"), "pending");
  assert.equal(effectiveRentalPaymentStatus("partial", "2026-08-01", "2026-08-10"), "overdue");
  assert.equal(effectiveRentalPaymentStatus("partial", "2026-08-10", "2026-08-10"), "partial");
  assert.equal(effectiveRentalPaymentStatus("paid", "2026-08-01", "2026-08-10"), "paid");
});

test("virada UTC nao antecipa inadimplencia no horario de Brasilia", () => {
  assert.equal(todayIsoInBrasilia(new Date("2026-08-11T00:30:00.000Z")), "2026-08-10");
});

test("saude financeira separa cobranca futura de inadimplencia real", () => {
  const future = summarizeRentalFinancialHealth([
    { status: "pending", due_date: "2026-08-11", amount_cents: 500_000, amount_paid_cents: 0 },
  ], "pending", "2026-08-10");
  assert.deepEqual(future, {
    financial_status: "adimplente",
    overdue_amount_cents: 0,
    overdue_count: 0,
  });

  const overdue = summarizeRentalFinancialHealth([
    { status: "partial", due_date: "2026-08-09", amount_cents: 500_000, amount_paid_cents: 125_000 },
    { status: "negotiated", due_date: "2026-08-01", amount_cents: 100_000, amount_paid_cents: 0 },
  ], "partial", "2026-08-10");
  assert.deepEqual(overdue, {
    financial_status: "inadimplente",
    overdue_amount_cents: 475_000,
    overdue_count: 2,
  });
});

test("saude do inquilino consolida todos os contratos ativos", () => {
  assert.equal(summarizeTenantFinancialHealth([]).financial_status, "sem_cobranca");
  assert.equal(summarizeTenantFinancialHealth([
    { financial_status: "adimplente", overdue_amount_cents: 0, overdue_count: 0 },
  ]).financial_status, "adimplente");
  assert.deepEqual(summarizeTenantFinancialHealth([
    { financial_status: "adimplente", overdue_amount_cents: 0, overdue_count: 0 },
    { financial_status: "inadimplente", overdue_amount_cents: 250_000, overdue_count: 1 },
  ]), {
    financial_status: "inadimplente",
    overdue_amount_cents: 250_000,
    overdue_count: 1,
  });
});

test("rotas de locacao registram recebimento externo sem criar cobranca", async () => {
  const source = await readFile(new URL("../server/routes/locacao.ts", import.meta.url), "utf8");

  assert.match(source, /source:\s*"external"/);
  assert.match(source, /billing_type:\s*"EXTERNAL"/);
  assert.match(source, /imf_record_external_rental_receipt/);
  assert.match(source, /historico financeiro[\s\S]*Encerre o contrato/);
});
