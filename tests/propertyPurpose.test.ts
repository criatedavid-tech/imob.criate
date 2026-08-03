import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parsePropertyPurpose } from "../server/services/propertyPurpose";

const withDetails = (details: unknown) => `Descrição pública\n\n---DETALHES-GERADOS---\n${JSON.stringify(details)}`;

test("extrai finalidade estruturada sem inferir pelo texto do anúncio", () => {
  assert.equal(parsePropertyPurpose(withDetails({ finalidade: "aluguel" })), "aluguel");
  assert.equal(parsePropertyPurpose(withDetails({ finalidade: "ambos" })), "ambos");
  assert.equal(parsePropertyPurpose(withDetails({ finalidade: "venda" })), "venda");
  assert.equal(parsePropertyPurpose(withDetails({ finalidade: "locação" })), "aluguel");

  assert.equal(parsePropertyPurpose("Apartamento perfeito para alugar, sem bloco estruturado"), "venda");
  assert.equal(parsePropertyPurpose("---DETALHES-GERADOS---\n{json inválido"), "venda");
});

test("snapshot da IA inclui finalidade e proíbe inferência por preço ou título", async () => {
  const source = await readFile(new URL("../server/services/agent.ts", import.meta.url), "utf8");

  assert.match(source, /select\("id, title, price, status, description"\)/);
  assert.match(source, /finalidade: parsePropertyPurpose\(p\.description\)/);
  assert.match(source, /use EXCLUSIVAMENTE properties\[\]\.finalidade/);
  assert.match(source, /Nunca infira a finalidade pelo título, preço ou status/);
});
