import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("harness bloqueia carga acidental na produção", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/load-smoke.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        LOAD_TEST_URL: "https://imobiflow-v2.fly.dev/api/health",
        ALLOW_PRODUCTION_LOAD_TEST: "",
      },
    }),
    (error: any) => {
      assert.match(String(error.stderr), /Carga em produção bloqueada/);
      return true;
    },
  );
});
