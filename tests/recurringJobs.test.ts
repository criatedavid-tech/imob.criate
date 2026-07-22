import assert from "node:assert/strict";
import test from "node:test";
import { createRecurringJobRunner } from "../server/lib/recurringJobs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const silentLogger = { info() {}, warn() {}, error() {} };

test("executa job marcado para iniciar imediatamente", async () => {
  let runs = 0;
  const runner = createRecurringJobRunner([
    { name: "immediate", intervalMs: 1_000, runOnStart: true, task: async () => { runs += 1; } },
  ], { logger: silentLogger });

  runner.start();
  await sleep(20);
  assert.equal(runs, 1);
  assert.equal(await runner.stop(), true);
});

test("não sobrepõe duas execuções do mesmo job", async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runner = createRecurringJobRunner([
    {
      name: "slow",
      intervalMs: 5,
      runOnStart: true,
      task: async () => { runs += 1; await gate; },
    },
  ], { logger: silentLogger });

  runner.start();
  await sleep(30);
  assert.equal(runs, 1);
  assert.deepEqual(runner.activeJobNames(), ["slow"]);
  release();
  assert.equal(await runner.stop(), true);
});

test("uma falha não encerra os próximos ciclos", async () => {
  let runs = 0;
  const errors: string[] = [];
  const runner = createRecurringJobRunner([
    {
      name: "recoverable",
      intervalMs: 10,
      runOnStart: true,
      task: async () => {
        runs += 1;
        if (runs === 1) throw new Error("falha esperada");
      },
    },
  ], {
    logger: { info() {}, warn() {}, error(message) { errors.push(message); } },
  });

  runner.start();
  await sleep(45);
  assert.ok(runs >= 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /falha esperada/);
  assert.equal(await runner.stop(), true);
});

test("shutdown aguarda o job ativo terminar", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runner = createRecurringJobRunner([
    { name: "drain", intervalMs: 1_000, runOnStart: true, task: () => gate },
  ], { logger: silentLogger, shutdownTimeoutMs: 1_000 });

  runner.start();
  await sleep(10);
  let stopped = false;
  const stopping = runner.stop().then((value) => { stopped = true; return value; });
  await sleep(20);
  assert.equal(stopped, false);
  release();
  assert.equal(await stopping, true);
});
