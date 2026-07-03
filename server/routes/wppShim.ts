import express from "express";
import { supabase } from "../supabase";
import { sendUazapiText } from "../services/wppShim";
import { requireUser, getBrokerId } from "../middleware/auth";
import { N8N_WEBHOOK_URL } from "../config";
import { pauseAiForHumanTakeover } from "../services/followup";

export const wppShimRouter = express.Router();

// ─── Disfarce do Z-PRO (Fase 2 do plano "Eliminar o Z-PRO") ────────────────
// Aceita o MESMO formato que N8N e o cron de follow-up já usam pra mandar
// mensagem pelo Z-PRO (server/services/followup.ts:sendFollowMessage) —
// {body, number, externalKey, isClosed} + header "Authorization: Token X".
// Repontar imf_brokers.zpro_api_url pra esta rota migra o ENVIO de um
// corretor sem exigir nenhuma mudança no N8N.
wppShimRouter.post("/api/wpp-shim/external/:brokerKey", async (req, res) => {
  try {
    const auth = (req.headers["authorization"] || "").replace("Token ", "").trim();
    const { body: message, number } = req.body || {};
    if (!message || !number) {
      return res.status(400).json({ error: "body e number são obrigatórios." });
    }

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("id, zpro_api_token, uazapi_instance_token")
      .eq("zpro_api_key", req.params.brokerKey)
      .maybeSingle();

    if (!broker || !auth || auth !== broker.zpro_api_token) {
      return res.status(401).json({ error: "Token inválido." });
    }
    if (!broker.uazapi_instance_token) {
      return res.status(503).json({ error: "Instância UAZAPI não configurada para este corretor ainda." });
    }

    // ZWSP (zero-width space) marcava msg de sistema pro N8N distinguir de
    // resposta manual do corretor — aqui já sabemos a origem pelo endpoint
    // chamado, então só removemos o marcador do texto exibido/persistido.
    const cleanText = message.replace(/^​/, "");

    const sent = await sendUazapiText(broker.uazapi_instance_token, number, cleanText);

    await supabase.from("imf_conversation_messages").insert({
      broker_id: broker.id,
      customer_phone: number,
      direction: "out",
      sender_type: "ai",
      body: cleanText,
    });

    if (!sent.ok) {
      console.warn(`[WppShim] envio falhou pra broker ${broker.id}: status=${sent.status}`);
      return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[WppShim] erro em /external:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Entrada direto da UAZAPI (Fase 4 — modo sombra, ninguém aponta aqui ainda) ──
// Formato do corpo NÃO é o "message_n8n" do Z-PRO (isso é formato de SAÍDA do
// Z-PRO, nunca vimos o corpo bruto real da UAZAPI). Formato próprio, ainda não
// confirmado contra um payload real — por isso o payload inteiro é sempre
// gravado em webhook_logs primeiro, cru, antes de qualquer tentativa de
// interpretar campos. Quando um número de teste conectar aqui de verdade,
// essa gravação crua vira a resposta empírica de como a UAZAPI manda mensagem.
wppShimRouter.post("/api/wpp-shim/inbound/:instanceId", async (req, res) => {
  // Responde rápido sempre — nunca perder mensagem por causa de um erro de
  // interpretação de payload ou de uma falha ao repassar pro N8N.
  res.status(200).json({ ok: true });

  try {
    await supabase.from("webhook_logs").insert({
      source: "uazapi",
      event_type: req.body?.event || req.body?.type || "unknown",
      payload: { instance_id: req.params.instanceId, body: req.body },
      status: "received",
    });

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("id")
      .eq("uazapi_instance_id", req.params.instanceId)
      .maybeSingle();
    if (!broker) return; // instância desconhecida — só o log em webhook_logs registra

    // Extração best-effort — vários provedores desse tipo (Baileys-based) usam
    // essa forma (data.key.remoteJid/fromMe/id, data.message.conversation,
    // data.pushName). Fallbacks genéricos cobrem formatos mais simples também.
    // PRECISA ser corrigido contra o payload real assim que houver um (ver
    // webhook_logs source='uazapi' pra comparar).
    const d = req.body?.data || req.body;
    const remoteJid: string | undefined = d?.key?.remoteJid || d?.number || d?.from;
    const fromMe: boolean = !!(d?.key?.fromMe ?? d?.fromMe);
    const messageId: string | undefined = d?.key?.id || d?.messageId || d?.id;
    const text: string | undefined =
      d?.message?.conversation ?? d?.message?.extendedTextMessage?.text ?? d?.text ?? d?.body;

    if (!remoteJid || fromMe || !text) return; // sem dado suficiente, ou eco da própria IA
    const customerPhone = String(remoteJid).replace(/\D/g, "");
    if (!customerPhone) return;

    await supabase.from("imf_conversation_messages").insert({
      broker_id: broker.id,
      customer_phone: customerPhone,
      direction: "in",
      sender_type: "customer",
      body: text,
      provider_message_id: messageId || null,
    });

    await supabase.from("followup_conversations").upsert(
      {
        broker_id: broker.id,
        customer_phone: customerPhone,
        last_customer_message_at: new Date().toISOString(),
        follow_sent: false,
        conversation_status: "open",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "broker_id,customer_phone" }
    );

    // Repasse pro N8N — formato próprio (não emula o do Z-PRO). Em modo
    // sombra (Fase 4) ninguém deveria estar chamando esta rota ainda, então
    // isto só passa a valer de verdade na Fase 5, junto com o ajuste pontual
    // pedido no nó de gatilho do workflow "Padrao IA Z-pro" no N8N.
    if (N8N_WEBHOOK_URL) {
      fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "imobiflow_wpp_shim",
          broker_id: broker.id,
          customer_phone: customerPhone,
          message_id: messageId || null,
          text,
        }),
      }).catch((e) => console.warn("[WppShim] repasse pro N8N falhou:", e.message));
    }
  } catch (err: any) {
    console.error("[WppShim] erro em /inbound:", err.message);
  }
});

// ─── Conversas (leitura) — Fase 4 ───────────────────────────────────────────
wppShimRouter.get("/api/conversas", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: conversations, error: convError } = await supabase
      .from("followup_conversations")
      .select("customer_phone, ai_active, human_takeover_at, conversation_status, last_customer_message_at")
      .eq("broker_id", brokerId)
      .order("last_customer_message_at", { ascending: false });
    if (convError) throw convError;

    const { data: recentMessages } = await supabase
      .from("imf_conversation_messages")
      .select("customer_phone, body, sender_type, created_at")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false })
      .limit(200);

    const lastByPhone = new Map<string, { body: string | null; sender_type: string; created_at: string }>();
    for (const m of recentMessages || []) {
      if (!lastByPhone.has(m.customer_phone)) lastByPhone.set(m.customer_phone, m);
    }

    res.json((conversations || []).map((c: any) => ({
      customer_phone: c.customer_phone,
      ai_active: c.ai_active,
      conversation_status: c.conversation_status,
      last_message: lastByPhone.get(c.customer_phone)?.body || null,
      last_message_from: lastByPhone.get(c.customer_phone)?.sender_type || null,
      last_activity: c.last_customer_message_at,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/conversas:", err.message);
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.get("/api/conversas/:customerPhone/messages", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_conversation_messages")
      .select("id, direction, sender_type, body, media_url, media_type, created_at")
      .eq("broker_id", brokerId)
      .eq("customer_phone", req.params.customerPhone)
      .order("created_at", { ascending: true });
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    console.error("Erro GET /api/conversas/:phone/messages:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversas (escrita) — Fase 6 ───────────────────────────────────────────
// Corretor responde direto pela tela nova. Isso É o handover humano — não
// precisa mais do truque do ZWSP pra adivinhar quem mandou, porque o
// ImobiFlow sabe com certeza: quem chama esta rota é o corretor autenticado.
wppShimRouter.post("/api/conversas/:customerPhone/reply", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message é obrigatório." });

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("uazapi_instance_token")
      .eq("id", brokerId)
      .single();
    if (!broker?.uazapi_instance_token) {
      return res.status(503).json({ error: "Instância UAZAPI não configurada para este corretor ainda." });
    }

    const sent = await sendUazapiText(broker.uazapi_instance_token, req.params.customerPhone, message);
    if (!sent.ok) return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });

    await supabase.from("imf_conversation_messages").insert({
      broker_id: brokerId,
      customer_phone: req.params.customerPhone,
      direction: "out",
      sender_type: "broker_manual",
      body: message,
    });

    await pauseAiForHumanTakeover(brokerId, req.params.customerPhone);

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/:phone/reply:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Liga/desliga a IA manualmente pra uma conversa (independe de ter respondido ou não).
wppShimRouter.patch("/api/conversas/:customerPhone/ai-toggle", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { ai_active } = req.body || {};
    if (typeof ai_active !== "boolean") return res.status(400).json({ error: "ai_active (boolean) é obrigatório." });

    await supabase.from("followup_conversations").upsert({
      broker_id: brokerId,
      customer_phone: req.params.customerPhone,
      ai_active,
      human_takeover_at: ai_active ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_id,customer_phone" });

    res.json({ ok: true, ai_active });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:phone/ai-toggle:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Marca conversa como encerrada/reaberta — substitui a checagem "ticket aberto" do Z-PRO.
wppShimRouter.patch("/api/conversas/:customerPhone/status", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { conversation_status } = req.body || {};
    if (conversation_status !== "open" && conversation_status !== "closed") {
      return res.status(400).json({ error: "conversation_status deve ser 'open' ou 'closed'." });
    }

    await supabase.from("followup_conversations").upsert({
      broker_id: brokerId,
      customer_phone: req.params.customerPhone,
      conversation_status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_id,customer_phone" });

    res.json({ ok: true, conversation_status });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:phone/status:", err.message);
    res.status(500).json({ error: err.message });
  }
});
