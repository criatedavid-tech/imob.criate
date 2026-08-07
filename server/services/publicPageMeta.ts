import { supabase } from "../supabase";
import { PUBLIC_APP_URL } from "../config";
import { loadPublicProperty, serializeForScript } from "./publicProperty";

// ─────────────────────────────────────────────────────────────────────────
// Prévia do link e primeira pintura da vitrine.
//
// Dois problemas que este módulo resolve, e que tinham a MESMA causa: o HTML
// entregue em /p/:slug era uma casca de 457 bytes com `<title>Criate</title>`
// e nada mais.
//
// 1. O produto é distribuído por WhatsApp, e todo link de imóvel compartilhado
//    aparecia como "Criate", sem foto e sem descrição. O robô do WhatsApp (e do
//    Facebook, Telegram, LinkedIn) lê o HTML CRU: ele não executa JavaScript,
//    então nada que a SPA renderiza depois existe para ele.
//
// 2. A foto principal só era descoberta pelo navegador depois de baixar o JS,
//    montar o React e esperar a API responder. Com o `preload` no HTML, ela
//    começa a baixar no primeiro byte, em paralelo com o resto.
//
// O custo é uma consulta por visita — resolvido com cache curto em memória,
// já que a mesma vitrine costuma ser aberta em rajada (link no grupo).
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

export interface PublicPageMeta {
  titulo: string;
  descricao: string;
  /** Versão para o card do WhatsApp/Facebook (1200px). */
  imagemOg: string | null;
  /**
   * Versão que a PÁGINA vai pedir (1600px). Precisa ser byte a byte a mesma
   * URL que PropertyLanding monta com `imagemOtimizada(hero, 1600, 74)` —
   * um preload com URL diferente faz o navegador baixar a foto DUAS vezes.
   */
  imagemHero: string | null;
  url: string;
  /** O imóvel inteiro, para a página não precisar chamar a API. */
  imovel: Record<string, any> | null;
}

interface CacheSlot {
  at: number;
  meta: PublicPageMeta | null;
}

const cache = new Map<string, CacheSlot>();

/** Escapa para interpolar dentro de um atributo HTML com aspas duplas. */
function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstImage(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const parsed = JSON.parse(imageUrl);
    if (Array.isArray(parsed) && parsed.length) return String(parsed[0]);
  } catch {
    // Campo pode ser uma URL única em texto puro.
  }
  const raw = String(imageUrl).trim();
  return raw.startsWith("http") ? raw : null;
}

/**
 * Redimensiona pelo CDN do Storage. Mesma regra de src/lib/imageUrl.ts — os
 * dois precisam gerar a URL IDÊNTICA para o preload valer.
 */
function redimensionar(url: string | null, largura: number, qualidade: number): string | null {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  return `${base}${base.includes("?") ? "&" : "?"}width=${largura}&quality=${qualidade}`;
}

function buildDescription(row: any): string {
  const partes: string[] = [];
  if (row.location) partes.push(String(row.location).replace(/refer[êe]ncia.*/i, "").trim());
  if (row.price) partes.push(String(row.price));

  // O texto humano vem antes do bloco técnico ---DETALHES-GERADOS---.
  const texto = String(row.description || "").split("---DETALHES-GERADOS---")[0];
  const limpo = texto.replace(/[*#_`>]/g, "").replace(/\s+/g, " ").trim();
  if (limpo) partes.push(limpo.slice(0, 150) + (limpo.length > 150 ? "…" : ""));

  return partes.filter(Boolean).join(" · ").slice(0, 300) || "Confira este imóvel.";
}

async function fetchPropertyMeta(slug: string): Promise<PublicPageMeta | null> {
  const { encontrado, imovel } = await loadPublicProperty(slug);
  if (!encontrado || !imovel) return null;
  const data = imovel;
  const primeira = (data.images && data.images[0]) || null;

  return {
    titulo: String(data.title || "Imóvel").trim(),
    descricao: buildDescription(data),
    // 1200/75 para o card da prévia; 1600/74 é o que a página pede (o robô do
    // WhatsApp baixa a og antes de mostrar o card, então ela vai menor).
    imagemOg: redimensionar(primeira, 1200, 75),
    imagemHero: redimensionar(primeira, 1600, 74),
    url: `${PUBLIC_APP_URL.replace(/\/$/, "")}/p/${slug}`,
    imovel: data,
  };
}

export async function getPropertyPageMeta(slug: string): Promise<PublicPageMeta | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;

  let meta: PublicPageMeta | null = null;
  try {
    meta = await fetchPropertyMeta(slug);
  } catch {
    // Falha de banco não pode derrubar a página: devolve a casca de sempre.
    return null;
  }

  if (cache.size >= MAX_ENTRIES) {
    const maisAntigo = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (maisAntigo) cache.delete(maisAntigo[0]);
  }
  cache.set(slug, { at: Date.now(), meta });
  return meta;
}

/**
 * Injeta as tags no `<head>` do HTML da SPA. Só ACRESCENTA — se algo aqui
 * falhar, a página continua sendo exatamente a de antes.
 */
export function injectPageMeta(html: string, meta: PublicPageMeta): string {
  const titulo = escapeAttr(meta.titulo);
  const descricao = escapeAttr(meta.descricao);
  const url = escapeAttr(meta.url);

  const tags = [
    `<title>${titulo}</title>`,
    `<meta name="description" content="${descricao}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ImobiFlow" />`,
    `<meta property="og:title" content="${titulo}" />`,
    `<meta property="og:description" content="${descricao}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="${meta.imagemOg ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${titulo}" />`,
    `<meta name="twitter:description" content="${descricao}" />`,
  ];

  if (meta.imagemOg) {
    const og = escapeAttr(meta.imagemOg);
    tags.push(
      `<meta property="og:image" content="${og}" />`,
      `<meta property="og:image:alt" content="${titulo}" />`,
      `<meta name="twitter:image" content="${og}" />`,
    );
    try {
      tags.push(`<link rel="preconnect" href="${escapeAttr(new URL(meta.imagemOg).origin)}" crossorigin />`);
    } catch {
      // URL inválida: só não pré-conecta.
    }
  }

  if (meta.imagemHero) {
    // A foto principal começa a baixar junto com o HTML, em vez de esperar o
    // JS montar e a API responder. URL igual à que a página pede.
    tags.push(`<link rel="preload" as="image" href="${escapeAttr(meta.imagemHero)}" fetchpriority="high" />`);
  }

  // Substitui o <title> genérico da casca para não sobrarem dois.
  const semTitulo = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  return semTitulo.replace(/<\/head>/i, `${tags.join("\n    ")}\n  </head>`);
}

/**
 * Primeira pintura sem esperar o JavaScript.
 *
 * A vitrine é renderizada no cliente: até o JS baixar, montar o React e a API
 * responder, o visitante vê tela em branco. Isto coloca a foto e o título
 * dentro do `#root` já no HTML.
 *
 * É seguro porque o app usa `createRoot(...).render(...)` (src/main.tsx), e não
 * `hydrateRoot`: ao montar, o React SUBSTITUI o conteúdo do container. Não há
 * hidratação, logo não há divergência possível entre servidor e cliente. Se o
 * React demorar ou falhar, o visitante ao menos vê o imóvel.
 *
 * Só o que aparece acima da dobra, com estilo embutido — não depende do CSS
 * do app, que carrega depois.
 */
export function injectAboveFold(html: string, meta: PublicPageMeta): string {
  const titulo = escapeAttr(meta.titulo);
  const fundo = meta.imagemHero
    ? `background-image:linear-gradient(180deg,rgba(15,17,19,.42),rgba(15,17,19,.05) 34%,rgba(15,17,19,.8)),url('${escapeAttr(meta.imagemHero)}');background-size:cover;background-position:center`
    : "background:linear-gradient(135deg,#2b534e,#131518)";

  const esqueleto =
    `<div style="position:absolute;inset:0;${fundo}"></div>` +
    `<div style="position:absolute;left:0;right:0;bottom:0;padding:0 clamp(20px,5vw,64px) clamp(40px,7vh,90px);color:#fff">` +
    `<h1 style="margin:0;font-family:Cormorant Garamond,Georgia,serif;font-weight:300;line-height:1.02;` +
    `font-size:clamp(38px,7vw,104px);text-shadow:0 2px 24px rgba(0,0,0,.35)">${titulo}</h1>` +
    `</div>`;

  // O imóvel viaja no próprio HTML: a página monta sem chamar a API. Tira uma
  // ida à rede do caminho, e tira a vitrine de baixo do limitador por IP —
  // que é o que apareceu como único ponto de saturação no teste de carga.
  const dados = meta.imovel
    ? `<script>window.__IMOVEL__=${serializeForScript(meta.imovel)}</script>`
    : "";

  return html.replace(
    '<div id="root"></div>',
    `<div id="root"><div style="position:relative;height:100svh;min-height:600px;overflow:hidden;background:#131518">${esqueleto}</div></div>${dados}`,
  );
}
