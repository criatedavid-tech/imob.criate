// ─────────────────────────────────────────────────────────────────────────
// Imagem no tamanho em que ela vai aparecer, não no tamanho em que foi tirada.
//
// As fotos vão para o Storage do Supabase do jeito que o corretor enviou. A
// vitrine de um imóvel somava 761 KB em 10 fotos — a maior com 155 KB — para
// aparecer numa galeria de miniaturas. O Storage tem transformação sob demanda
// (`/render/image/public/...`), que redimensiona e recomprime no CDN.
//
// A transformação é uma OTIMIZAÇÃO, nunca um requisito: se a URL não for do
// Storage, ou se a transformação falhar, volta-se para o original (ver o
// `onError` em quem usa). Nenhuma imagem pode sumir por causa disto.
// ─────────────────────────────────────────────────────────────────────────

const CAMINHO_PUBLICO = "/storage/v1/object/public/";
const CAMINHO_TRANSFORMADO = "/storage/v1/render/image/public/";

/**
 * Devolve a URL da imagem já redimensionada. `largura` deve ser o maior
 * tamanho em que a imagem realmente aparece na tela (considerando telas 2x).
 */
export function imagemOtimizada(
  url: string | null | undefined,
  largura: number,
  qualidade = 72,
): string {
  const original = String(url ?? "");
  if (!original || !original.includes(CAMINHO_PUBLICO)) return original;
  const base = original.replace(CAMINHO_PUBLICO, CAMINHO_TRANSFORMADO);
  const separador = base.includes("?") ? "&" : "?";
  return `${base}${separador}width=${Math.round(largura)}&quality=${qualidade}`;
}

/**
 * Handler de erro: se a versão transformada falhar (CDN fora, formato não
 * suportado, plano sem a função), troca pela original UMA vez. O marcador
 * evita laço infinito quando a original também falha.
 */
export function voltarParaOriginal(
  evento: { currentTarget: HTMLImageElement },
  original: string,
): void {
  const img = evento.currentTarget;
  if (img.dataset.fallback === "1") return;
  img.dataset.fallback = "1";
  if (original && img.src !== original) img.src = original;
}
