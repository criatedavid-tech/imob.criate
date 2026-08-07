import express from "express";
import { supabase } from "../supabase";
import { webhookLimiter } from "../middleware/rateLimits";
import { enqueuePaiWebhook, runPaiInboxTick } from "../services/whatsappPaiQueue";

export const whatsappPaiRouter = express.Router();

// Entrada do WhatsApp Pai — instância ÚNICA, compartilhada por toda a
// plataforma (diferente de /api/wpp-shim/inbound/:instanceId, que resolve
// 1 instância = 1 broker). Autenticação: body.token bate com o token da
// própria instância central (mesmo princípio do inbound de broker, só que
// sem lookup por instanceId já que só existe uma).
whatsappPaiRouter.post("/api/wpp-pai/inbound", webhookLimiter, async (req, res) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, any> : {};

    const { data: instance } = await supabase
      .from("imf_platform_instances")
      .select("uazapi_instance_token, webhook_enabled")
      .eq("key", "pai")
      .maybeSingle();

    // Token ausente/errado nunca entra na fila. 200 evita retry infinito de
    // um evento que nunca vai ser válido (mesmo padrão do inbound de broker).
    if (
      !instance?.webhook_enabled
      || !instance.uazapi_instance_token
      || body.token !== instance.uazapi_instance_token
    ) {
      return res.status(200).json({ ok: true, queued: false });
    }

    const result = await enqueuePaiWebhook(body);
    res.status(200).json({ ok: true, queued: result === "accepted" });

    // Processa já, no próprio processo web, sem esperar o worker dedicado
    // — mesmo espírito oportunista do inbound de broker (conversations.ts).
    if (result === "accepted") {
      void runPaiInboxTick().catch((e: any) =>
        console.warn("[WhatsApp Pai] tick oportunista falhou:", e?.message));
    }
  } catch (err: any) {
    console.error("[WhatsApp Pai] falha ao persistir webhook:", err.message);
    res.status(503).json({ error: "Webhook temporariamente indisponível." });
  }
});
