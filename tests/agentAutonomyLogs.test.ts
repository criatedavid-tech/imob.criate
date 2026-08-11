import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeOperationalText } from "../server/services/systemErrorLogs";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("migration persiste autonomia, coordena lote de fotos e protege logs", async () => {
  const sql = await read("../supabase/migrations/20260811b_agent_autonomy_media_batches_and_system_logs.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.imf_agent_preferences/);
  assert.match(sql, /CHECK \(autonomy IN \('piloto', 'copiloto', 'manual'\)\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.imf_whatsapp_media_batches/);
  assert.match(sql, /imf_stage_whatsapp_media_batch/);
  assert.match(sql, /imf_claim_whatsapp_media_batches/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.imf_system_error_logs/);
  assert.match(sql, /CHECK \(status IN \('pendente', 'em_analise', 'resolvido'\)\)/);
  assert.match(sql, /ALTER TABLE public\.imf_system_error_logs ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.imf_system_error_logs FROM anon, authenticated/);
  assert.match(sql, /imf_reset_agent_conversation[\s\S]*imf_whatsapp_media_batches/);
});

test("logs operacionais removem credenciais e dados pessoais comuns", () => {
  const clean = sanitizeOperationalText(
    "authorization: Bearer-segredo token=abc123456 senha:minhasenha email pessoa@exemplo.com fone 62999998888 cpf 123.456.789-09 sk-abcdefghijklmnop",
  );
  assert.doesNotMatch(clean, /Bearer-segredo|abc123456|minhasenha|pessoa@exemplo|62999998888|123\.456\.789-09|sk-abcdefghijklmnop/);
  assert.match(clean, /PROTEGIDO/);
});

test("tela e API de logs sao exclusivas do admin do sistema", async () => {
  const [route, shell, rail] = await Promise.all([
    read("../server/routes/systemLogs.ts"),
    read("../src/experience/ExperienceShell.tsx"),
    read("../src/experience/ManualRail.tsx"),
  ]);
  assert.match(route, /select\("is_admin"\)/);
  assert.match(route, /!broker\?\.is_admin/);
  assert.doesNotMatch(route, /isBrokerOwner/);
  assert.match(shell, /<LogsArea/);
  assert.match(rail, /if \(a\.key === 'logs'\) return isAdmin/);
});

test("WhatsApp Pai respeita a preferencia e auto-confirma somente no piloto", async () => {
  const [queue, preferences, route] = await Promise.all([
    read("../server/services/whatsappPaiQueue.ts"),
    read("../server/services/agentPreferences.ts"),
    read("../server/routes/agent.ts"),
  ]);
  assert.match(queue, /getAgentAutonomy\(brokerId, userId\)/);
  assert.match(queue, /preference\.autonomy === "piloto" && preference\.migrationReady/);
  assert.match(queue, /handlePendingAction\([\s\S]*"confirm"/);
  assert.match(preferences, /autonomy: "copiloto", migrationReady: false/);
  assert.match(route, /const preference = await getAgentAutonomy\(brokerId, userId\)/);
  assert.match(route, /autonomy: preference\.migrationReady \? preference\.autonomy : "copiloto"/);
  assert.doesNotMatch(route, /includes\(autonomy\) \? autonomy : "copiloto"/);
});

test("agente recebe leads e etapas reais e move CRM com revalidacao", async () => {
  const agent = await read("../server/services/agent.ts");
  assert.match(agent, /recentLeads:/);
  assert.match(agent, /crmStages:/);
  assert.match(agent, /type === "move_lead_stage"/);
  assert.match(agent, /leadInAccount/);
  assert.match(agent, /pipeline_stage_id: stage\.id/);
  assert.match(agent, /move_lead_stage: \{ module: "negocios", action: "editar" \}/);
});
