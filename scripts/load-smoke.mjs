import process from "node:process";
import { performance } from "node:perf_hooks";

function integer(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 100) / 100;
}

const target = new URL(process.env.LOAD_TEST_URL || "http://127.0.0.1:3000/api/health");
const requests = integer("LOAD_TEST_REQUESTS", 100, 1, 100_000);
const concurrency = integer("LOAD_TEST_CONCURRENCY", 10, 1, 1_000);
const timeoutMs = integer("LOAD_TEST_TIMEOUT_MS", 10_000, 100, 60_000);
const productionHost = target.hostname === "imobiflow-v2.fly.dev";

if (productionHost && process.env.ALLOW_PRODUCTION_LOAD_TEST !== "I_UNDERSTAND") {
  throw new Error(
    "Carga em produção bloqueada. Use staging/localhost ou defina "
    + "ALLOW_PRODUCTION_LOAD_TEST=I_UNDERSTAND de forma explícita.",
  );
}
if (target.protocol !== "http:" && target.protocol !== "https:") {
  throw new Error("LOAD_TEST_URL precisa usar http ou https.");
}

let next = 0;
const latencies = [];
const statuses = Object.create(null);
let networkErrors = 0;
const startedAt = performance.now();

async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= requests) return;

    const started = performance.now();
    try {
      const response = await fetch(target, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      statuses[response.status] = (statuses[response.status] || 0) + 1;
      latencies.push(performance.now() - started);
    } catch {
      networkErrors += 1;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const failedStatuses = Object.entries(statuses)
  .filter(([status]) => Number(status) < 200 || Number(status) >= 400)
  .reduce((sum, [, count]) => sum + count, 0);

const report = {
  target: target.toString(),
  requests,
  concurrency,
  elapsedSeconds: Math.round(elapsedSeconds * 100) / 100,
  requestsPerSecond: Math.round((requests / elapsedSeconds) * 100) / 100,
  statuses,
  networkErrors,
  latencyMs: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    max: latencies.length ? Math.round(Math.max(...latencies) * 100) / 100 : null,
  },
};

console.log(JSON.stringify(report, null, 2));
if (networkErrors || failedStatuses) process.exitCode = 1;
