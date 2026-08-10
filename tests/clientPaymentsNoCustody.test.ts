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

test("trava financeira global também protege scheduler e controles de automação", async () => {
  const [autopilot, rentalRoute] = await Promise.all([
    read("../server/services/rentalAutopilot.ts"),
    read("../server/routes/locacao.ts"),
  ]);

  assert.match(autopilot, /import \{ CLIENT_FINANCIAL_OPERATIONS_ENABLED \} from "\.\.\/config"/);
  for (const job of ["runRentalChargeGenerationTick", "runRentalDunningTick"]) {
    const start = autopilot.indexOf(`export async function ${job}`);
    assert.ok(start >= 0, `${job} ausente`);
    const guard = autopilot.slice(start, start + 500);
    assert.match(guard, /if \(!CLIENT_FINANCIAL_OPERATIONS_ENABLED\) return;/, `${job} sem trava global`);
  }

  assert.match(rentalRoute, /enabled && !CLIENT_FINANCIAL_OPERATIONS_ENABLED/);
  assert.match(rentalRoute, /charge_generation_enabled === true/);
  assert.match(rentalRoute, /dunning_enabled === true/);
  assert.match(rentalRoute, /CLIENT_FINANCIAL_OPERATIONS_DISABLED/);
  assert.match(rentalRoute, /!ativo\.global \|\| !ativo\.geracao_conta/);
  assert.match(rentalRoute, /!ativo\.global \|\| !ativo\.regua_conta/);
});

test("teste de WhatsApp da locação é explícito, limitado e não gera cobrança", async () => {
  const [route, limits] = await Promise.all([
    read("../server/routes/locacao.ts"),
    read("../server/middleware/rateLimits.ts"),
  ]);
  const start = route.indexOf('"/api/locacao/contracts/:id/test-dispatch"');
  const end = route.indexOf('// Alçada da IA de cobrança', start);
  assert.ok(start >= 0 && end > start);
  const testRoute = route.slice(start, end);

  assert.match(testRoute, /rentalTestDispatchLimiter/);
  assert.match(testRoute, /\.eq\("broker_id", brokerId\)/);
  assert.match(testRoute, /\[TESTE ImobiFlow\]/);
  assert.match(testRoute, /sendUazapiText/);
  assert.doesNotMatch(testRoute, /generateRentCharge|imf_rental_payments/);
  assert.match(limits, /rentalTestDispatchLimiter/);
  assert.match(limits, /max: 5/);
});

test("opções nativas de select têm contraste explícito nos dois temas", async () => {
  const css = await read("../src/index.css");
  assert.match(css, /select option\s*\{[^}]*color:\s*#EAF0FF;[^}]*background-color:\s*#0E1626;/s);
  assert.match(css, /data-theme="light"\] select option\s*\{[^}]*color:\s*#141C2E;[^}]*background-color:\s*#FFFFFF;/s);
});

test("piloto financeiro do deploy V2 fica habilitado somente em sandbox", async () => {
  const [config, fly, docker, credentials, brokers, autopilot] = await Promise.all([
    read("../server/config.ts"),
    read("../fly.toml"),
    read("../Dockerfile"),
    read("../server/services/asaasCredentials.ts"),
    read("../server/routes/brokers.ts"),
    read("../server/services/rentalAutopilot.ts"),
  ]);

  assert.match(config, /CLIENT_FINANCIAL_SANDBOX_ONLY\s*=\s*\n?\s*process\.env\.CLIENT_FINANCIAL_SANDBOX_ONLY !== "false"/);
  assert.match(fly, /VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED = "true"/);
  assert.match(fly, /CLIENT_FINANCIAL_OPERATIONS_ENABLED = "true"/);
  assert.match(fly, /CLIENT_FINANCIAL_SANDBOX_ONLY = "true"/);
  assert.match(docker, /ARG VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED=false/);
  assert.match(credentials, /data\.asaas_env !== "sandbox"/);
  assert.match(credentials, /CLIENT_ASAAS_SANDBOX_REQUIRED/);
  assert.match(credentials, /https:\/\/api-sandbox\.asaas\.com\/v3/);
  assert.match(credentials, /"User-Agent": "ImobiFlow\/2\.0/);
  assert.match(brokers, /CLIENT_FINANCIAL_SANDBOX_ONLY && env !== "sandbox"/);
  assert.match(autopilot, /assertClientAsaasEnvironmentAllowed\(contract\.broker_id\)/);
});

test("cobrança própria garante webhook autenticado antes da emissão", async () => {
  const [credentials, rental, reservation] = await Promise.all([
    read("../server/services/asaasCredentials.ts"),
    read("../server/services/rentalBilling.ts"),
    read("../server/services/unitReservationBilling.ts"),
  ]);

  assert.match(credentials, /ensureClientAsaasPaymentWebhook/);
  assert.match(credentials, /ASAAS_WEBHOOK_TOKEN\.length < 32/);
  assert.match(credentials, /\/webhooks\?offset=0&limit=100/);
  assert.match(credentials, /PAYMENT_RECEIVED/);
  assert.match(credentials, /authToken: ASAAS_WEBHOOK_TOKEN/);
  assert.match(rental, /await ensureClientAsaasPaymentWebhook\(creds\)/);
  assert.match(rental, /timeZone: "America\/Sao_Paulo"/);
  assert.match(reservation, /await ensureClientAsaasPaymentWebhook\(creds\)/);
});
