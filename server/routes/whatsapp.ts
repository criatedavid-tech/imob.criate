import express from "express";
import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { INTERNAL_PROXY_TOKEN } from "../config";
import { fetchWithTimeout } from "../lib/http";

export const whatsappRouter = express.Router();

// ─── Envio de mensagem WhatsApp via N8N ─────────────────────────────────
// Autenticação: Authorization: Bearer <INTERNAL_PROXY_TOKEN>
// Body: { brokerPhone, clientPhone, message, mediaUrl? }
whatsappRouter.post("/api/whatsapp/send", async (req, res) => {
  const auth = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const { brokerPhone, clientPhone, message, mediaUrl } = req.body;
  if (!brokerPhone || !clientPhone || !message) {
    return res.status(400).json({ error: 'brokerPhone, clientPhone e message são obrigatórios.' });
  }

  try {
    const normalizedBroker = normalizePhoneBR(brokerPhone);
    const { data: broker } = await supabase
      .from('imf_brokers')
      .select('id, name, zpro_api_url, zpro_api_key, zpro_api_token, zpro_channel_id')
      .eq('phone', normalizedBroker)
      .single();

    if (!broker?.zpro_api_url || !broker?.zpro_api_token) {
      return res.status(404).json({ error: 'Corretor não encontrado ou WhatsApp não configurado.' });
    }

    const zpro_headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${broker.zpro_api_token}`
    };

    const toNumber = normalizePhoneBR(clientPhone);

    // Envia via Z-PRO v2 External API
    let zpro_body: any;
    let endpoint: string;

    if (mediaUrl) {
      endpoint = `${broker.zpro_api_url}/messages/send-media`;
      zpro_body = { number: toNumber, mediaUrl, caption: message };
    } else {
      endpoint = `${broker.zpro_api_url}/messages/send-text`;
      zpro_body = { number: toNumber, text: message };
    }

    const zpro_res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: zpro_headers,
      body: JSON.stringify(zpro_body)
    });

    if (!zpro_res.ok) {
      const err = await zpro_res.text();
      console.error(`[WPP Send] Z-PRO error: ${err}`);
      return res.status(502).json({ error: 'Falha ao enviar via Z-PRO.', detail: err });
    }

    const result = await zpro_res.json().catch(() => ({}));
    console.log(`[WPP Send] broker=${broker.id} → ${toNumber}`);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('[WPP Send] erro:', err?.message);
    res.status(500).json({ error: err.message });
  }
});
