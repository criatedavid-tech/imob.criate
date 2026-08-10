import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";

const { isAgentResetCommand, resetReply } = await import("../server/services/agentConversationReset");

test("@reset exige a mensagem inteira e aceita caixa/espacos", () => {
  assert.equal(isAgentResetCommand("@reset"), true);
  assert.equal(isAgentResetCommand("  @RESET  "), true);
  assert.equal(isAgentResetCommand("apague com @reset"), false);
  assert.equal(isAgentResetCommand("@reset agora"), false);
  assert.equal(isAgentResetCommand("@teste"), false);
});

test("resposta de reset diferencia limpeza e acao em andamento", () => {
  assert.match(resetReply({ ok: true }), /Histórico e contexto.*zerados/);
  assert.match(resetReply({ ok: false, reason: "action_in_progress" }), /ação em processamento/);
});

test("migration faz reset atomico, isolado e exclusivo do service role", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260810a_agent_conversation_reset.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "imf_whatsapp_pending_actions",
    "imf_whatsapp_staged_media",
    "imf_whatsapp_staged_documents",
    "imf_agent_log",
  ]) {
    assert.match(sql, new RegExp(`DELETE FROM public\\.${table}`));
  }
  assert.match(sql, /pending\.status IN \('executing', 'executed'\)/);
  assert.match(sql, /log\.user_id = p_user_id[\s\S]*log\.broker_id = p_broker_id/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.imf_reset_agent_conversation[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.imf_reset_agent_conversation[\s\S]*TO service_role/);
});

test("WhatsApp Pai e aplicacao interceptam @reset sem chamar a IA", async () => {
  const queue = await readFile(new URL("../server/services/whatsappPaiQueue.ts", import.meta.url), "utf8");
  const queueReset = queue.indexOf("if (isAgentResetCommand(text))");
  const queueAgent = queue.indexOf("const result = await runAgent", queueReset);
  assert.ok(queueReset >= 0 && queueAgent > queueReset);
  const queueResetBranch = queue.slice(queueReset, queue.indexOf("const userLogText", queueReset));
  assert.match(queueResetBranch, /resetAgentConversation\(userId, brokerId\)/);
  assert.doesNotMatch(queueResetBranch, /logPaiTurn/);

  const route = await readFile(new URL("../server/routes/agent.ts", import.meta.url), "utf8");
  const routeReset = route.indexOf("if (isAgentResetCommand(message))");
  const routeAgent = route.indexOf("const result = await runAgent", routeReset);
  assert.ok(routeReset >= 0 && routeAgent > routeReset);
  assert.match(route.slice(routeReset, routeAgent), /reset: true/);

  const ui = await readFile(new URL("../src/experience/CommandBar.tsx", import.meta.url), "utf8");
  assert.match(ui, /if \(data\.reset\) \{[\s\S]*setTurns\(\[\]\)/);
});
