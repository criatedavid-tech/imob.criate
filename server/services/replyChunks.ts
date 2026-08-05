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

// Muletas que o modelo repete mesmo com o prompt proibindo nominalmente — e
// que denunciam o robô na primeira linha. Proibir no prompt reduz, não elimina:
// numa conversa longa a instrução perde peso para o histórico. Aqui é
// determinístico. Só entram frases cuja remoção deixa a oração de pé sozinha.
const CRUTCHES: RegExp[] = [
  /para eu (?:te |lhe )?ajudar melhor,?\s*/gi,
  /pelo que (?:eu )?entendi,?\s*/gi,
  /(?:que bom te ter por aqui|que bom que me avisou|fico feliz em ajudar)[!.,]?\s*/gi,
  /posso (?:te )?ajudar em mais alguma coisa\??\s*/gi,
  /(?:estou|fico) (?:aqui )?(?:à|a) disposi[cç][aã]o[!.]?\s*/gi,
  /perfeito para quem busca conforto e praticidade[!.]?\s*/gi,
];

function removeCrutches(text: string): string {
  let out = text;
  for (const crutch of CRUTCHES) out = out.replace(crutch, "");
  // Nada removido: devolve intacto. A recapitalização abaixo só faz sentido
  // para consertar a frase que perdeu a abertura — não pode mexer em texto
  // que o modelo escreveu como quis.
  if (out === text) return text;
  return out
    // Sobra de pontuação depois de tirar a muleta do meio da frase.
    .replace(/([.!?])\s*[,;]\s*/g, "$1 ")
    .replace(/^\s*[,;]\s*/gm, "")
    // Reinicia a frase com maiúscula quando a muleta era a abertura.
    .replace(/(^|[.!?]\s+)([a-zà-ú])/g, (_, prefixo: string, letra: string) => prefixo + letra.toUpperCase())
    .replace(/[ \t]{2,}/g, " ");
}

/** Limpa vícios que o modelo insiste em produzir mesmo com o prompt pedindo o contrário. */
export function sanitizeReply(text: string): string {
  let out = removeCrutches(
    String(text ?? "")
      .replace(/^=+/, "")           // artefato de expressão do n8n
      .replace(/\r\n/g, "\n"),
  ).trim();
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
