import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  N8nInputValidationError,
  isInternalBearerTokenValid,
  isValidNormalizedBrazilianPhone,
  parseN8nAgendaCreate,
  parseN8nAgendaDelete,
  parseN8nAgendaUpdate,
  parseN8nAiReply,
  parseN8nLlmProxyRequest,
  parseN8nPropertyCatalog,
} from "../server/security/n8nGuardrails";

const BROKER_ID = "11111111-1111-4111-8111-111111111111";
const VISIT_ID = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-07-22T12:00:00-03:00");

test("autentica somente Bearer exato e nunca aceita segredo ausente", () => {
  assert.equal(isInternalBearerTokenValid("Bearer segredo-forte", "segredo-forte"), true);
  assert.equal(isInternalBearerTokenValid("bearer segredo-forte", "segredo-forte"), true);
  assert.equal(isInternalBearerTokenValid("segredo-forte", "segredo-forte"), false);
  assert.equal(isInternalBearerTokenValid("Bearer segredo-falso", "segredo-forte"), false);
  assert.equal(isInternalBearerTokenValid("Bearer segredo-forte extra", "segredo-forte"), false);
  assert.equal(isInternalBearerTokenValid("Bearer segredo-forte", ""), false);
});

test("aceita visita horária em Brasília e sanitiza campos textuais", () => {
  const parsed = parseN8nAgendaCreate({
    broker_id: BROKER_ID,
    client_name: "  Ana\u0000 Maria  ",
    client_phone: "556291592150",
    startAt: "2026-07-23T14:00:00-03:00",
    endAt: "2026-07-23T15:00:00-03:00",
    title: "Visita ao imóvel",
    event_id: EVENT_ID,
  }, NOW);

  assert.equal(parsed.client_name, "Ana  Maria");
  assert.equal(parsed.startAt, "2026-07-23T14:00:00-03:00");
});

test("rejeita fuso, minuto, duração, passado e horizonte fora do contrato", () => {
  const base = {
    broker_id: BROKER_ID,
    client_phone: "556291592150",
    startAt: "2026-07-23T14:00:00-03:00",
    endAt: "2026-07-23T15:00:00-03:00",
  };

  for (const invalid of [
    { ...base, startAt: "2026-07-23T17:00:00Z" },
    { ...base, startAt: "2026-07-23T14:30:00-03:00", endAt: "2026-07-23T15:30:00-03:00" },
    { ...base, endAt: "2026-07-23T16:00:00-03:00" },
    { ...base, startAt: "2026-07-21T14:00:00-03:00", endAt: "2026-07-21T15:00:00-03:00" },
    { ...base, startAt: "2028-07-23T14:00:00-03:00", endAt: "2028-07-23T15:00:00-03:00" },
  ]) {
    assert.throws(() => parseN8nAgendaCreate(invalid, NOW), N8nInputValidationError);
  }
});

test("rejeita mutação vazia, IDs inválidos e campos inesperados", () => {
  assert.throws(
    () => parseN8nAgendaUpdate({ broker_id: BROKER_ID }, NOW),
    N8nInputValidationError,
  );
  assert.throws(
    () => parseN8nAgendaDelete({ id: "../../outro-tenant", broker_id: BROKER_ID }),
    N8nInputValidationError,
  );
  assert.throws(
    () => parseN8nAgendaCreate({
      broker_id: BROKER_ID,
      client_phone: "556291592150",
      startAt: "2026-07-23T14:00:00-03:00",
      run_sql: "delete from imf_agenda",
    }, NOW),
    N8nInputValidationError,
  );
});

test("limita a resposta da IA e valida escopo de ticket/evento", () => {
  const parsed = parseN8nAiReply({
    broker_id: BROKER_ID,
    customer_phone: "+55 62 9159-2150",
    text: "Olá! Como posso ajudar?",
    ticket_id: TICKET_ID,
    event_id: EVENT_ID,
  });
  assert.equal(parsed.ticket_id, TICKET_ID);
  assert.equal(isValidNormalizedBrazilianPhone("556291592150"), true);
  assert.equal(isValidNormalizedBrazilianPhone("551"), false);
  assert.throws(
    () => parseN8nAiReply({ ...parsed, text: "x".repeat(4_001) }),
    N8nInputValidationError,
  );
});

test("catálogo interno exige corretor válido e aplica teto", () => {
  assert.equal(parseN8nPropertyCatalog({ broker_id: BROKER_ID }).limit, 50);
  assert.equal(parseN8nPropertyCatalog({ broker_id: BROKER_ID, limit: "100" }).limit, 100);
  assert.throws(
    () => parseN8nPropertyCatalog({ broker_id: BROKER_ID, limit: "101" }),
    N8nInputValidationError,
  );
});

test("proxy LLM aceita apenas modelo permitido e requisição limitada", () => {
  const allowed = new Set(["openai/gpt-4o-mini"]);
  const valid = {
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Olá" }],
    max_tokens: 800,
    stream: false,
  };
  assert.equal(parseN8nLlmProxyRequest(valid, allowed).model, valid.model);
  assert.throws(
    () => parseN8nLlmProxyRequest({ ...valid, model: "modelo/caro-não-autorizado" }, allowed),
    N8nInputValidationError,
  );
  assert.throws(
    () => parseN8nLlmProxyRequest({ ...valid, stream: true }, allowed),
    N8nInputValidationError,
  );
  assert.throws(
    () => parseN8nLlmProxyRequest({ ...valid, max_tokens: 20_000 }, allowed),
    N8nInputValidationError,
  );
});

test("dispatcher envia autenticação e IDs duráveis ao n8n", async () => {
  const source = await readFile(new URL("../server/services/inboundWebhookQueue.ts", import.meta.url), "utf8");
  assert.match(source, /Authorization: `Bearer \$\{N8N_WEBHOOK_TOKEN\}`/);
  assert.match(source, /"X-ImobiFlow-Event-Id": row\.id/);
  assert.match(source, /ticket_id: input\.ticketId/);
  assert.match(source, /event_id: row\.id/);
});

test("agenda expõe contexto anonimizado separado dos dados do cliente", async () => {
  const source = await readFile(new URL("../server/routes/agenda.ts", import.meta.url), "utf8");
  const contextStart = source.indexOf("'/api/agenda/n8n/context'");
  const listStart = source.indexOf("'/api/agenda/n8n/list'", contextStart);
  assert.ok(contextStart >= 0 && listStart > contextStart);
  const contextRoute = source.slice(contextStart, listStart);
  assert.match(contextRoute, /customer_visits/);
  assert.match(contextRoute, /busy_slots/);
  assert.equal(contextRoute.slice(contextRoute.indexOf("busy_slots")).includes("client_phone:"), false);
});

test("banco possui garantia atômica contra visitas sobrepostas", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260722a_n8n_agenda_guardrails.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.imf_agenda_visit_range/);
  assert.match(migration, /LANGUAGE sql\s+IMMUTABLE\s+PARALLEL SAFE/);
  assert.match(migration, /EXCLUDE USING gist/);
  assert.match(migration, /public\.imf_agenda_visit_range\(\s*scheduled_at,\s*duration_minutes\s*\) WITH &&/);
  assert.match(migration, /event_type = 'visita'/);
  assert.match(migration, /status <> 'cancelado'/);
  assert.doesNotMatch(migration, /tstzrange\(\s*scheduled_at,\s*scheduled_at \+ make_interval/);
});

test("catálogo do n8n não usa SELECT star e limita descrições", async () => {
  const source = await readFile(new URL("../server/routes/properties.ts", import.meta.url), "utf8");
  const start = source.indexOf('"/api/properties/n8n/catalog"');
  const end = source.indexOf('// --- ROTAS DE PROPRIEDADES', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.equal(route.includes(".select('*')"), false);
  assert.match(route, /\.limit\(limit\)/);
  assert.match(route, /1_000/);
});
