import express from "express";
import { z } from "zod";
import { fetchWithTimeout } from "../lib/http";
import { requireUser } from "../middleware/auth";
import { aiTextLimiter, aiTranscriptionLimiter } from "../middleware/rateLimits";
import { validateBody } from "../middleware/validate";
import { PUBLIC_APP_URL } from "../config";
import {
  createOpenRouterError,
  extractValidBase64Audio,
  hasOpenRouterKey,
  isAiQuotaError,
  logAiProviderError,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DATA_CHARS,
  resolveAudioFormat,
  transcribeWithOpenRouter,
} from "../services/mediaAi";

export const aiRouter = express.Router();

const MAX_ENHANCE_TEXT_CHARS = 10_000;

const enhanceTextSchema = z.object({
  text: z.string()
    .trim()
    .min(1, "Texto é obrigatório.")
    .max(MAX_ENHANCE_TEXT_CHARS, `Texto muito longo (máx. ${MAX_ENHANCE_TEXT_CHARS} caracteres).`),
});

// mimeType é só uma dica opcional do cliente. Navegadores mobile reportam
// formatos imprevisíveis (audio/mp4 com/sem codecs, com/sem aspas, com espaço
// após o ';'), então NÃO rejeitamos por formato aqui — a validação de verdade
// é o data URL de áudio + base64 em extractValidBase64Audio.
const transcribeSchema = z.object({
  audioData: z.string()
    .min(1, "Áudio é obrigatório.")
    .max(MAX_AUDIO_DATA_CHARS, "Áudio excede o limite da requisição."),
  mimeType: z.string().trim().max(100).optional().default("audio/webm"),
});

const SYSTEM_INSTRUCTION = "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais.";

async function enhanceWithOpenRouter(apiKey: string, text: string): Promise<string> {
  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PUBLIC_APP_URL,
      "X-Title": "PANTUS Real Estate",
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

/**
 * Botão de microfone do Assistente IA (CommandBar.tsx) — grava com
 * MediaRecorder no navegador (funciona em qualquer browser/celular,
 * diferente da Web Speech API que não existe no Firefox/Safari) e manda o
 * blob pra cá só pra virar texto.
 */
aiRouter.post("/api/ai/transcribe", requireUser, aiTranscriptionLimiter, validateBody(transcribeSchema), async (req, res) => {
  const { audioData, mimeType } = req.body;
  const base64Data = extractValidBase64Audio(audioData);
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
    const format = resolveAudioFormat(audioData, mimeType);
    const text = await transcribeWithOpenRouter(base64Data, format);
    res.json({ text });
  } catch (error: any) {
    logAiProviderError("Erro na transcrição de áudio (OpenRouter)", error);
    const errorMsg = isAiQuotaError(error)
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
    logAiProviderError("Erro na API da IA (OpenRouter)", error);
    const errorMsg = isAiQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível gerar a sugestão no momento.";
    res.status(500).json({ error: errorMsg });
  }
});
