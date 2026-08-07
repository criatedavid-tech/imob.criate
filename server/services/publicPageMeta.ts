import { supabase } from "../supabase";
import { PUBLIC_APP_URL } from "../config";

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
  imagem: string | null;
  url: string;
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
  const { data } = await supabase
    .from("imf_properties")
    .select("title, price, location, description, image_url, slug, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;

  return {
    titulo: String(data.title || "Imóvel").trim(),
    descricao: buildDescription(data),
    imagem: firstImage(data.image_url),
    url: `${PUBLIC_APP_URL.replace(/\/$/, "")}/p/${slug}`,
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
    `<meta name="twitter:card" content="${meta.imagem ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${titulo}" />`,
    `<meta name="twitter:description" content="${descricao}" />`,
  ];

  if (meta.imagem) {
    const img = escapeAttr(meta.imagem);
    tags.push(
      `<meta property="og:image" content="${img}" />`,
      `<meta property="og:image:alt" content="${titulo}" />`,
      `<meta name="twitter:image" content="${img}" />`,
      // A foto principal começa a baixar junto com o HTML, em vez de esperar
      // o JS montar e a API responder.
      `<link rel="preload" as="image" href="${img}" fetchpriority="high" />`,
    );
    try {
      tags.push(`<link rel="preconnect" href="${escapeAttr(new URL(meta.imagem).origin)}" crossorigin />`);
    } catch {
      // URL inválida: só não pré-conecta.
    }
  }

  // Substitui o <title> genérico da casca para não sobrarem dois.
  const semTitulo = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  return semTitulo.replace(/<\/head>/i, `${tags.join("\n    ")}\n  </head>`);
}
