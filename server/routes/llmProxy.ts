import express from "express";
import { INTERNAL_PROXY_TOKEN, OPENROUTER_API_KEY, PUBLIC_APP_URL } from "../config";
import { fetchWithTimeout } from "../lib/http";

export const llmProxyRouter = express.Router();

// ─── PROXY LLM ─────────────────────────────────────────────────────────────
// N8N chama: POST /api/proxy/llm/:brokerPhone/chat/completions
// Authorization: Bearer INTERNAL_PROXY_TOKEN   (credential estática no N8N)
// O proxy busca a key OpenRouter do corretor no Supabase e encaminha para
// openrouter.ai — cada corretor é cobrado na própria conta.
// Fallback: OPENROUTER_API_KEY (chave da empresa) se o corretor não configurou.
llmProxyRouter.all('/api/proxy/llm/:brokerPhone/*', async (req, res) => {
  const authHeader = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!INTERNAL_PROXY_TOKEN || authHeader !== INTERNAL_PROXY_TOKEN) {
    return res.status(401).json({ error: { message: 'Proxy: token inválido.', type: 'invalid_api_key' } });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(402).json({
      error: { message: 'OpenRouter key não configurada no servidor.', type: 'invalid_api_key' }
    });
  }

  const suffix = ((req.params as any)[0] || 'chat/completions').replace(/^\//, '');
  const openRouterUrl = `https://openrouter.ai/api/v1/${suffix}`;
  try {
    const proxyResp = await fetchWithTimeout(openRouterUrl, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': PUBLIC_APP_URL,
        'X-Title': 'ImobiFlow'
      },
      body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : JSON.stringify(req.body)
    });
    const data = await proxyResp.json();
    res.status(proxyResp.status).json(data);
  } catch (err: any) {
    console.error('[LLM Proxy] Erro ao chamar OpenRouter:', err);
    res.status(502).json({ error: { message: 'Proxy error: ' + err.message, type: 'proxy_error' } });
  }
});
