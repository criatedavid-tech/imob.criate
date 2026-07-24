// Semáforo simples para limitar quantas operações CARAS rodam ao mesmo tempo
// dentro de um processo. Usado no enriquecimento de mídia recebida: download na
// UAZAPI + transcrição/visão no OpenRouter.
//
// Sem isso, um lote de 10 áudios disparava 10 downloads e 10 chamadas de IA
// simultâneos: ~30-40 MB transientes de base64 por linha (a string base64, a
// cópia dentro do JSON.stringify e o Buffer do upload) — 300-400 MB de pico
// numa VM de 1 GB, além de estourar a cota do OpenRouter justamente no pico,
// quando todo áudio passava a cair no texto de fallback.
export function createSemaphore(maxConcurrent: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };

  return async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// Prazo máximo para uma operação. Diferente do timeout de cada chamada HTTP:
// aqui é o teto do PASSO inteiro (download + IA + upload podiam somar mais de
// 60s por linha, sem nenhum limite global, congelando a fila toda).
export async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: prazo de ${ms}ms excedido`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
