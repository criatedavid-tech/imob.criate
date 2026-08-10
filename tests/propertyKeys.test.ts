import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("controle de chaves preserva uma única retirada aberta e o histórico", async () => {
  const migration = await read("../supabase/migrations/20260804_rental_autopilot.sql");
  const hardening = await read("../supabase/migrations/20260810d_property_keys_hardening.sql");

  assert.match(migration, /create table if not exists public\.imf_property_keys/i);
  assert.match(migration, /uq_property_key_active[\s\S]*where returned_at is null/i);
  assert.match(migration, /taken_at timestamptz not null default now\(\)/i);
  assert.match(migration, /returned_at timestamptz/i);
  assert.match(hardening, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(hardening, /REVOKE ALL ON TABLE public\.imf_property_keys FROM anon, authenticated/i);
  assert.match(hardening, /imf_property_keys_phone_check/i);
  assert.match(hardening, /imf_property_keys_due_at_check/i);
  assert.match(hardening, /NOT VALID/i);
});

test("API valida a retirada, isola por conta e nunca oculta erro de leitura", async () => {
  const route = await read("../server/routes/locacao.ts");

  assert.match(route, /const keyCheckoutSchema = z\.object/);
  assert.match(route, /Informe um telefone válido com DDD/);
  assert.match(route, /A previsão de devolução deve ser uma data futura/);
  assert.match(route, /validateBody\(keyCheckoutSchema\)/);
  assert.match(route, /Falha ao carregar controle de chaves/);
  assert.match(route, /locacaoRouter\.patch\("\/api\/locacao\/keys\/:id\/return"/);
  assert.match(route, /\.eq\("broker_id", brokerId\)[\s\S]*\.is\("returned_at", null\)/);
  assert.match(route, /locacaoRouter\.get\("\/api\/locacao\/keys"/);
  assert.match(route, /query\.order\("taken_at", \{ ascending: false \}\)/);
});

test("interface separa posse, devolução e histórico para evitar ação acidental", async () => {
  const source = await read("../src/experience/LocacaoPanels.tsx");

  assert.match(source, /function KeyHistoryModal/);
  assert.match(source, /Histórico de chaves/);
  assert.match(source, /Registrar devolução/);
  assert.match(source, /Confirmar devolução\?/);
  assert.match(source, /Em posse/);
  assert.match(source, /Informe um telefone válido com DDD/);
  assert.doesNotMatch(source, /\? '\.\.\.' : 'Devolvida'/);
});

test("alerta de atraso só considera chaves ainda não devolvidas", async () => {
  const worker = await read("../server/services/rentalAutopilot.ts");

  assert.match(worker, /runKeyOverdueAlertTick/);
  assert.match(worker, /\.is\("returned_at", null\)/);
  assert.match(worker, /\.is\("overdue_alert_sent_at", null\)/);
  assert.match(worker, /A chave ainda não foi registrada como devolvida/);
});
