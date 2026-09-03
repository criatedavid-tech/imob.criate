import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";
const { injectPageMeta } = await import("../server/services/publicPageMeta");
const { injectPublicAboutPage } = await import("../server/services/publicAboutPage");
const { injectPublicPrivacyPage } = await import("../server/services/publicPrivacyPage");
const {
  extractEntryModulePath,
  isStaleAssetError,
  shouldAttemptStaleAssetRecovery,
} = await import("../src/lib/appRecovery");

const CASCA = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Criate</title></head><body><div id="root"></div></body></html>`;

test("página pública explica o ImobiFlow e o uso do Google Agenda sem depender de JavaScript", () => {
  const html = injectPublicAboutPage(CASCA);
  assert.match(html, /<strong>ImobiFlow<\/strong>/);
  assert.match(html, /plataforma imobiliária com inteligência artificial/i);
  assert.match(html, /Google Agenda/);
  assert.match(html, /somente os eventos dessa\s+agenda criada pelo próprio aplicativo/i);
  assert.match(html, /href="\/privacidade"/);
  assert.match(html, /href="\/termos"/);
  assert.ok(html.includes('<div id="root">'), "o React precisa conservar seu container");
});

test("página de privacidade detalha coleta e uso de dados sem depender de JavaScript", () => {
  const html = injectPublicPrivacyPage(CASCA);
  assert.match(html, /Política de Privacidade/);
  assert.match(html, /Criate Tecnologia em Marketing e Vendas LTDA/);
  assert.match(html, /54\.236\.008\/0001-80/);
  assert.match(html, /criateoficial@gmail\.com/);
  // Foco do que o Google verifica: coleta de dados (geral) e o uso
  // específico da Google Calendar API sob a Limited Use policy.
  assert.match(html, /Quais dados coletamos/);
  assert.match(html, /calendar\.app\.created/);
  assert.match(html, /Google API Services User Data Policy/);
  assert.match(html, /Limited Use/);
  assert.match(html, /não solicita acesso à agenda principal|não concede acesso à agenda principal/);
  assert.match(html, /Direitos do titular/);
  assert.ok(html.includes('<div id="root">'), "o React precisa conservar seu container");
});

test("prévia do link no WhatsApp sai com título, descrição e foto", () => {
  const html = injectPageMeta(CASCA, {
    titulo: "Imóvel em Setor Oeste",
    descricao: "Setor Oeste · R$ 330.000,00",
    imagemOg: "https://x/og.jpg", imagemHero: "https://x/hero.jpg",
    url: "https://imobiflow-v2.fly.dev/p/imovel-em-setor-oeste-mzj3", imovel: null,
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
    url: "https://x/p/y", imovel: null,
  });
  assert.ok(html.includes('rel="preload" as="image" href="https://x/render/a.jpg?width=1600&amp;quality=74"'));
  assert.ok(html.includes('og:image" content="https://x/render/a.jpg?width=1200&amp;quality=75"'));
});

test("imóvel sem foto ainda gera prévia válida, sem tag de imagem quebrada", () => {
  const html = injectPageMeta(CASCA, { titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "https://x/p/y", imovel: null });
  assert.ok(html.includes("og:title"));
  assert.ok(!html.includes("og:image"));
  assert.ok(html.includes('name="twitter:card" content="summary"'));
});

test("aspas e sinais no título não quebram o HTML", () => {
  const html = injectPageMeta(CASCA, {
    titulo: 'Casa "do Zé" & cia <script>alert(1)</script>',
    descricao: 'desc "x" <b>', imagemOg: null, imagemHero: null, url: "https://x/p/y", imovel: null,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"), "injeção de HTML no título");
  assert.ok(html.includes("&quot;") && html.includes("&amp;"));
});

test("o corpo da SPA continua intacto — a página não muda, só ganha cabeçalho", () => {
  const html = injectPageMeta(CASCA, { titulo: "A", descricao: "b", imagemOg: null, imagemHero: null, url: "https://x/p/y", imovel: null });
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
    imagemOg: null, imagemHero: "https://x/hero.jpg", url: "https://x/p/y", imovel: null,
  });
  assert.ok(html.includes("Imóvel em Setor Oeste"), "título tem que estar no HTML cru");
  assert.ok(html.includes("https://x/hero.jpg"));
  assert.ok(html.includes('<div id="root">'), "o container do React precisa continuar existindo");
});

test("sem foto, o esqueleto não fica quebrado", () => {
  const html = injectAboveFold(CASCA, { titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "u", imovel: null });
  assert.ok(html.includes("Casa"));
  assert.ok(!html.includes("url('')"), "não pode gerar background com URL vazia");
  assert.ok(html.includes("linear-gradient"));
});

test("título com aspas não escapa do atributo de estilo nem do HTML", () => {
  const html = injectAboveFold(CASCA, {
    titulo: '"><script>alert(1)</script>', descricao: "d", imagemOg: null, imagemHero: null, url: "u", imovel: null,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

// Regressão real: eu cachei o HTML da vitrine por 60s. O HTML referencia
// assets com hash no nome, e o deploy seguinte apaga os antigos — quem tinha o
// HTML velho no cache pedia um .js inexistente, recebia HTML de volta e via
// TELA BRANCA. O comentário no próprio server.ts já avisava disso.
const fonteDoServidor = await readFile(new URL("../server.ts", import.meta.url), "utf8");

test("rota pública enriquecida vem antes do fallback genérico da SPA", () => {
  const rotaSobre = fonteDoServidor.indexOf('app.get("/sobre"');
  const fallbackSpa = fonteDoServidor.indexOf('app.get("*"');
  assert.ok(rotaSobre > 0);
  assert.ok(rotaSobre < fallbackSpa);
});

test("o HTML da vitrine nunca pode ser cacheado pelo navegador", () => {
  const rota = fonteDoServidor.slice(
    fonteDoServidor.indexOf('app.get("/p/:slug"'),
    fonteDoServidor.indexOf('app.get("*"'),
  );
  assert.ok(rota.length > 0, "rota /p/:slug não encontrada");
  assert.ok(
    /Cache-Control", "no-cache"/.test(rota),
    "HTML da SPA cacheado = tela branca no deploy seguinte",
  );
  assert.ok(
    !/max-age=[1-9]/.test(rota),
    "nenhum max-age positivo no HTML da vitrine",
  );
});

test("asset removido depois do deploy nunca recebe o HTML da SPA", () => {
  const asset404 = fonteDoServidor.indexOf('app.use("/assets"');
  const spaFallback = fonteDoServidor.indexOf('app.get("*"');
  assert.ok(asset404 > 0, "faltou o 404 dedicado de assets");
  assert.ok(asset404 < spaFallback, "o 404 de assets precisa vir antes do fallback da SPA");
  assert.match(fonteDoServidor.slice(asset404, spaFallback), /status\(404\)/);
  assert.match(fonteDoServidor.slice(asset404, spaFallback), /Cache-Control", "no-store"/);
});

test("cliente reconhece versão antiga e evita loop de recarga", () => {
  assert.equal(isStaleAssetError(new Error("Failed to fetch dynamically imported module: /assets/Agenda-old.js")), true);
  assert.equal(isStaleAssetError(new Error("erro comum de formulário")), false);
  assert.equal(shouldAttemptStaleAssetRecovery("ChunkLoadError", 0, 100_000), true);
  assert.equal(shouldAttemptStaleAssetRecovery("ChunkLoadError", 80_000, 100_000), false);
  assert.equal(shouldAttemptStaleAssetRecovery("ChunkLoadError", 20_000, 100_000), true);
});

test("comparador encontra o entrypoint com hash no HTML novo", () => {
  assert.equal(
    extractEntryModulePath('<script type="module" crossorigin src="/assets/index-abc123.js"></script>'),
    "/assets/index-abc123.js",
  );
  assert.equal(extractEntryModulePath('<script src="/legacy.js"></script>'), null);
});

// ─── Dado embutido no HTML ──────────────────────────────────────────────────
const { serializeForScript } = await import("../server/services/publicProperty");

test("descrição com </script> não escapa da tag e vira HTML executável", () => {
  // A descrição é digitada pelo corretor — é entrada de usuário.
  const veneno = { description: 'Casa </script><script>alert("xss")</script> boa' };
  const saida = serializeForScript(veneno);
  assert.ok(!saida.includes("</script>"), "fecharia a tag e executaria o resto");
  assert.ok(saida.includes("\\u003c"));
  // E o valor sobrevive intacto ao voltar.
  assert.equal(JSON.parse(saida.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">")).description, veneno.description);
});

test("o imóvel viaja no HTML, para a página não precisar chamar a API", () => {
  const html = injectAboveFold(CASCA, {
    titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "u",
    imovel: { slug: "casa-x", title: "Casa", images: ["https://x/a.jpg"] },
  });
  assert.ok(html.includes("window.__IMOVEL__="));
  assert.ok(html.includes('"slug":"casa-x"'));
  assert.ok(html.includes('<div id="root">'), "o container do React continua lá");
});

test("sem imóvel carregado, nenhum script vazio é injetado", () => {
  const html = injectAboveFold(CASCA, {
    titulo: "Casa", descricao: "d", imagemOg: null, imagemHero: null, url: "u", imovel: null,
  });
  assert.ok(!html.includes("window.__IMOVEL__"));
});
