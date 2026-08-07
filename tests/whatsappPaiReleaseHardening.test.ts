import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeStaffPhone } from "../server/services/whatsappStaffLinks";
import { isPaiAlbumEnvelope } from "../server/services/whatsappPaiQueue";

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

test("CI fornece somente placeholder ao bootstrap fail-closed dos testes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-v2.yml", import.meta.url), "utf8");
  const testStep = workflow.slice(
    workflow.indexOf("- name: Automated tests"),
    workflow.indexOf("- name: Dead code"),
  );
  assert.match(testStep, /SUPABASE_SERVICE_ROLE_KEY: ci-placeholder-not-a-real-secret/);
  assert.doesNotMatch(testStep, /\$\{\{\s*secrets\./);
});

test("migration incremental elimina conflito entre retorno e coluna do telefone", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260807g_whatsapp_phone_verification_conflict_fix.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.imf_start_whatsapp_phone_verification/);
  assert.match(sql, /RETURNS TABLE\(outcome TEXT, phone_normalized TEXT\)/);
  assert.match(sql, /ON CONFLICT ON CONSTRAINT imf_whatsapp_staff_links_pkey DO UPDATE SET/);
  assert.doesNotMatch(sql, /ON CONFLICT \(phone_normalized\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.imf_start_whatsapp_phone_verification[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.imf_start_whatsapp_phone_verification[\s\S]*TO service_role/);
});

test("album do Pai e tratado pelos eventos individuais e a legenda vira comando adiado", async () => {
  assert.equal(isPaiAlbumEnvelope({ mediaType: "collection", messageType: "AlbumMessage" }), true);
  assert.equal(isPaiAlbumEnvelope({ mediaType: "image", messageType: "ImageMessage" }), false);

  const source = await readFile(new URL("../server/services/whatsappPaiQueue.ts", import.meta.url), "utf8");
  assert.match(source, /Envelope de album; fotos processadas individualmente/);
  assert.match(source, /enqueueDeferredPhotoCaption\(row\.sender_phone, rawText, executionMessageId\)/);
  assert.match(source, /dedupe_key: `photo-caption:\$\{providerMessageId\}`/);
  assert.match(source, /photoUrl, "image"/);
  assert.match(source, /storeAgentMediaFromBase64\(\{/);
  assert.match(source, /commandMediaUrl, commandMediaType/);
});

test("numero central fica somente no Assistente IA e nunca vira conversa comercial", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260807h_whatsapp_pai_internal_conversation.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS phone_normalized TEXT/);
  assert.match(sql, /SET phone_normalized = '556299982218'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS media_url TEXT/);
  assert.match(sql, /UPDATE public\.imf_agent_log AS log[\s\S]*imf_whatsapp_staged_media/);
  assert.match(sql, /DELETE FROM public\.imf_conversation_messages[\s\S]*customer_phone = '556299982218'/);
  assert.match(sql, /DELETE FROM public\.imf_conversation_tickets[\s\S]*customer_phone = '556299982218'/);

  const source = await readFile(new URL("../server/services/inboundWebhookQueue.ts", import.meta.url), "utf8");
  assert.match(source, /customerPhone === platformPaiPhone/);
  assert.match(source, /if \(isPaiInternalConversation\)/);
  const internalBranch = source.slice(
    source.indexOf("if (isPaiInternalConversation)"),
    source.indexOf("const providerMessageId", source.indexOf("if (isPaiInternalConversation)")),
  );
  assert.match(internalBranch, /markInboxCompleted/);
  assert.doesNotMatch(internalBranch, /ensureConversationTicket/);
  assert.doesNotMatch(internalBranch, /recordConversationMessage/);
  assert.doesNotMatch(internalBranch, /enqueueN8nOutbox/);

  const route = await readFile(new URL("../server/routes/agent.ts", import.meta.url), "utf8");
  assert.match(route, /select\("role, text, media_url, media_type, created_at"\)/);
  const ui = await readFile(new URL("../src/experience/CommandBar.tsx", import.meta.url), "utf8");
  assert.match(ui, /t\.mediaType === 'image'/);
  assert.match(ui, /t\.mediaType === 'audio'/);
});
