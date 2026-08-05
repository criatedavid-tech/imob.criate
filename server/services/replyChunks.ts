// ─────────────────────────────────────────────────────────────────────────
// Quebra a resposta da IA em balões, como uma pessoa escreve no WhatsApp.
//
// Hoje sai um bloco só, com parágrafos e linha em branco — que na tela do
// celular vira um "textão" e denuncia o robô na hora. Gente manda a reação,
// depois a informação, depois a pergunta.
//
// Puro de propósito: dá para testar sem WhatsApp, sem rede e sem IA.
// ─────────────────────────────────────────────────────────────────────────

const MIN_CHUNK_CHARS = 25;
const SINGLE_BUBBLE_UNTIL = 180;

/** Limpa vícios que o modelo insiste em produzir mesmo com o prompt pedindo o contrário. */
export function sanitizeReply(text: string): string {
  let out = String(text ?? "")
    .replace(/^=+/, "")           // artefato de expressão do n8n
    .replace(/\r\n/g, "\n")
    .trim();
  // Resposta inteira entre aspas: o cliente vê as aspas e parece citação.
  if (out.length > 1 && /^["“'](.|\n)*["”']$/.test(out)) {
    out = out.slice(1, -1).trim();
  }
  return out
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Divide por parágrafo, junta fragmentos curtos demais para virar balão e
 * respeita um teto de balões — o excedente vai colado no último, em vez de
 * disparar seis mensagens seguidas no celular de alguém.
 */
export function splitReplyIntoBubbles(text: string, maxBubbles = 3): string[] {
  const clean = sanitizeReply(text);
  if (!clean) return [];
  if (clean.length <= SINGLE_BUBBLE_UNTIL && !clean.includes("\n\n")) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return [clean];

  const bubbles: string[] = [];
  for (const paragraph of paragraphs) {
    const last = bubbles[bubbles.length - 1];
    // Fragmento curto não merece balão próprio ("Perfeito!" sozinho parece bot).
    if (last && (paragraph.length < MIN_CHUNK_CHARS || last.length < MIN_CHUNK_CHARS)) {
      bubbles[bubbles.length - 1] = `${last}\n\n${paragraph}`;
    } else {
      bubbles.push(paragraph);
    }
  }

  if (bubbles.length > maxBubbles) {
    const head = bubbles.slice(0, maxBubbles - 1);
    head.push(bubbles.slice(maxBubbles - 1).join("\n\n"));
    return head;
  }
  return bubbles;
}

/**
 * Pausa antes de enviar o próximo balão, proporcional ao tamanho dele. Sem
 * pausa os balões chegam no mesmo segundo e o efeito é pior que o textão.
 */
export function typingDelayMs(nextBubble: string): number {
  return Math.min(2_200, 350 + nextBubble.length * 14);
}
