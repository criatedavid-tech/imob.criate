import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeStaffPhone } from "../server/services/whatsappStaffLinks";

test("telefone de colaborador aceita formato local e brasileiro", () => {
  assert.equal(normalizeStaffPhone("(62) 99982-2218"), "556299822218");
  assert.equal(normalizeStaffPhone("55 62 99982-2218"), "556299822218");
  assert.throws(() => normalizeStaffPhone("629982218"), /inválido/);
  assert.throws(() => normalizeStaffPhone("0062999822218"), /inválido/);
});

test("migração protege confirmação, staging e ativação do webhook", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260807f_whatsapp_pai_release_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS execution_message_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS provider_message_id TEXT/);
  assert.match(sql, /ON CONFLICT \(phone_normalized\) DO UPDATE SET[\s\S]*WHERE imf_whatsapp_staff_links\.verified_at IS NULL/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.imf_start_whatsapp_phone_verification[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.imf_confirm_whatsapp_phone_verification[\s\S]*TO service_role/);
});

test("fila do Pai persiste execução antes da mutação e não aceita envio 2xx falso", async () => {
  const source = await readFile(new URL("../server/services/whatsappPaiQueue.ts", import.meta.url), "utf8");
  const claim = source.indexOf('status: "executing"');
  const execute = source.indexOf("await executeAction", claim);
  assert.ok(claim >= 0 && execute > claim, "a confirmação precisa ser reivindicada antes de executar");
  assert.match(source, /if \(!sent\.ok\)\s*{\s*throw new Error/);
  assert.doesNotMatch(source, /provider_message_id[\s\S]{0,300}already/);
  assert.match(source, /\.eq\("user_id", userId\)\.eq\("broker_id", brokerId\)/);
});

test("webhook do Pai usa limite de corpo dedicado", async () => {
  const source = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const paiLimit = source.indexOf('app.use("/api/wpp-pai/inbound", express.json({ limit: "512kb" }))');
  const globalLimit = source.indexOf('app.use(express.json({ limit: "10mb" }))');
  assert.ok(paiLimit >= 0 && globalLimit > paiLimit);

  const route = await readFile(new URL("../server/routes/whatsappPai.ts", import.meta.url), "utf8");
  assert.match(route, /select\("uazapi_instance_token, webhook_enabled"\)/);
  assert.match(route, /!instance\?\.webhook_enabled/);
});
