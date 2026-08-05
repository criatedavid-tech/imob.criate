import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePriceToCents,
  buildCatalogEntry,
  flagDuplicateDescriptions,
  searchCatalog,
  toAgentProperty,
  summarizeCatalog,
  normalizeText,
  type RawProperty,
} from "../server/services/propertyCatalogCore";

// ─────────────────────────────────────────────────────────────────────────
// Banco de avaliação: os imóveis abaixo são os REAIS do corretor de teste,
// copiados da execução 1099335 do fluxo n8n. São eles que produziram os erros
// que estamos corrigindo — por isso viram teste de regressão, não exemplo
// inventado.
// ─────────────────────────────────────────────────────────────────────────

const DESC_GENERICA = `**Residência Moderna com Excelente Acabamento**

Apresentamos esta belíssima residência, ideal para quem busca conforto, praticidade e qualidade de vida. O imóvel conta com um projeto moderno, ambientes amplos e bem iluminados, proporcionando uma atmosfera aconchegante para toda a família.

A casa dispõe de sala de estar integrada à sala de jantar, cozinha funcional, dormitórios espaçosos, banheiros com ótimo acabamento e uma área externa perfeita para momentos de lazer e convivência.`;

const IMAGENS = JSON.stringify([
  "https://umvbrahsqvqeondwtikm.supabase.co/storage/v1/object/public/property-images/a.jpg",
  "https://umvbrahsqvqeondwtikm.supabase.co/storage/v1/object/public/property-images/b.jpg",
]);

const CATALOGO_REAL: RawProperty[] = [
  {
    id: "173bf951-8b82-46c1-a605-92a2f08812e6",
    title: "Imóvel em condomínio do lago",
    price: "R$ 4.000.000,00",
    location: "condomínio do lago",
    description: `Linda casa em condomínio fechado, com 400 metros quadrados de área construída, piscina e muito espaço para lazer e conforto. Ideal para quem busca qualidade de vida e segurança.\n\n---DETALHES-GERADOS---\n{"tipo_imovel":"residencial","finalidade":"venda","quartos":0,"sala":1,"cozinha":1,"piscina":"Sim","banheiros":0,"area":400,"varanda_gourmet":"Não","vagas_garagem":0,"tipo_comercial":"Sala comercial"}`,
    image_url: IMAGENS, slug: "imovel-em-condominio-do-lago-opjx",
    link: "https://imobiflow-v2.fly.dev/p/imovel-em-condominio-do-lago-opjx", status: "disponivel",
  },
  {
    id: "b62ec979-0a61-4226-9acc-d3797e820563",
    title: "ap centro",
    price: "R$ 350.000,00",
    location: "goiania centro ",
    description: `${DESC_GENERICA}\n\n---DETALHES-GERADOS---\n{"quartos":5,"sala":2,"cozinha":1,"piscina":"Sim","banheiros":5,"area":150,"varanda_gourmet":"Sim"}`,
    image_url: IMAGENS, slug: "ap-centro-5z2a",
    link: "https://imobiflow-v2.fly.dev/p/ap-centro-5z2a", status: "disponivel",
  },
  {
    id: "52ea8f8a-c4a7-4d9d-8564-e31ac5c8ea51",
    title: "Imóvel em Setor Oeste",
    price: "R$ 330.000,00",
    location: "Setor Oeste",
    description: `${DESC_GENERICA}\n\n---DETALHES-GERADOS---\n{"tipo_imovel":"residencial","finalidade":"venda","quartos":3,"sala":1,"cozinha":1,"piscina":"Não","banheiros":1,"area":70,"varanda_gourmet":"Sim","vagas_garagem":0,"tipo_comercial":"Sala comercial"}`,
    image_url: IMAGENS, slug: "imovel-em-setor-oeste-mzj3",
    link: "https://imobiflow-v2.fly.dev/p/imovel-em-setor-oeste-mzj3", status: "disponivel",
  },
  {
    id: "c62b40fc-fce1-442b-9cb1-608c26dad7c1",
    title: "Imóvel em Portal do Sol",
    price: "R$ 3.190.000,00",
    location: "Portal do Sol",
    description: `casa\n\n---DETALHES-GERADOS---\n{"tipo_imovel":"residencial","finalidade":"venda","quartos":4,"sala":1,"cozinha":1,"piscina":"Sim","banheiros":4,"area":0,"varanda_gourmet":"Sim","vagas_garagem":2,"tipo_comercial":"Sala comercial"}`,
    image_url: IMAGENS, slug: "imovel-em-portal-do-sol-68be",
    link: "https://imobiflow-v2.fly.dev/p/imovel-em-portal-do-sol-68be", status: "disponivel",
  },
  {
    id: "62c05b77-d57c-4cbb-a515-9dcaf09c88c6",
    title: "Apartamento em Pinheiros",
    price: "R$ 6.000.000,00",
    location: "Pioneiros – Balneário Camboriú Referência: D - SC - 88331115",
    description: `Imóvel mobiliado com varanda gourmet, churrasqueira, vista panorâmica, mezanino, closet e acabamentos em porcelanato e gesso.\nO condomínio oferece estrutura completa de lazer e segurança, incluindo piscina com borda infinita, academia, salão de festas, brinquedoteca, portaria e entrada para banhistas com box de praia.\n\n---DETALHES-GERADOS---\n{"tipo_imovel":"residencial","finalidade":"venda","quartos":3,"sala":1,"cozinha":1,"piscina":"Não","banheiros":4,"area":270,"varanda_gourmet":"Sim","vagas_garagem":0,"tipo_comercial":"Sala comercial"}`,
    image_url: IMAGENS, slug: "apartamento-em-pinheiros-r3ee",
    link: "https://imobiflow-v2.fly.dev/p/apartamento-em-pinheiros-r3ee", status: "disponivel",
  },
];

function catalogo() {
  const entries = CATALOGO_REAL.map(buildCatalogEntry);
  flagDuplicateDescriptions(entries);
  return entries;
}

const porId = (id: string) => catalogo().find((e) => e.id === id)!;

// ─── Preço ──────────────────────────────────────────────────────────────────

test("preço em texto livre vira centavos sem confundir milhar com centavo", () => {
  assert.equal(parsePriceToCents("R$ 350.000,00"), 35_000_000);
  // Sem vírgula, o número é inteiro em reais — se lesse como centavos, um
  // imóvel de 350 mil viraria R$ 3.500 e a IA ofereceria errado.
  assert.equal(parsePriceToCents("R$ 350.000"), 35_000_000);
  assert.equal(parsePriceToCents("350000"), 35_000_000);
  assert.equal(parsePriceToCents("R$ 1.200,50"), 120_050);
  assert.equal(parsePriceToCents("R$ 1.200,5"), 120_050);
  assert.equal(parsePriceToCents("R$ 6.000.000,00"), 600_000_000);
  assert.equal(parsePriceToCents("Sob consulta"), null);
  assert.equal(parsePriceToCents(""), null);
  assert.equal(parsePriceToCents(null), null);
  assert.equal(parsePriceToCents("R$ 0,00"), null);
});

// ─── Dado podre não vira afirmação ──────────────────────────────────────────

test("casa de R$4mi com quartos:0 não afirma quartos ao cliente", () => {
  const e = porId("173bf951-8b82-46c1-a605-92a2f08812e6");
  assert.equal(e.quartos, null);
  assert.ok(e.camposIncertos.includes("quartos"));
  assert.ok(e.problemas.some((p) => p.campo === "quartos" && p.gravidade === "alta"));
  const payload = toAgentProperty({ entry: e, naoBate: [], naoVerificavel: [], score: 0 });
  assert.equal(payload.quartos, undefined, "campo suspeito não pode ir como valor");
  assert.deepEqual(payload.dados_incertos, e.camposIncertos);
});

test('"ap centro" tem título de apartamento e texto de casa — o tipo fica marcado como incerto', () => {
  const e = porId("b62ec979-0a61-4226-9acc-d3797e820563");
  assert.equal(e.tipoConfiavel, false);
  assert.ok(e.camposIncertos.includes("tipo"));
  const payload = toAgentProperty({ entry: e, naoBate: [], naoVerificavel: [], score: 0 });
  assert.equal(payload.tipo, undefined, "não pode afirmar que é apartamento nem que é casa");
});

test("descrição genérica repetida em dois imóveis é denunciada nos dois", () => {
  const entries = catalogo();
  const comProblema = entries.filter((e) =>
    e.problemas.some((p) => p.campo === "descricao" && /idêntica|genérico/.test(p.problema)),
  );
  assert.ok(comProblema.length >= 2, "ap centro e Setor Oeste compartilham o mesmo texto");
});

test("descrição de uma palavra e imóvel sem área são sinalizados", () => {
  const e = porId("c62b40fc-fce1-442b-9cb1-608c26dad7c1"); // description = "casa"
  assert.ok(e.problemas.some((p) => p.campo === "descricao"));
  assert.equal(e.areaM2, null);
  assert.ok(e.camposIncertos.includes("area"));
});

test("código de referência interno na localização é sinalizado", () => {
  const e = porId("62c05b77-d57c-4cbb-a515-9dcaf09c88c6");
  assert.ok(e.problemas.some((p) => p.campo === "location"));
});

test("diferencial só entra quando o cadastro confirma — campo 'Não' vence o texto", () => {
  // O texto fala em "piscina com borda infinita" (é do condomínio), mas o
  // campo estruturado diz "Não". Afirmar piscina aqui seria vender o que não é.
  const e = porId("62c05b77-d57c-4cbb-a515-9dcaf09c88c6");
  assert.ok(!e.destaques.includes("piscina"), `destaques: ${e.destaques.join(", ")}`);
  assert.ok(e.destaques.includes("varanda gourmet"));
});

// ─── Busca ──────────────────────────────────────────────────────────────────

test("região sem nenhum imóvel devolve honestidade, não um imóvel qualquer", () => {
  // Caso real: cliente pediu casa perto da Avenida Santo Amaro e a IA ofereceu
  // um apartamento de R$ 6 milhões em Balneário Camboriú.
  const r = searchCatalog(catalogo(), { regiao: "avenida santo amaro", tipo: "casa" });
  assert.equal(r.encontrouExatos, false);
  assert.ok(r.gargalos.includes("região"), `gargalos: ${r.gargalos.join(", ")}`);
  for (const hit of r.resultados) {
    assert.ok(hit.naoBate.includes("região"), "todo resultado precisa avisar que a região não bate");
  }
});

test("região casa por token, ignorando 'setor'/'avenida' e acento", () => {
  const centro = searchCatalog(catalogo(), { regiao: "centro de Goiânia" });
  assert.equal(centro.encontrouExatos, true);
  assert.equal(centro.resultados[0].entry.id, "b62ec979-0a61-4226-9acc-d3797e820563");

  const oeste = searchCatalog(catalogo(), { regiao: "Setor Oeste" });
  assert.equal(oeste.resultados[0].entry.id, "52ea8f8a-c4a7-4d9d-8564-e31ac5c8ea51");

  // "setor" é palavra vazia: não pode fazer Setor Oeste casar com qualquer setor.
  assert.equal(normalizeText("Setor Oeste"), "setor oeste");
});

test("faixa de preço filtra de verdade e o que não bate é declarado", () => {
  const r = searchCatalog(catalogo(), { precoMaxCents: 40_000_000, finalidade: "venda" });
  assert.equal(r.encontrouExatos, true);
  for (const hit of r.resultados) {
    assert.ok(hit.entry.precoCents !== null && hit.entry.precoCents <= 40_000_000);
  }
  const caro = searchCatalog(catalogo(), { precoMaxCents: 10_000_000 });
  assert.equal(caro.encontrouExatos, false);
  assert.ok(caro.gargalos.includes("faixa de preço"));
});

test("critério que não dá para verificar não é tratado como se batesse", () => {
  // Pedir 3 quartos: o imóvel do lago tem quartos:0 (desconhecido) — ele não
  // pode entrar como match exato fingindo atender.
  const r = searchCatalog(catalogo(), { quartosMin: 3 });
  const lago = r.resultados.find((h) => h.entry.id === "173bf951-8b82-46c1-a605-92a2f08812e6");
  if (lago) assert.ok(lago.naoVerificavel.includes("número de quartos"));
  for (const hit of r.resultados) {
    if (hit.naoBate.length === 0 && !hit.naoVerificavel.includes("número de quartos")) {
      assert.ok((hit.entry.quartos ?? 0) >= 3);
    }
  }
});

// ─── Payload ────────────────────────────────────────────────────────────────

test("payload do agente não carrega URL de imagem nem metadado de banco", () => {
  const r = searchCatalog(catalogo(), {});
  const json = JSON.stringify(r.resultados.map(toAgentProperty));
  assert.ok(!json.includes("supabase.co/storage"), "URLs de imagem eram a maior parte dos tokens");
  assert.ok(!json.includes("owner_user_id"));
  assert.ok(!json.includes("created_at"));
  assert.ok(!json.includes("broker_id"));
  assert.ok(!json.includes("DETALHES-GERADOS"));
});

test("o catálogo inteiro do agente cabe numa fração do que era enviado antes", () => {
  const entries = catalogo();
  const antes = JSON.stringify(CATALOGO_REAL).length;
  const agora = JSON.stringify({
    resumo: summarizeCatalog(entries),
    imoveis: searchCatalog(entries, { limite: 3 }).resultados.map(toAgentProperty),
  }).length;
  assert.ok(agora < antes / 2, `antes ${antes} chars, agora ${agora} chars`);
});

test("panorama do catálogo informa faixa, regiões e quantos estão incompletos", () => {
  const resumo = summarizeCatalog(catalogo()) as any;
  assert.equal(resumo.total, 5);
  assert.equal(resumo.faixa_de_preco.min, "R$ 330.000,00");
  assert.equal(resumo.faixa_de_preco.max, "R$ 6.000.000,00");
  assert.ok(resumo.regioes.length >= 4);
  assert.ok(resumo.com_cadastro_incompleto >= 3, "hoje quase todo o catálogo tem buraco");
});

test("catálogo vazio não quebra a busca", () => {
  const r = searchCatalog([], { regiao: "centro" });
  assert.equal(r.totalNoCatalogo, 0);
  assert.equal(r.encontrouExatos, false);
  assert.deepEqual(r.resultados, []);
  assert.deepEqual(r.gargalos, []);
  assert.deepEqual(summarizeCatalog([]), { total: 0 });
});
