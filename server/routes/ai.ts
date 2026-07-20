import express from "express";
import { z } from "zod";
import { fetchWithTimeout } from "../lib/http";
import { requireUser } from "../middleware/auth";
import { aiTextLimiter, aiTranscriptionLimiter } from "../middleware/rateLimits";
import { validateBody } from "../middleware/validate";

export const aiRouter = express.Router();

const MAX_ENHANCE_TEXT_CHARS = 10_000;
const MAX_AUDIO_DATA_CHARS = 9 * 1024 * 1024;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const AUDIO_DATA_PREFIX = /^data:(audio\/(?:webm|ogg|mp4|mp3|wav))(?:;[a-z0-9!#$&^_.+-]+="?[a-z0-9!#$&^_.+-]+"?)*;base64$/i;
const BASE64_PAYLOAD = /^[a-zA-Z0-9+/]+={0,2}$/;

const enhanceTextSchema = z.object({
  text: z.string()
    .trim()
    .min(1, "Texto é obrigatório.")
    .max(MAX_ENHANCE_TEXT_CHARS, `Texto muito longo (máx. ${MAX_ENHANCE_TEXT_CHARS} caracteres).`),
});

const audioMimeTypeSchema = z.string()
  .trim()
  .min(1, "Formato de áudio é obrigatório.")
  .max(100, "Formato de áudio inválido.")
  .regex(
    /^audio\/(?:webm|ogg|mp4|mp3|wav)(?:;[a-z0-9!#$&^_.+-]+="?[a-z0-9!#$&^_.+-]+"?)*$/i,
    "Formato de áudio não suportado.",
  );

const transcribeSchema = z.object({
  audioData: z.string()
    .min(1, "Áudio é obrigatório.")
    .max(MAX_AUDIO_DATA_CHARS, "Áudio excede o limite da requisição."),
  mimeType: audioMimeTypeSchema.optional().default("audio/webm"),
});

function extractValidBase64Audio(audioData: string, mimeType: string): string | null {
  const commaIdx = audioData.indexOf(",");
  if (commaIdx >= 0) {
    const prefixMatch = AUDIO_DATA_PREFIX.exec(audioData.slice(0, commaIdx));
    const requestedBaseType = mimeType.split(";", 1)[0].toLowerCase();
    if (!prefixMatch || prefixMatch[1].toLowerCase() !== requestedBaseType) return null;
  }

  const base64Data = commaIdx >= 0 ? audioData.slice(commaIdx + 1) : audioData;
  if (!base64Data || base64Data.length % 4 !== 0 || !BASE64_PAYLOAD.test(base64Data)) return null;
  return base64Data;
}

// OpenRouter é a ÚNICA fonte de IA deste arquivo (decisão explícita
// 2026-07-14) — a chave Gemini pessoal ficava com cota zerada repetidamente
// (confirmado direto contra a API: "limit: 0" em todos os modelos, texto e
// áudio), então deixou de valer a pena manter como principal/fallback.
function hasOpenRouterKey(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return !!key && key.startsWith("sk-or-");
}

function isQuotaError(err: any): boolean {
  if (err?.isQuota === true) return true;
  const msg = String(err?.message || "");
  return msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("high demand") || msg.toLowerCase().includes("resource_exhausted");
}

type AiProviderError = Error & {
  provider?: "openrouter";
  status?: number;
  code?: string;
  requestId?: string;
  isQuota?: boolean;
};

function safeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const compact = String(value).trim();
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(compact) ? compact : undefined;
}

function sanitizeLogMessage(value: unknown): string {
  const compact = String(value ?? "Erro desconhecido")
    .slice(0, 2000)
    .replace(/data:[^,\s]{0,200};base64,[a-zA-Z0-9+/=]+/gi, "[data-url-redacted]")
    .replace(/(?:Bearer\s+|sk-or-v1-)[a-zA-Z0-9._~+/=-]+/gi, "[secret-redacted]")
    .replace(/\b(authorization|token|api[_-]?key)\s*[:=]\s*["']?[^,\s"']+/gi, "$1=[secret-redacted]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email-redacted]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}\b/g, "[phone-redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 400 ? `${compact.slice(0, 397)}...` : compact;
}

function logError(label: string, error: any) {
  const details: Record<string, string | number> = {
    message: sanitizeLogMessage(error?.message ?? error),
  };
  if (error?.provider === "openrouter") details.provider = "openrouter";
  if (Number.isInteger(error?.status)) details.status = error.status;
  const code = safeMetadata(error?.code);
  const requestId = safeMetadata(error?.requestId);
  if (code) details.code = code;
  if (requestId) details.requestId = requestId;
  console.error(`${label}: ${JSON.stringify(details)}`);
}

function createOpenRouterError(resp: Response, data: any): AiProviderError {
  const providerMessage = typeof data?.error?.message === "string" ? data.error.message.slice(0, 1000) : "";
  const providerRaw = typeof data?.error?.metadata?.raw === "string" ? data.error.metadata.raw.slice(0, 1000) : "";
  const error = new Error("Falha na requisição ao provedor de IA.") as AiProviderError;
  error.provider = "openrouter";
  error.status = resp.status;
  error.code = safeMetadata(data?.error?.code ?? data?.error?.metadata?.code);
  error.requestId = safeMetadata(
    resp.headers.get("x-request-id")
      ?? data?.error?.metadata?.request_id
      ?? data?.request_id,
  );
  error.isQuota = isQuotaError({ message: `${resp.status} ${providerMessage} ${providerRaw}` });
  return error;
}

const SYSTEM_INSTRUCTION = "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais.";

async function enhanceWithOpenRouter(apiKey: string, text: string): Promise<string> {
  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://imobiflow.fly.dev",
      "X-Title": "ImobiFlow",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: text },
      ],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw createOpenRouterError(resp, data);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia do OpenRouter.");
  return content;
}

const TRANSCRIBE_INSTRUCTION = "Transcreva o áudio a seguir em português do Brasil. Responda APENAS com o texto transcrito, sem comentários, sem aspas e sem formatação. Se o áudio estiver em silêncio ou não for possível entender, responda com uma string vazia.";

// google/gemini-2.5-flash-lite VIA OpenRouter (cota própria da OpenRouter,
// não uma chave Gemini pessoal). Testado direto contra a API real antes de
// integrar: os modelos de áudio da própria OpenAI (gpt-audio-mini) só
// aceitam format "wav"/"mp3" e REJEITAM "webm" com 400 — inviável, já que o
// MediaRecorder do navegador grava webm/opus por padrão e não tem como
// gerar wav nativamente. Os modelos Gemini via OpenRouter aceitam "webm"
// (formato real do navegador) sem validar à risca — confirmado com request real.
async function transcribeWithOpenRouter(apiKey: string, base64Data: string, mimeType: string): Promise<string> {
  const format = mimeType.includes("mp3") ? "mp3"
    : mimeType.includes("wav") ? "wav"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") ? "mp4"
    : "webm";
  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://imobiflow.fly.dev",
      "X-Title": "ImobiFlow",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_INSTRUCTION },
          { type: "input_audio", input_audio: { data: base64Data, format } },
        ],
      }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw createOpenRouterError(resp, data);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Resposta vazia do OpenRouter.");
  return content.trim();
}

/**
 * Botão de microfone do Assistente IA (CommandBar.tsx) — grava com
 * MediaRecorder no navegador (funciona em qualquer browser/celular,
 * diferente da Web Speech API que não existe no Firefox/Safari) e manda o
 * blob pra cá só pra virar texto.
 */
aiRouter.post("/api/ai/transcribe", requireUser, aiTranscriptionLimiter, validateBody(transcribeSchema), async (req, res) => {
  const { audioData, mimeType } = req.body;
  const base64Data = extractValidBase64Audio(audioData, mimeType);
  if (!base64Data) {
    return res.status(400).json({ error: "Conteúdo de áudio inválido." });
  }
  if (Buffer.byteLength(base64Data, "base64") > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: "Áudio muito grande (máx. 6MB)." });
  }

  if (!hasOpenRouterKey()) {
    return res.status(500).json({ error: "A transcrição de áudio não está configurada no servidor (falta a chave da IA)." });
  }

  try {
    const text = await transcribeWithOpenRouter(process.env.OPENROUTER_API_KEY!, base64Data, mimeType);
    res.json({ text });
  } catch (error: any) {
    logError("Erro na transcrição de áudio (OpenRouter)", error);
    const errorMsg = isQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível transcrever o áudio agora. Tente de novo ou digite a mensagem.";
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * Rota para aprimorar textos de descrições de imóveis.
 */
aiRouter.post("/api/ai/enhance-text", requireUser, aiTextLimiter, validateBody(enhanceTextSchema), async (req, res) => {
  const { text } = req.body;

  if (!hasOpenRouterKey()) {
    console.error("ERRO: nenhuma chave de IA (OpenRouter) configurada no servidor.");
    return res.status(500).json({
      error: "A funcionalidade de IA não está configurada corretamente (Chave de API ausente)."
    });
  }

  try {
    const suggestedText = await enhanceWithOpenRouter(process.env.OPENROUTER_API_KEY!, text);
    res.json({ suggestedText });
  } catch (error: any) {
    logError("Erro na API da IA (OpenRouter)", error);
    const errorMsg = isQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível gerar a sugestão no momento.";
    res.status(500).json({ error: errorMsg });
  }
});
