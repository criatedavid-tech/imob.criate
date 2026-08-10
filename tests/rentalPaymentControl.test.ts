import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";

const { rentalStatusFromAsaas } = await import("../server/services/rentalBilling");
const { decodeRentalBoleto } = await import("../server/services/rentalBoleto");

test("conciliação traduz os estados financeiros relevantes do Asaas", () => {
  assert.equal(rentalStatusFromAsaas("RECEIVED"), "paid");
  assert.equal(rentalStatusFromAsaas("CONFIRMED"), "paid");
  assert.equal(rentalStatusFromAsaas("RECEIVED_IN_CASH"), "paid");
  assert.equal(rentalStatusFromAsaas("OVERDUE"), "overdue");
  assert.equal(rentalStatusFromAsaas("PENDING"), "pending");
  assert.equal(rentalStatusFromAsaas("REFUNDED"), "canceled");
  assert.equal(rentalStatusFromAsaas("DELETED"), "failed");
  assert.equal(rentalStatusFromAsaas("DESCONHECIDO"), null);
});

test("importação aceita PDF real e rejeita conteúdo disfarçado", () => {
  const pdf = Buffer.from("%PDF-1.7\nobjeto de teste");
  assert.deepEqual(
    decodeRentalBoleto(`data:application/pdf;base64,${pdf.toString("base64")}`),
    pdf,
  );
  assert.deepEqual(decodeRentalBoleto(`data:;base64,${pdf.toString("base64")}`), pdf);
  assert.throws(
    () => decodeRentalBoleto(`data:application/pdf;base64,${Buffer.from("arquivo falso").toString("base64")}`),
    /PDF valido/i,
  );
  assert.throws(() => decodeRentalBoleto("data:text/plain;base64,QQ=="), /PDF/i);
});

test("controle híbrido mantém os invariantes de segurança e interrupção da régua", async () => {
  const route = await readFile(new URL("../server/routes/locacao.ts", import.meta.url), "utf8");
  const billing = await readFile(new URL("../server/services/rentalBilling.ts", import.meta.url), "utf8");
  const autopilot = await readFile(new URL("../server/services/rentalAutopilot.ts", import.meta.url), "utf8");
  const scheduler = await readFile(new URL("../scheduler-worker.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20260810b_rental_payment_control.sql", import.meta.url), "utf8");

  for (const suffix of ["status", "boleto", "send", "sync"]) {
    assert.match(route, new RegExp(`/payments/:paymentId/${suffix}`));
  }
  const syncRoute = route.slice(route.indexOf('"/api/locacao/contracts/:contractId/payments/:paymentId/sync"'));
  assert.ok(syncRoute.indexOf('.eq("contract_id", req.params.contractId)') < syncRoute.indexOf("syncRentalPaymentWithAsaas"));
  assert.match(autopilot, /\.in\("status", \["pending", "overdue"\]\)/);
  assert.match(autopilot, /signedRentalBoletoUrl\(payment\)/);
  assert.match(autopilot, /if \(payment\.source === "asaas"\)/);
  assert.match(billing, /row\.manual_status !== "paid"/);
  assert.match(billing, /manual_status:\s*null/);
  assert.match(scheduler, /task:\s*runRentalPaymentReconciliationTick/);
  assert.match(migration, /'imf-rental-bills'[\s\S]*FALSE/);
  assert.match(migration, /manual_status[\s\S]*status_source[\s\S]*asaas_checked_at/);
});
