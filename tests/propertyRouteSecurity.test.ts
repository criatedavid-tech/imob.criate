import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidPublicPropertySlug } from "../server/security/publicPropertySlug";

test("slug publico de imovel aceita somente o formato gerado pela plataforma", () => {
  assert.equal(isValidPublicPropertySlug("imovel-em-portal-do-sol-68be"), true);
  assert.equal(isValidPublicPropertySlug("apartamento-2-quartos-a1b2"), true);

  for (const invalid of [
    "' OR 1=1--",
    "../outro-imovel",
    "imovel<script>alert(1)</script>",
    "IMOVEL-ABC",
    "a".repeat(161),
    "",
  ]) {
    assert.equal(isValidPublicPropertySlug(invalid), false, invalid);
  }
});

test("rota publica nunca devolve a mensagem bruta do provedor", async () => {
  const source = await readFile(new URL("../server/routes/properties.ts", import.meta.url), "utf8");
  const start = source.indexOf('propertiesRouter.get("/api/properties/:slug"');
  const end = source.indexOf("propertiesRouter.delete", start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /isValidPublicPropertySlug\(req\.params\.slug\)/);
  assert.match(route, /status\(400\)\.json\(\{ error: "Slug de imóvel inválido" \}\)/);
  assert.match(route, /status\(500\)\.json\(\{ error: "Não foi possível carregar o imóvel" \}\)/);
  assert.doesNotMatch(route, /json\(\{ error: err(?:\?|\.)/);
});
