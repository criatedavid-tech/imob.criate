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
    imagem: "https://umvbrahsqvqeondwtikm.supabase.co/storage/v1/object/public/a.jpg",
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

test("imóvel sem foto ainda gera prévia válida, sem tag de imagem quebrada", () => {
  const html = injectPageMeta(CASCA, { titulo: "Casa", descricao: "d", imagem: null, url: "https://x/p/y" });
  assert.ok(html.includes("og:title"));
  assert.ok(!html.includes("og:image"));
  assert.ok(html.includes('name="twitter:card" content="summary"'));
});

test("aspas e sinais no título não quebram o HTML", () => {
  const html = injectPageMeta(CASCA, {
    titulo: 'Casa "do Zé" & cia <script>alert(1)</script>',
    descricao: 'desc "x" <b>', imagem: null, url: "https://x/p/y",
  });
  assert.ok(!html.includes("<script>alert(1)</script>"), "injeção de HTML no título");
  assert.ok(html.includes("&quot;") && html.includes("&amp;"));
});

test("o corpo da SPA continua intacto — a página não muda, só ganha cabeçalho", () => {
  const html = injectPageMeta(CASCA, { titulo: "A", descricao: "b", imagem: null, url: "https://x/p/y" });
  assert.ok(html.includes('<div id="root"></div>'));
  assert.ok(html.includes("</head>") && html.includes("</html>"));
});
