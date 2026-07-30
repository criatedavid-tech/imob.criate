import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidPublicBrokerId } from "../server/security/publicBrokerId";

test("identificador publico de corretor aceita somente UUID canonico", () => {
  assert.equal(isValidPublicBrokerId("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isValidPublicBrokerId("123E4567-E89B-12D3-A456-426614174000"), true);

  for (const invalid of [
    "' OR 1=1--",
    "../outro-corretor",
    "123e4567-e89b-12d3-a456-42661417400",
    "123e4567-e89b-12d3-a456-426614174000<script>",
    "",
  ]) {
    assert.equal(isValidPublicBrokerId(invalid), false, invalid);
  }
});

test("vitrines publicas validam o brokerId e não devolvem erro bruto", async () => {
  const source = await readFile(new URL("../server/routes/vitrine.ts", import.meta.url), "utf8");

  for (const [startMarker, endMarker, internalError] of [
    [
      'vitrineRouter.get("/api/vitrine/:brokerId"',
      '// Vitrine pública de Lançamentos',
      "Não foi possível carregar a vitrine",
    ],
    [
      'vitrineRouter.get("/api/vitrine-lancamentos/:brokerId"',
      undefined,
      "Não foi possível carregar a vitrine de lançamentos",
    ],
  ] as const) {
    const start = source.indexOf(startMarker);
    const end = endMarker ? source.indexOf(endMarker, start) : source.length;
    assert.ok(start >= 0 && end > start);
    const route = source.slice(start, end);

    assert.match(route, /isValidPublicBrokerId\(brokerId\)/);
    assert.match(route, /status\(400\)\.json\(\{ error: "Identificador de corretor inválido" \}\)/);
    assert.ok(route.includes(`status(500).json({ error: "${internalError}" })`));
    assert.doesNotMatch(route, /json\(\{ error: err(?:\?|\.)/);
  }
});
