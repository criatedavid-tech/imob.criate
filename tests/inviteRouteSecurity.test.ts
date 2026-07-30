import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidPublicInviteCode } from "../server/security/publicInviteCode";

test("código público de convite aceita somente o formato criptográfico gerado", () => {
  assert.equal(isValidPublicInviteCode("0123456789abcdef0123456789abcdef"), true);

  for (const invalid of [
    "0123456789ABCDEF0123456789ABCDEF",
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "' OR 1=1--",
    "a".repeat(1_200),
    "",
  ]) {
    assert.equal(isValidPublicInviteCode(invalid), false, invalid.slice(0, 80));
  }
});

test("consulta pública de convite valida o código, limita leituras e não expõe erro bruto", async () => {
  const source = await readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8");
  const start = source.indexOf('authRouter.get("/api/auth/join/:code"');
  const end = source.indexOf('authRouter.post("/api/auth/join"', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /get\("\/api\/auth\/join\/:code", publicReadLimiter/);
  assert.match(route, /isValidPublicInviteCode\(req\.params\.code\)/);
  assert.match(route, /status\(404\)\.json\(\{ error: "Convite não encontrado\." \}\)/);
  assert.match(route, /status\(500\)\.json\(\{ error: "Não foi possível verificar o convite" \}\)/);
  assert.doesNotMatch(route, /json\(\{ error: err(?:\?|\.)/);
});

test("aceite valida o corpo e compensa falhas antes do vínculo", async () => {
  const source = await readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8");
  const start = source.indexOf('authRouter.post("/api/auth/join"');
  const end = source.indexOf("// Valida token e atualiza a senha", start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /authLimiter, validateBody\(joinSchema\)/);
  assert.match(route, /compensateInviteAcceptanceFailure/);
  assert.match(route, /deleteUser\(userId\)/);
  assert.match(route, /update\(\{ used_at: null \}\)/);
  assert.match(route, /membershipCreated = true/);
  assert.doesNotMatch(route, /:\s*err\.message/);
});
