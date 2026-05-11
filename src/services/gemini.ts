import { GoogleGenAI } from "@google/genai";

/**
 * Instância do cliente Gemini AI (lazy initialization)
 * Isso garante que a chave de API seja lida apenas quando necessário, evitando erros de carga inicial.
 */
let aiClient: GoogleGenAI | null = null;

/**
 * Obtém ou inicializa o cliente GoogleGenAI
 */
function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não configurada no ambiente.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Gera uma descrição persuasiva para um imóvel usando a API do Gemini.
 * 
 * @param title Título do imóvel
 * @param location Localização
 * @param features Lista de características principais
 * @returns Descrição gerada ou mensagem de fallback em caso de erro
 */
export async function generatePropertyDescription(title: string, location: string, features: string[]) {
  try {
    const ai = getAiClient();
    
    // Prompt estruturado para corretor de imóveis de luxo
    const prompt = `Você é um corretor de imóveis de luxo. 
    Escreva uma descrição persuasiva e cativante para um imóvel com o título "${title}", localizado em "${location}".
    Destaque as seguintes características: ${features.join(", ")}.
    A descrição deve ser focada em conversão e atraente para o WhatsApp.`;

    // Chamada à API usando o modelo configurado
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Modelo recomendado e resiliente
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    // Retorna o texto gerado (a propriedade .text é um getter direto)
    return result.text;
  } catch (error: any) {
    // Log do erro para monitoramento
    console.error("Erro ao gerar descrição com Gemini:", error);
    
    // Verifica especificamente se o erro é de cota excedida (Rate Limit)
    if (error.message?.includes("quota") || error.message?.includes("429")) {
      return "O limite de uso da IA foi atingido temporariamente. Por favor, aguarde 1 minuto ou descreva manualmente.";
    }
    
    // Fallback amigável para não interromper a experiência do usuário
    return "Descrição automática temporariamente indisponível. Por favor, adicione uma descrição manualmente.";
  }
}
