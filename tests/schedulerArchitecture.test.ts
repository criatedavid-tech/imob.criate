import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API web não registra schedulers recorrentes", async () => {
  const source = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /process group singleton `scheduler`/);
});

test("processo scheduler registra todos os jobs recorrentes esperados", async () => {
  const source = await readFile(new URL("../scheduler-worker.ts", import.meta.url), "utf8");
  for (const job of [
    "runFollowupTick",
    "runScheduledAgentFollowupsTick",
    "runReminderWhatsappAlertTick",
    "runVisitWhatsappAlertTick",
    "runGoogleCalendarSyncTick",
    "prepareOverageBilling",
    "reconcilePendingBillingActions",
    "expireDueUnitReservations",
    "purgeExpiredWebhookLogs",
    "purgeResolvedSystemLogs",
    // Sem retenção, os índices de dedupe das filas crescem para sempre e a
    // ingestão degrada de forma permanente.
    "purgeResolvedQueueRows",
    // Sem o guardião, a UAZAPI perde o webhook e o inbound para em silêncio.
    "runWebhookKeeperTick",
    "runInboundMediaBackfillTick",
    "runRentalChargeGenerationTick",
    "runRentalDunningTick",
    "runRentalPaymentReconciliationTick",
    "runKeyOverdueAlertTick",
    "expirePaiPendingActions",
    "expireStagedWhatsappMedia",
    "expireStagedWhatsappDocuments",
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
  // O invariante é o scheduler ser SINGLETON (os jobs recorrentes não podem
  // rodar em duas máquinas). A contagem de `web`/`worker` é decisão de
  // capacidade e não deve ser fixada aqui — antes o teste exigia web=1
  // literal, o que impedia escalar a camada web sem quebrar o CI.
  assert.match(workflow, /scale count[^\n]*scheduler=1/);
  assert.match(workflow, /name: Ensure scheduler is running/);
  assert.match(workflow, /fly_process_group.*scheduler/);
  assert.match(workflow, /flyctl machine start "\$scheduler_id"/);
});
