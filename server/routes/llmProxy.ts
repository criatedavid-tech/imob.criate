import express from "express";
import { OPENROUTER_API_KEY, OPENROUTER_N8N_MODELS, PUBLIC_APP_URL } from "../config";
import { fetchWithTimeout } from "../lib/http";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nLlmLimiter } from "../middleware/rateLimits";
import {
  N8nInputValidationError,
  parseN8nLlmProxyRequest,
} from "../security/n8nGuardrails";

export const llmProxyRouter = express.Router();

// O n8n pode acessar somente chat/completions, por POST, com modelos e corpo
// limitados. O proxy antigo aceitava qualquer método e qualquer sufixo da API
// OpenRouter, transformando o token interno em uma credencial ampla demais.
llmProxyRouter.post(
  '/api/proxy/llm/:brokerPhone/chat/completions',
  requireInternalToken,
  n8nLlmLimiter,
  async (req, res) => {
    if (!OPENROUTER_API_KEY) {
      return res.status(402).json({
        error: { message: 'OpenRouter key não configurada no servidor.', type: 'invalid_api_key' },
      });
    }

    try {
      const body = parseN8nLlmProxyRequest(req.body, OPENROUTER_N8N_MODELS);
      const proxyResp = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': PUBLIC_APP_URL,
          'X-Title': 'ImobiFlow',
        },
        body: JSON.stringify(body),
      }, 60_000);
      const data = await proxyResp.json();
      return res.status(proxyResp.status).json(data);
    } catch (err: any) {
      if (err instanceof N8nInputValidationError) {
        return res.status(400).json({ error: { message: err.message, type: 'invalid_request' } });
      }
      console.error('[LLM Proxy] Erro ao chamar OpenRouter:', err);
      return res.status(502).json({ error: { message: 'Falha ao acessar o provedor de IA.', type: 'proxy_error' } });
    }
  },
);
