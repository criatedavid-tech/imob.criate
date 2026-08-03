import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRentalCompetency,
  effectiveRentalPaymentStatus,
  normalizeReferenceMonth,
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

test("rotas de locacao registram recebimento externo sem criar cobranca", async () => {
  const source = await readFile(new URL("../server/routes/locacao.ts", import.meta.url), "utf8");

  assert.match(source, /source:\s*"external"/);
  assert.match(source, /billing_type:\s*"EXTERNAL"/);
  assert.match(source, /imf_record_external_rental_receipt/);
  assert.match(source, /historico financeiro[\s\S]*Encerre o contrato/);
});
