import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("backend edita somente lembretes da IA ainda pendentes e da conta autenticada", async () => {
  const source = await read("../server/routes/agent.ts");

  assert.match(source, /agentRouter\.patch\([\s\S]*"\/api\/agent\/reminders\/:id"/);
  assert.match(source, /validateBody\(reminderEditSchema\)/);
  assert.match(source, /\.eq\("broker_id", brokerId\)[\s\S]*\.eq\("event_type", "lembrete"\)[\s\S]*\.eq\("status", "pendente"\)/);
  assert.match(source, /query = query\.eq\("owner_user_id", userId\)/);
});

test("backend nunca reescreve follow-up enviado", async () => {
  const source = await read("../server/routes/agent.ts");
  const start = source.indexOf('"/api/agent/scheduled-followups/:id",\n  requireUser,\n  validateBody');
  const end = source.indexOf('// DELETE /api/agent/scheduled-followups/:id', start);
  assert.ok(start >= 0 && end > start);
  const editRoute = source.slice(start, end);

  assert.match(editRoute, /validateBody\(scheduledFollowupEditSchema\)/);
  assert.match(editRoute, /\.eq\("broker_id", brokerId\)/);
  assert.match(editRoute, /\.eq\("status", "pending"\)/);
  assert.match(editRoute, /normalizePhoneBR\(contact_phone\)/);
  assert.doesNotMatch(editRoute, /status:\s*"pending"/);
});

test("interface mostra edicao apenas nos cards acionaveis", async () => {
  const source = await read("../src/experience/LembretesArea.tsx");

  assert.match(source, /aria-label="Editar lembrete"/);
  assert.match(source, /f\.status === 'pending'[\s\S]*aria-label="Editar follow-up"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /type="datetime-local"/);
  assert.match(source, /Salvar alterações/);
  assert.match(source, /scheduledAt\.getTime\(\) <= Date\.now\(\)/);
});
