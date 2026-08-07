import assert from "node:assert/strict";
import test from "node:test";
process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";
const { injectPageMeta } = await import("../server/services/publicPageMeta");

const CASCA = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Criate</title></head><body><div id="root"></div></body></html>`;

test("prévia do link no WhatsApp sai com título, descrição e foto", () => {
  const html = injectPageMeta(CASCA, {
    titulo: "Imóvel em Setor Oeste",
    descricao: "Setor Oeste · R$ 330.000,00",
    imagemOg: "https://x/og.jpg", imagemHero: "https://x/hero.jpg",
    url: "https://imobiflow-v2.fly.dev/p/imovel-em-setor-oeste-mzj3",
  });
  for (const t of ['og:title', 'og:image', 'og:description', 'og:url', 'twitter:card']) {
    assert.ok(html.includes(t), `faltou ${t}`);
  }
  assert.ok(html.includes("<title>Imóvel em Setor Oeste</title>"));
  assert.equal((html.match(/<title>/g) || []).length, 1, "não pode sobrar o título genérico");
  assert.ok(html.includes('rel="preload" as="image"'), "a foto principal precisa começar a baixar com o HTML");
  assert.ok(html.includes('summary_large_image'));
});

test("preload aponta para a mesma URL que a página vai pedir (senão baixa duas vezes)", () => {
  const html = injectPageMeta(CASCA, {
    titulo: "T", descricao: "d",
    imagemOg: "https://x/render/a.jpg?width=1200&quality=75",
    imagemHero: "https://x/render/a.jpg?width=1600&quality=74",
    url: "https://x/p/y",
  });
  assert.ok(html.includes('rel="preload" as="image" href="https://x/render/a.jpg?width=1600&amp;quality=74"'));
  assert.ok(html.includes('og:image" content="https://x/render/a.jpg?width=1200&amp;quality=75"'));
});

test("imóvel sem foto ainda gera prévia válida, sem tag de imagem quebrada", () => {
  const html = injectPageMeta(CASCA, { titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "https://x/p/y" });
  assert.ok(html.includes("og:title"));
  assert.ok(!html.includes("og:image"));
  assert.ok(html.includes('name="twitter:card" content="summary"'));
});

test("aspas e sinais no título não quebram o HTML", () => {
  const html = injectPageMeta(CASCA, {
    titulo: 'Casa "do Zé" & cia <script>alert(1)</script>',
    descricao: 'desc "x" <b>', imagemOg: null, imagemHero: null, url: "https://x/p/y",
  });
  assert.ok(!html.includes("<script>alert(1)</script>"), "injeção de HTML no título");
  assert.ok(html.includes("&quot;") && html.includes("&amp;"));
});

test("o corpo da SPA continua intacto — a página não muda, só ganha cabeçalho", () => {
  const html = injectPageMeta(CASCA, { titulo: "A", descricao: "b", imagemOg: null, imagemHero: null, url: "https://x/p/y" });
  assert.ok(html.includes('<div id="root"></div>'));
  assert.ok(html.includes("</head>") && html.includes("</html>"));
});

// O preload só serve se o servidor e a página gerarem a MESMA URL. São dois
// arquivos diferentes (server/services/publicPageMeta.ts e src/lib/imageUrl.ts)
// e nada além deste teste impede que um mude sem o outro — aí a foto passa a
// ser baixada duas vezes, em silêncio.
const { imagemOtimizada } = await import("../src/lib/imageUrl");

test("servidor e página geram a MESMA URL de imagem otimizada", () => {
  const original = "https://umvbrahsqvqeondwtikm.supabase.co/storage/v1/object/public/property-images/a.jpg";
  const doServidor = original
    .replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + "?width=1600&quality=74";
  assert.equal(
    imagemOtimizada(original, 1600, 74),
    doServidor,
    "se divergirem, o preload vira download duplicado",
  );
});

test("URL que não é do Storage passa intacta", () => {
  assert.equal(imagemOtimizada("https://exemplo.com/foto.jpg", 800), "https://exemplo.com/foto.jpg");
  assert.equal(imagemOtimizada("", 800), "");
  assert.equal(imagemOtimizada(null, 800), "");
});

const { injectAboveFold } = await import("../server/services/publicPageMeta");

test("a foto e o título aparecem no HTML, antes de qualquer JavaScript", () => {
  const html = injectAboveFold(CASCA, {
    titulo: "Imóvel em Setor Oeste", descricao: "d",
    imagemOg: null, imagemHero: "https://x/hero.jpg", url: "https://x/p/y",
  });
  assert.ok(html.includes("Imóvel em Setor Oeste"), "título tem que estar no HTML cru");
  assert.ok(html.includes("https://x/hero.jpg"));
  assert.ok(html.includes('<div id="root">'), "o container do React precisa continuar existindo");
});

test("sem foto, o esqueleto não fica quebrado", () => {
  const html = injectAboveFold(CASCA, { titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "u" });
  assert.ok(html.includes("Casa"));
  assert.ok(!html.includes("url('')"), "não pode gerar background com URL vazia");
  assert.ok(html.includes("linear-gradient"));
});

test("título com aspas não escapa do atributo de estilo nem do HTML", () => {
  const html = injectAboveFold(CASCA, {
    titulo: '"><script>alert(1)</script>', descricao: "d", imagemOg: null, imagemHero: null, url: "u",
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
});
