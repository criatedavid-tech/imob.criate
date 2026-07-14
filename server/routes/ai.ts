import express from "express";
import { fetchWithTimeout } from "../lib/http";
import { requireUser } from "../middleware/auth";

export const aiRouter = express.Router();

// OpenRouter é a ÚNICA fonte de IA deste arquivo (decisão explícita
// 2026-07-14) — a chave Gemini pessoal ficava com cota zerada repetidamente
// (confirmado direto contra a API: "limit: 0" em todos os modelos, texto e
// áudio), então deixou de valer a pena manter como principal/fallback.
function hasOpenRouterKey(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return !!key && key.startsWith("sk-or-");
}

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || "");
  return msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("high demand") || msg.toLowerCase().includes("resource_exhausted");
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
  if (!resp.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${resp.status}`);
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
  if (!resp.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${resp.status}`);
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
aiRouter.post("/api/ai/transcribe", requireUser, async (req, res) => {
  const { audioData, mimeType } = req.body;
  if (!audioData || typeof audioData !== "string") {
    return res.status(400).json({ error: "Nenhum áudio enviado." });
  }

  if (!hasOpenRouterKey()) {
    return res.status(500).json({ error: "A transcrição de áudio não está configurada no servidor (falta a chave da IA)." });
  }

  const base64Data = audioData.replace(/^data:[^;]+;base64,/, "");
  // Limite defensivo — voz costuma ser leve (webm/opus), isso já cobre
  // vários minutos de fala; acima disso é upload anormal, não mensagem real.
  if (Buffer.byteLength(base64Data, "base64") > 15 * 1024 * 1024) {
    return res.status(413).json({ error: "Áudio muito grande (máx. 15MB)." });
  }
  const audioMimeType = typeof mimeType === "string" ? mimeType : "audio/webm";

  try {
    const text = await transcribeWithOpenRouter(process.env.OPENROUTER_API_KEY!, base64Data, audioMimeType);
    res.json({ text });
  } catch (error: any) {
    console.error("Erro na transcrição de áudio (OpenRouter):", error);
    const errorMsg = isQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível transcrever o áudio agora. Tente de novo ou digite a mensagem.";
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * Rota para aprimorar textos de descrições de imóveis.
 */
aiRouter.post("/api/ai/enhance-text", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Nenhum texto fornecido para aprimoramento." });
  }

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
    console.error("Erro na API da IA (OpenRouter):", error);
    const errorMsg = isQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível gerar a sugestão no momento.";
    res.status(500).json({ error: errorMsg });
  }
});
