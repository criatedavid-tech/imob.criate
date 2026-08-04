import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { areasForCapabilities, defaultCapabilitiesForPersona } from "../src/experience/engine";

test("tipos existentes preservam suas funcoes padrao", () => {
  assert.deepEqual(defaultCapabilitiesForPersona("corretor"), []);
  assert.deepEqual(defaultCapabilitiesForPersona("imobiliaria"), ["rentals", "finance", "team"]);
  assert.deepEqual(defaultCapabilitiesForPersona("incorporadora"), ["developments", "finance", "team"]);
});

test("uma conta pode combinar locacao e lancamentos no mesmo rail", () => {
  const keys = areasForCapabilities(["rentals", "developments", "finance", "team"]).map((area) => area.key);
  assert.ok(keys.includes("locacao"));
  assert.ok(keys.includes("lancamentos"));
  assert.ok(keys.includes("financeiro"));
  assert.ok(keys.includes("equipe"));
});

test("areas especializadas somem quando a funcao nao esta liberada", () => {
  const keys = areasForCapabilities([]).map((area) => area.key);
  assert.ok(keys.includes("carteira"));
  assert.ok(keys.includes("negocios"));
  assert.ok(!keys.includes("locacao"));
  assert.ok(!keys.includes("lancamentos"));
  assert.ok(!keys.includes("financeiro"));
  assert.ok(!keys.includes("equipe"));
});

test("backend protege rotas especializadas e nao confia na persona do navegador", async () => {
  const [locacao, lancamentos, financeiro, equipe, agentRoute] = await Promise.all([
    readFile(new URL("../server/routes/locacao.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/lancamentos.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/financeiro.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/equipe.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/agent.ts", import.meta.url), "utf8"),
  ]);

  assert.match(locacao, /use\("\/api\/locacao",[\s\S]*?requireUser, requireAccountCapability\("rentals"\)\)/);
  // /api/locacao/n8n/* e chamada maquina-a-maquina do n8n (auth propria por
  // token interno em rentalAgent.ts) - precisa pular o guard de sessao acima
  // sem virar uma brecha geral pro resto de /api/locacao.
  assert.match(locacao, /req\.path\.startsWith\("\/n8n\/"\)/);
  assert.match(locacao, /next\("router"\)/);
  assert.match(lancamentos, /use\("\/api\/lancamentos", requireUser, requireAccountCapability\("developments"\)\)/);
  assert.match(financeiro, /use\("\/api\/financeiro", requireUser, requireAccountCapability\("finance"\)\)/);
  assert.match(equipe, /use\("\/api\/equipe", requireUser, requireAccountCapability\("team"\)\)/);
  assert.match(agentRoute, /const effectivePersona = entitlement\.isAdmin/);
  assert.match(agentRoute, /requiredCapabilityForAgentAction/);
});

test("migration mantem overrides privados e atualizacao atomica", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260803_account_capability_overrides.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE .* FROM anon, authenticated/);
  assert.match(migration, /imf_set_account_capabilities/);
  assert.match(migration, /FOR UPDATE/);
});
