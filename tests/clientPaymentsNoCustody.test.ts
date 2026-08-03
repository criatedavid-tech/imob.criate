import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("cobranças de clientes exigem conta Asaas própria e nunca usam a chave global", async () => {
  const source = await read("../server/services/asaasCredentials.ts");

  assert.doesNotMatch(source, /import\s*\{[^}]*ASAAS_API_KEY[^}]*\}\s*from\s*["']\.\.\/config["']/s);
  assert.doesNotMatch(source, /build(?:Own)?Creds\(ASAAS_API_KEY/);
  assert.match(source, /throw new ClientAsaasAccountRequiredError\(\)/);
  assert.match(source, /CLIENT_ASAAS_ACCOUNT_REQUIRED/);
});

test("aluguel e reserva usam o resolvedor sem fallback e devolvem código explícito", async () => {
  const [rental, reservation, rentalRoute, developmentsRoute] = await Promise.all([
    read("../server/services/rentalBilling.ts"),
    read("../server/services/unitReservationBilling.ts"),
    read("../server/routes/locacao.ts"),
    read("../server/routes/lancamentos.ts"),
  ]);

  assert.match(rental, /resolveAsaasCredentials\(contract\.broker_id\)/);
  assert.match(reservation, /resolveAsaasCredentials\(row\.broker_id\)/);
  assert.doesNotMatch(rental, /fallback\).*conta global|conta global.*fallback/s);
  assert.doesNotMatch(reservation, /fallback\).*conta global|conta global.*fallback/s);
  assert.match(rentalRoute, /ClientAsaasAccountRequiredError/);
  assert.match(rentalRoute, /status\(409\).*code: err\.code/s);
  assert.match(developmentsRoute, /ClientAsaasAccountRequiredError/);
  assert.match(developmentsRoute, /status\(409\).*code: error\.code/s);
});

test("interface não promete fallback financeiro da Criate", async () => {
  const [config, rentals, developments] = await Promise.all([
    read("../src/experience/ConfigArea.tsx"),
    read("../src/experience/LocacaoArea.tsx"),
    read("../src/experience/LancamentosArea.tsx"),
  ]);

  assert.doesNotMatch(config, /cobranças (?:usam|voltam a usar) a conta da Criate/i);
  assert.match(config, /Sem integração própria, novas cobranças ficam bloqueadas/);
  assert.match(rentals, /billingAccountConfigured/);
  assert.match(developments, /paymentIntegrationConfigured/);
});
