import express from "express";
import { supabase } from "../supabase";
import { sendUazapiText, resolveOutboundInstanceToken } from "../services/wppShim";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";
import { N8N_WEBHOOK_URL, INTERNAL_PROXY_TOKEN } from "../config";
import { pauseAiForHumanTakeover } from "../services/followup";
import { fetchWithTimeout } from "../lib/http";

export const wppShimRouter = express.Router();

// Conversa não tem dono próprio (mensagem chega do cliente, não de um
// membro) — a visibilidade é derivada casando o telefone com o lead
// correspondente. Sem lead casando, só o dono da conta vê (evita expor
// conversa "órfã" pra qualquer membro antes de alguém assumir o contato).
async function memberPhoneOwnership(brokerId: string): Promise<Map<string, string>> {
  const { data: propIds } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
  const ids = (propIds || []).map((p: any) => p.id);
  if (!ids.length) return new Map();

  const { data: leadsData } = await supabase.from("leads").select("phone, owner_user_id").in("property_id", ids);
  const map = new Map<string, string>();
  for (const l of leadsData || []) {
    if (l.phone && l.owner_user_id) map.set(normalizePhoneBR(l.phone), l.owner_user_id);
  }
  return map;
}

async function canAccessConversation(userId: string, brokerId: string, customerPhone: string): Promise<boolean> {
  if (await isBrokerOwner(userId, brokerId)) return true;
  const map = await memberPhoneOwnership(brokerId);
  if (map.get(normalizePhoneBR(customerPhone)) === userId) return true;

  // Atendimento atribuído explicitamente (ver PATCH /:phone/assign) também dá acesso,
  // independente de lead casando — é assim que um ticket "pending" sem lead vira do membro.
  const { data } = await supabase
    .from("followup_conversations")
    .select("assigned_user_id")
    .eq("broker_id", brokerId)
    .eq("customer_phone", customerPhone)
    .maybeSingle();
  return data?.assigned_user_id === userId;
}

// ─── Disfarce do Z-PRO (Fase 2 do plano "Eliminar o Z-PRO") ────────────────
// Aceita o MESMO formato que o N8N usa pra mandar mensagem pelo Z-PRO —
// {body, number, externalKey, isClosed} + header "Authorization: Token X".
// Repontar imf_brokers.zpro_api_url pra esta rota migra o ENVIO de um
// corretor sem exigir nenhuma mudança no N8N.
// ⚠️ O cron de follow-up (server/services/followup.ts) NÃO usa mais esta
// rota — desde 2026-07-13 manda direto via sendUazapiText (nativo). Só o N8N
// ainda chama esta rota hoje; se isso também for migrado, ela vira candidata
// a remoção.
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

// [N8N] Resposta da IA de atendimento automático — envia via UAZAPI nativo
// (resolvendo a instância certa, inclusive WhatsApp por membro via
// resolveOutboundInstanceToken) e grava em imf_conversation_messages pra
// aparecer no Conversas do app. Substitui, pro fluxo nativo, o que
// /api/wpp-shim/external/:brokerKey fazia pro Z-PRO (enviar + persistir) —
// aquela rota exige zpro_api_key, que corretores provisionados nativamente
// nunca têm. Mesmo padrão de auth de /api/followup/inbound.
// Auth: Bearer INTERNAL_PROXY_TOKEN. Body: { broker_id, customer_phone, text }.
wppShimRouter.post("/api/wpp-shim/ai-reply", async (req, res) => {
  const auth = (req.headers["authorization"] || "").replace("Bearer ", "").trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    return res.status(401).json({ error: "Token inválido." });
  }
  try {
    const brokerId = String(req.body?.broker_id || "").trim();
    const text = String(req.body?.text || "").trim();
    const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || ""));
    if (!brokerId || !text || !customerPhone) {
      return res.status(400).json({ error: "broker_id, customer_phone e text são obrigatórios." });
    }

    const instanceToken = await resolveOutboundInstanceToken(brokerId, customerPhone);
    if (!instanceToken) {
      return res.status(503).json({ error: "Instância WhatsApp não configurada pra este corretor ainda." });
    }

    const sent = await sendUazapiText(instanceToken, customerPhone, text);

    await supabase.from("imf_conversation_messages").insert({
      broker_id: brokerId,
      customer_phone: customerPhone,
      direction: "out",
      sender_type: "ai",
      body: text,
    });

    if (!sent.ok) {
      console.warn(`[WppShim] envio de resposta da IA falhou pro broker ${brokerId}: status=${sent.status}`);
      return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[WppShim] erro em /ai-reply:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Entrada direto da UAZAPI (Fase 5) ──────────────────────────────────────
// Formato confirmado empiricamente em 09/07/2026 via webhook_logs (uazapiGO,
// evento de mensagem de texto real): req.body = { message: { text, content,
// chatid, fromMe, id, type }, chat: {...}, owner, token, EventType }. NÃO é o
// formato Baileys (data.key.remoteJid) nem o array messages[] de instâncias
// antigas — cada provedor UAZAPI parece variar. Outros tipos de evento
// (ReadReceipt, sincronização de chat sem "message") caem no
// `if (!message) return` abaixo, sem erro.
wppShimRouter.post("/api/wpp-shim/inbound/:instanceId", async (req, res) => {
  // Responde rápido sempre — nunca perder mensagem por causa de um erro de
  // interpretação de payload ou de uma falha ao repassar pro N8N.
  res.status(200).json({ ok: true });

  try {
    await supabase.from("webhook_logs").insert({
      source: "uazapi",
      event_type: req.body?.EventType || req.body?.event || req.body?.type || "unknown",
      payload: { instance_id: req.params.instanceId, body: req.body },
      status: "received",
    });

    // Resolve a instância — primeiro tenta a instância COMPARTILHADA da
    // conta (imf_brokers), senão tenta a instância PRÓPRIA de um membro da
    // equipe (imf_broker_members.whatsapp_mode='own', ver migração
    // 20260713_member_whatsapp.sql). instanceOwnerUserId só fica setado no
    // segundo caso — é isso que faz a resposta sair pela instância certa
    // (ver resolveOutboundInstanceToken em server/services/wppShim.ts).
    let brokerId: string | null = null;
    let instanceToken: string | null = null;
    let instanceOwnerUserId: string | null = null;

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("id, uazapi_instance_token")
      .eq("uazapi_instance_id", req.params.instanceId)
      .maybeSingle();

    if (broker) {
      brokerId = broker.id;
      instanceToken = broker.uazapi_instance_token;
    } else {
      const { data: member } = await supabase
        .from("imf_broker_members")
        .select("broker_id, user_id, uazapi_instance_token")
        .eq("uazapi_instance_id", req.params.instanceId)
        .maybeSingle();
      if (member) {
        brokerId = member.broker_id;
        instanceToken = member.uazapi_instance_token;
        instanceOwnerUserId = member.user_id;
      }
    }

    // A UAZAPI ecoa o token da própria instância em body.token em todo evento
    // (confirmado empiricamente contra webhook_logs reais) — só quem já tem
    // esse token (a UAZAPI, ou alguém que já comprometeu essa instância
    // especificamente) consegue produzir um match. Sem isso, :instanceId
    // sozinho não é segredo — dava pra injetar mensagem "de cliente" falsa ou
    // acionar a IA a mandar WhatsApp real em nome de qualquer corretor/membro.
    if (!brokerId || !instanceToken || req.body?.token !== instanceToken) return;

    const message = req.body?.message;
    if (!message) return; // evento sem mensagem (recibo de leitura, sync de chat, etc.)

    const fromMe: boolean = !!message.fromMe;
    const messageId: string | undefined = message.id;
    const text: string | undefined = message.text || message.content;
    // chatid vem como "556294381279@s.whatsapp.net" — "sender" costuma ser o
    // "@lid" (identificador interno da UAZAPI, não o telefone de verdade).
    const rawPhone: string | undefined = message.chatid;

    if (!rawPhone || fromMe || !text || message.type !== "text") return; // sem dado suficiente, eco da própria IA, ou mídia (ainda não suportada)
    const customerPhone = normalizePhoneBR(rawPhone);
    if (!customerPhone) return;

    await supabase.from("imf_conversation_messages").insert({
      broker_id: brokerId,
      customer_phone: customerPhone,
      direction: "in",
      sender_type: "customer",
      body: text,
      provider_message_id: messageId || null,
    });

    // Contato automático: primeira mensagem real de um número novo já cria
    // o contato salvo, usando o "pushName" que a UAZAPI manda em todo
    // evento (chat.wa_contactName/wa_name = nome do WhatsApp da pessoa;
    // message.senderName é o fallback mais simples). DO NOTHING no
    // conflito — nunca sobrescreve um nome que o corretor já tenha
    // editado manualmente na tela de Contatos.
    const chatMeta = req.body?.chat;
    const pushName: string =
      chatMeta?.wa_contactName || chatMeta?.wa_name || message.senderName || customerPhone;
    await supabase.from("imf_contacts").upsert(
      { broker_id: brokerId, phone: customerPhone, name: pushName },
      { onConflict: "broker_id,phone", ignoreDuplicates: true }
    );

    // Novo ticket nasce "pending" (aguardando alguém puxar), igual ao Z-PRO.
    // Reabre pra "pending" se estava fechado; se já tá pending/open, não mexe
    // no status (senão toda mensagem nova reabriria um atendimento em curso).
    const { data: existing } = await supabase
      .from("followup_conversations")
      .select("conversation_status")
      .eq("broker_id", brokerId)
      .eq("customer_phone", customerPhone)
      .maybeSingle();
    const nextStatus = !existing || existing.conversation_status === "closed" ? "pending" : existing.conversation_status;

    await supabase.from("followup_conversations").upsert(
      {
        broker_id: brokerId,
        customer_phone: customerPhone,
        last_customer_message_at: new Date().toISOString(),
        follow_sent: false,
        conversation_status: nextStatus,
        // Reflete sempre a instância do ÚLTIMO inbound: null = compartilhada
        // da conta, setado = própria de um membro. É o que
        // resolveOutboundInstanceToken usa pra decidir por onde a resposta sai.
        instance_owner_user_id: instanceOwnerUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "broker_id,customer_phone" }
    );

    // Repasse pro N8N — formato próprio (não emula o do Z-PRO), consumido
    // pelo workflow de teste "Teste-v2 imob" (Fase 5).
    if (N8N_WEBHOOK_URL) {
      fetchWithTimeout(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "imobiflow_wpp_shim",
          broker_id: brokerId,
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
      .select("customer_phone, ai_active, human_takeover_at, conversation_status, queue_id, assigned_user_id, last_customer_message_at")
      .eq("broker_id", brokerId)
      .order("last_customer_message_at", { ascending: false });
    if (convError) throw convError;

    // Isolamento por membro: dono vê todas as conversas; membro vê as que
    // batem com um lead que ele possui OU que foram atribuídas a ele direto.
    let visibleConversations = conversations || [];
    if (!(await isBrokerOwner(userId, brokerId))) {
      const ownership = await memberPhoneOwnership(brokerId);
      visibleConversations = visibleConversations.filter((c: any) =>
        ownership.get(normalizePhoneBR(c.customer_phone)) === userId || c.assigned_user_id === userId
      );
    }

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

    const { data: tagLinks } = await supabase
      .from("imf_conversation_tag_links")
      .select("customer_phone, imf_conversation_tags(id, name, color)")
      .eq("broker_id", brokerId);
    const tagsByPhone = new Map<string, { id: string; name: string; color: string | null }[]>();
    for (const t of tagLinks || []) {
      const tag = (t as any).imf_conversation_tags;
      if (!tag) continue;
      const list = tagsByPhone.get((t as any).customer_phone) || [];
      list.push(tag);
      tagsByPhone.set((t as any).customer_phone, list);
    }

    res.json(visibleConversations.map((c: any) => ({
      customer_phone: c.customer_phone,
      ai_active: c.ai_active,
      conversation_status: c.conversation_status,
      queue_id: c.queue_id,
      assigned_user_id: c.assigned_user_id,
      tags: tagsByPhone.get(c.customer_phone) || [],
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
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const requestedLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return res.status(400).json({ error: "limit deve ser um inteiro entre 1 e 100." });
    }
    const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
    if (req.query.before !== undefined && (!before || Number.isNaN(before.getTime()))) {
      return res.status(400).json({ error: "before deve ser uma data ISO válida." });
    }

    let query = supabase
      .from("imf_conversation_messages")
      .select("id, direction, sender_type, body, media_url, media_type, created_at")
      .eq("broker_id", brokerId)
      .eq("customer_phone", req.params.customerPhone);
    if (before) query = query.lt("created_at", before.toISOString());
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(requestedLimit + 1);
    if (error) throw error;

    const rows = data || [];
    const hasMore = rows.length > requestedLimit;
    const page = rows.slice(0, requestedLimit).reverse();
    res.setHeader("X-Has-More", String(hasMore));
    res.setHeader("X-Next-Cursor", page[0]?.created_at || "");
    res.json(page);
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
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message é obrigatório." });

    // Resolve pela instância própria do membro se a conversa entrou por ela
    // (ver resolveOutboundInstanceToken), senão cai pra instância da conta.
    const instanceToken = await resolveOutboundInstanceToken(brokerId, req.params.customerPhone);
    if (!instanceToken) {
      return res.status(503).json({ error: "Instância UAZAPI não configurada para este corretor ainda." });
    }

    const sent = await sendUazapiText(instanceToken, req.params.customerPhone, message);
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
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

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
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { conversation_status } = req.body || {};
    if (!["pending", "open", "closed"].includes(conversation_status)) {
      return res.status(400).json({ error: "conversation_status deve ser 'pending', 'open' ou 'closed'." });
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

// Atribui (ou remove, com user_id: null) o atendimento a um membro específico —
// inspirado no "userId" do SetTicketInfo do Z-PRO. Dá acesso à conversa mesmo
// sem lead casando (ver canAccessConversation), então só o dono ou quem já
// acessa a conversa pode atribuir — evita um membro "roubar" ticket alheio às cegas.
wppShimRouter.patch("/api/conversas/:customerPhone/assign", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { user_id } = req.body || {};
    if (user_id !== null && typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id deve ser string ou null." });
    }

    if (user_id) {
      const { data: member } = await supabase
        .from("imf_broker_members")
        .select("user_id")
        .eq("broker_id", brokerId)
        .eq("user_id", user_id)
        .maybeSingle();
      if (!member) return res.status(400).json({ error: "Usuário não é membro desta conta." });
    }

    await supabase.from("followup_conversations").upsert({
      broker_id: brokerId,
      customer_phone: req.params.customerPhone,
      assigned_user_id: user_id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_id,customer_phone" });

    res.json({ ok: true, assigned_user_id: user_id });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:phone/assign:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Move a conversa pra uma fila (ou tira, com queue_id: null) — inspirado no queueId do Z-PRO.
wppShimRouter.patch("/api/conversas/:customerPhone/queue", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { queue_id } = req.body || {};
    if (queue_id !== null && typeof queue_id !== "string") {
      return res.status(400).json({ error: "queue_id deve ser string ou null." });
    }

    if (queue_id) {
      const { data: queue } = await supabase.from("imf_queues").select("id").eq("id", queue_id).eq("broker_id", brokerId).maybeSingle();
      if (!queue) return res.status(400).json({ error: "Fila não encontrada." });
    }

    await supabase.from("followup_conversations").upsert({
      broker_id: brokerId,
      customer_phone: req.params.customerPhone,
      queue_id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_id,customer_phone" });

    res.json({ ok: true, queue_id });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:phone/queue:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apaga a conversa inteira (mensagens, tags, notas e o estado do ticket) —
// exclusão de verdade, não é o mesmo que marcar "encerrado" em /status.
wppShimRouter.delete("/api/conversas/:customerPhone", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const phone = req.params.customerPhone;
    await supabase.from("imf_conversation_messages").delete().eq("broker_id", brokerId).eq("customer_phone", phone);
    await supabase.from("imf_conversation_tag_links").delete().eq("broker_id", brokerId).eq("customer_phone", phone);
    await supabase.from("imf_conversation_notes").delete().eq("broker_id", brokerId).eq("customer_phone", phone);
    const { error } = await supabase.from("followup_conversations").delete().eq("broker_id", brokerId).eq("customer_phone", phone);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/conversas/:phone:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Filas ──────────────────────────────────────────────────────────────────
wppShimRouter.get("/api/conversas/queues", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    const { data, error } = await supabase.from("imf_queues").select("*").eq("broker_id", brokerId).order("created_at", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/queues", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const { name, color } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name é obrigatório." });

    const { data, error } = await supabase.from("imf_queues").insert({ broker_id: brokerId, name: name.trim(), color: color || null }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.delete("/api/conversas/queues/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const { error } = await supabase.from("imf_queues").delete().eq("id", req.params.id).eq("broker_id", brokerId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tags ───────────────────────────────────────────────────────────────────
wppShimRouter.get("/api/conversas/tags", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    const { data, error } = await supabase.from("imf_conversation_tags").select("*").eq("broker_id", brokerId).order("name", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/tags", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const { name, color } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "name é obrigatório." });

    const { data, error } = await supabase
      .from("imf_conversation_tags")
      .upsert({ broker_id: brokerId, name: name.trim(), color: color || null }, { onConflict: "broker_id,name" })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/:customerPhone/tags", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { tag_id } = req.body || {};
    if (!tag_id) return res.status(400).json({ error: "tag_id é obrigatório." });

    const { error } = await supabase
      .from("imf_conversation_tag_links")
      .upsert({ broker_id: brokerId, customer_phone: req.params.customerPhone, tag_id }, { onConflict: "broker_id,customer_phone,tag_id" });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.delete("/api/conversas/:customerPhone/tags/:tagId", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { error } = await supabase
      .from("imf_conversation_tag_links")
      .delete()
      .eq("broker_id", brokerId)
      .eq("customer_phone", req.params.customerPhone)
      .eq("tag_id", req.params.tagId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notas internas ─────────────────────────────────────────────────────────
wppShimRouter.get("/api/conversas/:customerPhone/notes", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { data, error } = await supabase
      .from("imf_conversation_notes")
      .select("id, body, user_id, created_at")
      .eq("broker_id", brokerId)
      .eq("customer_phone", req.params.customerPhone)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/:customerPhone/notes", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessConversation(userId, brokerId, req.params.customerPhone))) return res.status(403).json({ error: "Acesso negado." });

    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: "body é obrigatório." });

    const { data, error } = await supabase
      .from("imf_conversation_notes")
      .insert({ broker_id: brokerId, customer_phone: req.params.customerPhone, user_id: userId, body: body.trim() })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Abre uma conversa nova por iniciativa do corretor (equivalente ao CreateTicket
// do Z-PRO) — hoje só existia responder o que já chegou. IA começa desligada:
// quem abriu manualmente está assumindo o atendimento, não faz sentido a IA
// entrar no meio de uma conversa que um humano decidiu começar.
wppShimRouter.post("/api/conversas/create", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { phone, message } = req.body || {};
    const cleanPhone = normalizePhoneBR(phone || "");
    if (!cleanPhone) return res.status(400).json({ error: "phone inválido." });
    if (!message?.trim()) return res.status(400).json({ error: "message é obrigatório." });

    const instanceToken = await resolveOutboundInstanceToken(brokerId, cleanPhone);
    if (!instanceToken) return res.status(503).json({ error: "Instância UAZAPI não configurada para este corretor ainda." });

    const sent = await sendUazapiText(instanceToken, cleanPhone, message);
    if (!sent.ok) return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });

    await supabase.from("imf_conversation_messages").insert({
      broker_id: brokerId,
      customer_phone: cleanPhone,
      direction: "out",
      sender_type: "broker_manual",
      body: message,
    });

    await supabase.from("followup_conversations").upsert({
      broker_id: brokerId,
      customer_phone: cleanPhone,
      conversation_status: "open",
      ai_active: false,
      assigned_user_id: userId,
      human_takeover_at: new Date().toISOString(),
      last_customer_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_id,customer_phone" });

    res.status(201).json({ ok: true, customer_phone: cleanPhone });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/create:", err.message);
    res.status(500).json({ error: err.message });
  }
});
