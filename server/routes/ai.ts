import express from "express";
import { GoogleGenAI } from "@google/genai";
import { fetchWithTimeout } from "../lib/http";
import { requireUser } from "../middleware/auth";

export const aiRouter = express.Router();

const SYSTEM_INSTRUCTION = "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais.";

async function enhanceWithGemini(apiKey: string, text: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 15000 } });
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    config: { systemInstruction: SYSTEM_INSTRUCTION },
    contents: text,
  });
  return response.text || "";
}

// Mesmo caminho alternativo já usado pelo agente (server/services/agent.ts)
// quando a chave Gemini está sem cota — reaproveita as mesmas env vars.
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

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || "");
  return msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("high demand") || msg.toLowerCase().includes("resource_exhausted");
}

const TRANSCRIBE_INSTRUCTION = "Transcreva o áudio a seguir em português do Brasil. Responda APENAS com o texto transcrito, sem comentários, sem aspas e sem formatação. Se o áudio estiver em silêncio ou não for possível entender, responda com uma string vazia.";

/**
 * Botão de microfone do Assistente IA (CommandBar.tsx) — grava com
 * MediaRecorder no navegador (funciona em qualquer browser/celular,
 * diferente da Web Speech API que não existe no Firefox/Safari) e manda o
 * blob pra cá só pra virar texto. Usa gemini-2.0-flash (não o -lite usado no
 * resto do app) porque tem suporte a áudio mais confiável e, na prática, é
 * outro bucket de cota — útil enquanto a cota do -lite andar zerada.
 */
aiRouter.post("/api/ai/transcribe", requireUser, async (req, res) => {
  const { audioData, mimeType } = req.body;
  if (!audioData || typeof audioData !== "string") {
    return res.status(400).json({ error: "Nenhum áudio enviado." });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || geminiKey.length < 10) {
    return res.status(500).json({ error: "A transcrição de áudio não está configurada no servidor (falta a chave da IA)." });
  }

  const base64Data = audioData.replace(/^data:[^;]+;base64,/, "");
  // Limite defensivo — voz costuma ser leve (webm/opus), isso já cobre
  // vários minutos de fala; acima disso é upload anormal, não mensagem real.
  if (Buffer.byteLength(base64Data, "base64") > 15 * 1024 * 1024) {
    return res.status(413).json({ error: "Áudio muito grande (máx. 15MB)." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { timeout: 20000 } });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{
        role: "user",
        parts: [
          { text: TRANSCRIBE_INSTRUCTION },
          { inlineData: { mimeType: typeof mimeType === "string" ? mimeType : "audio/webm", data: base64Data } },
        ],
      }],
    });
    const text = (response.text || "").trim();
    res.json({ text });
  } catch (error: any) {
    console.error("Erro na transcrição de áudio (Gemini):", error);
    const errorMsg = isQuotaError(error)
      ? "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente."
      : "Não foi possível transcrever o áudio agora. Tente de novo ou digite a mensagem.";
    res.status(500).json({ error: errorMsg });
  }
});

/**
 * Rota para aprimorar textos de descrições de imóveis.
 * Usa Gemini como principal; cai pro OpenRouter (mesmo padrão do agente)
 * quando a chave Gemini está sem cota.
 */
aiRouter.post("/api/ai/enhance-text", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Nenhum texto fornecido para aprimoramento." });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const hasGemini = !!geminiKey && geminiKey.length >= 10;
  const hasOpenRouter = !!openRouterKey && openRouterKey.startsWith("sk-or-");

  if (!hasGemini && !hasOpenRouter) {
    console.error("ERRO: nenhuma chave de IA (Gemini/OpenRouter) configurada no servidor.");
    return res.status(500).json({
      error: "A funcionalidade de IA não está configurada corretamente (Chave de API ausente)."
    });
  }

  try {
    const suggestedText = hasGemini
      ? await enhanceWithGemini(geminiKey!, text)
      : await enhanceWithOpenRouter(openRouterKey!, text);
    res.json({ suggestedText });
  } catch (error: any) {
    console.error(`Erro na API da IA (${hasGemini ? "Gemini" : "OpenRouter"}):`, error);

    if (hasGemini && hasOpenRouter && isQuotaError(error)) {
      try {
        const suggestedText = await enhanceWithOpenRouter(openRouterKey!, text);
        return res.json({ suggestedText });
      } catch (error2: any) {
        console.error("Erro na API da IA (OpenRouter, fallback):", error2);
        return res.status(500).json({ error: "Não foi possível gerar a sugestão no momento." });
      }
    }

    let errorMsg = "Não foi possível gerar a sugestão no momento.";
    if (error.message?.includes("API key not valid")) {
      errorMsg = "Erro de autenticação com a API da IA. Verifique a configuração da chave.";
    } else if (isQuotaError(error)) {
      errorMsg = "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente.";
    }

    res.status(500).json({ error: errorMsg });
  }
});
