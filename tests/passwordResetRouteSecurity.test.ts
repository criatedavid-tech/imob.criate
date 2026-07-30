import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rota de redefinição valida, limita e consome o token antes do Auth", async () => {
  const source = await readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8");
  const start = source.indexOf('authRouter.post("/api/auth/reset-password"');
  assert.ok(start >= 0);
  const route = source.slice(start);

  assert.match(route, /authLimiter, validateBody\(resetPasswordSchema\)/);
  assert.match(route, /executePasswordReset/);
  assert.match(route, /update\(\{ reset_token: null, reset_token_expires_at: null \}\)/);
  assert.match(route, /\.gt\("reset_token_expires_at", nowIso\)/);
  assert.match(route, /\.is\("reset_token", null\)/);
  assert.doesNotMatch(route, /json\(\{ error: err(?:\?|\.)/);
});
