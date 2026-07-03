import express from "express";
import { GoogleGenAI } from "@google/genai";

export const aiRouter = express.Router();

// --- ROTAS DE INTELIGÊNCIA ARTIFICIAL (GEMINI) ---
/**
 * Rota para aprimorar textos de descrições de imóveis.
 * Utiliza a API do Google Gemini para reescrever o texto com linguagem premium.
 */
aiRouter.post("/api/ai/enhance-text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Nenhum texto fornecido para aprimoramento." });
    }

    // Obtém a chave de API do ambiente
    const apiKey = process.env.GEMINI_API_KEY;

    // Validação básica da presença da chave
    if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
      console.error("ERRO: GEMINI_API_KEY não configurada ou inválida no servidor.");
      return res.status(500).json({
        error: "A funcionalidade de IA não está configurada corretamente (Chave de API ausente)."
      });
    }

    // Inicialização do cliente GoogleGenAI
    const ai = new GoogleGenAI({ apiKey });

    // Chamada para geração de conteúdo com instrução de sistema
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      config: {
        systemInstruction: "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais."
      },
      contents: text,
    });

    // Retorna o texto sugerido pela IA
    res.json({ suggestedText: response.text });
  } catch (error: any) {
    // Log detalhado do erro para depuração no servidor
    console.error("Erro na API da IA (Gemini):", error);

    // Tratamento de mensagens de erro amigáveis
    let errorMsg = "Não foi possível gerar a sugestão no momento.";
    if (error.message?.includes("API key not valid")) {
      errorMsg = "Erro de autenticação com a API da IA. Verifique a configuração da chave.";
    } else if (error.message?.includes("high demand") || error.message?.includes("429") || error.message?.includes("quota")) {
      errorMsg = "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente.";
    }

    res.status(500).json({ error: errorMsg });
  }
});
