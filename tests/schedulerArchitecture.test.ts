import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API web não registra schedulers recorrentes", async () => {
  const source = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /process group singleton `scheduler`/);
});

test("processo scheduler contém os oito jobs esperados", async () => {
  const source = await readFile(new URL("../scheduler-worker.ts", import.meta.url), "utf8");
  for (const job of [
    "runFollowupTick",
    "runScheduledAgentFollowupsTick",
    "runReminderWhatsappAlertTick",
    "runVisitWhatsappAlertTick",
    "prepareOverageBilling",
    "reconcilePendingBillingActions",
    "expireDueUnitReservations",
    "purgeExpiredWebhookLogs",
  ]) {
    assert.match(source, new RegExp(`task: ${job}`));
  }
});

test("Fly declara scheduler singleton sem serviço HTTP", async () => {
  const fly = await readFile(new URL("../fly.toml", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/deploy-v2.yml", import.meta.url), "utf8");
  assert.match(fly, /scheduler = .*scheduler-worker\.ts/);
  assert.match(fly, /processes = \["scheduler"\]/);
  assert.doesNotMatch(fly.match(/\[http_service\][\s\S]*?\[\[http_service\.checks\]\]/)?.[0] || "", /scheduler/);
  assert.match(workflow, /scale count web=1 scheduler=1/);
});
