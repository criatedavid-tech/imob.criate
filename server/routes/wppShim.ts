import express from "express";
import { supabase } from "../supabase";
import { sendUazapiText, resolveOutboundInstanceToken } from "../services/wppShim";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";
import { N8N_WEBHOOK_URL, INTERNAL_PROXY_TOKEN } from "../config";
import { pauseAiForHumanTakeover } from "../services/followup";
import { fetchWithTimeout } from "../lib/http";
import {
  ensureConversationTicket,
  getConversationTicket,
  recordConversationMessage,
} from "../services/conversationTickets";
import { resolveNewLeadStage } from "../services/crmPipelines";
import { resolveInboundMedia } from "../services/inboundMedia";

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

async function canAccessTicket(userId: string, brokerId: string, ticketId: string): Promise<boolean> {
  const ticket = await getConversationTicket(brokerId, ticketId);
  if (!ticket) return false;
  if (await isBrokerOwner(userId, brokerId)) return true;
  const ownership = await memberPhoneOwnership(brokerId);
  return ownership.get(normalizePhoneBR(ticket.customer_phone)) === userId
    || ticket.assigned_user_id === userId;
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

    if (!sent.ok) {
      console.warn(`[WppShim] envio falhou pra broker ${broker.id}: status=${sent.status}`);
      return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });
    }

    await recordConversationMessage({
      brokerId: broker.id,
      customerPhone: normalizePhoneBR(number),
      direction: "out",
      senderType: "ai",
      body: cleanText,
      initialStatus: "open",
    });

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
// Auth: Bearer INTERNAL_PROXY_TOKEN.
// Body: { broker_id, customer_phone, text, ticket_id? }.
wppShimRouter.post("/api/wpp-shim/ai-reply", async (req, res) => {
  const auth = (req.headers["authorization"] || "").replace("Bearer ", "").trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    return res.status(401).json({ error: "Token inválido." });
  }
  try {
    const brokerId = String(req.body?.broker_id || "").trim();
    const text = String(req.body?.text || "").trim();
    const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || ""));
    const ticketId = String(req.body?.ticket_id || "").trim() || undefined;
    if (!brokerId || !text || !customerPhone) {
      return res.status(400).json({ error: "broker_id, customer_phone e text são obrigatórios." });
    }

    const ticket = ticketId
      ? await getConversationTicket(brokerId, ticketId)
      : await ensureConversationTicket({
          brokerId,
          customerPhone,
          initialStatus: "open",
        });
    if (!ticket || ticket.customer_phone !== customerPhone) {
      return res.status(400).json({ error: "Ticket de conversa inválido." });
    }
    if (ticket.conversation_status === "closed" || !ticket.ai_active) {
      return res.status(409).json({ error: "Ticket encerrado ou com atendimento humano ativo." });
    }

    const instanceToken = await resolveOutboundInstanceToken(brokerId, customerPhone);
    if (!instanceToken) {
      return res.status(503).json({ error: "Instância WhatsApp não configurada pra este corretor ainda." });
    }

    const sent = await sendUazapiText(instanceToken, customerPhone, text);

    if (!sent.ok) {
      console.warn(`[WppShim] envio de resposta da IA falhou pro broker ${brokerId}: status=${sent.status}`);
      return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });
    }

    await recordConversationMessage({
      brokerId,
      customerPhone,
      ticketId: ticket.id,
      direction: "out",
      senderType: "ai",
      body: text,
      initialStatus: "open",
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[WppShim] erro em /ai-reply:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Entrada direto da UAZAPI (Fase 5) ──────────────────────────────────────
// Formato confirmado empiricamente em 09/07/2026 via webhook_logs (uazapiGO,
// evento de mensagem real): req.body = { message: { text, content, chatid,
// fromMe, id, type, mediaType, messageType }, chat: {...}, owner, token,
// EventType }. Texto chega como type="text"; áudio e imagem chegam como
// type="media", diferenciados por mediaType (ptt/image). NÃO é o
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
    const plainText = typeof message.text === "string" && message.text.trim()
      ? message.text.trim()
      : typeof message.content === "string"
        ? message.content.trim()
        : "";
    // chatid vem como "556294381279@s.whatsapp.net" — "sender" costuma ser o
    // "@lid" (identificador interno da UAZAPI, não o telefone de verdade).
    const rawPhone: string | undefined = message.chatid;

    if (!rawPhone || fromMe) return; // sem telefone suficiente ou eco da própria IA
    const customerPhone = normalizePhoneBR(rawPhone);
    if (!customerPhone) return;

    // O provedor pode reenviar o mesmo webhook. Evita transcrever/descrever de
    // novo (e evita novo repasse ao N8N) quando a mensagem já foi persistida.
    if (messageId) {
      const { data: existingMessage, error: existingError } = await supabase
        .from("imf_conversation_messages")
        .select("id")
        .eq("broker_id", brokerId)
        .eq("provider_message_id", messageId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingMessage) return;
    }

    let agentText = plainText;
    let storedBody = plainText;
    let inboundMediaType: string | null = null;
    if (message.type === "text") {
      if (!plainText) return;
    } else if (message.type === "media") {
      if (message.isGroup) return; // evita custo/automação em grupos; atendimento é individual
      const media = await resolveInboundMedia(message, instanceToken);
      if (!media) return; // vídeo/documento/sticker ainda não fazem parte deste fluxo
      agentText = media.agentText;
      storedBody = media.storedBody;
      inboundMediaType = media.mediaType;
    } else {
      return;
    }

    const activityAt = new Date().toISOString();
    const ticket = await ensureConversationTicket({
      brokerId,
      customerPhone,
      initialStatus: "pending",
      aiActive: true,
      instanceOwnerUserId,
      lastActivityAt: activityAt,
    });

    await recordConversationMessage({
      brokerId,
      customerPhone,
      ticketId: ticket.id,
      direction: "in",
      senderType: "customer",
      body: storedBody,
      mediaType: inboundMediaType,
      providerMessageId: messageId || null,
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

    // followup_conversations permanece como ponte operacional do ticket ATIVO.
    // Se o anterior estava encerrado, ensureConversationTicket criou outro UUID.
    await supabase.from("followup_conversations").update({
      ticket_id: ticket.id,
      last_customer_message_at: activityAt,
      follow_sent: false,
      instance_owner_user_id: instanceOwnerUserId,
      updated_at: activityAt,
    }).eq("broker_id", brokerId).eq("customer_phone", customerPhone);

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
          ticket_id: ticket.id,
          text: agentText,
          input_type: inboundMediaType || "text",
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
      .from("imf_conversation_tickets")
      .select("id, customer_phone, ai_active, human_takeover_at, conversation_status, queue_id, assigned_user_id, opened_at, closed_at, last_activity_at")
      .eq("broker_id", brokerId)
      .order("last_activity_at", { ascending: false })
      .limit(500);
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

    const visibleTicketIds = visibleConversations.map((c: any) => c.id);
    const { data: recentMessages } = visibleTicketIds.length
      ? await supabase
          .from("imf_conversation_messages")
          .select("ticket_id, body, sender_type, created_at")
          .eq("broker_id", brokerId)
          .in("ticket_id", visibleTicketIds)
          .order("created_at", { ascending: false })
          .limit(1000)
      : { data: [] as any[] };

    const lastByTicket = new Map<string, { body: string | null; sender_type: string; created_at: string }>();
    for (const m of recentMessages || []) {
      if (m.ticket_id && !lastByTicket.has(m.ticket_id)) lastByTicket.set(m.ticket_id, m);
    }

    const { data: tagLinks } = visibleTicketIds.length
      ? await supabase
          .from("imf_conversation_tag_links")
          .select("ticket_id, imf_conversation_tags(id, name, color)")
          .eq("broker_id", brokerId)
          .in("ticket_id", visibleTicketIds)
      : { data: [] as any[] };
    const tagsByTicket = new Map<string, { id: string; name: string; color: string | null }[]>();
    for (const t of tagLinks || []) {
      const tag = (t as any).imf_conversation_tags;
      if (!tag) continue;
      const list = tagsByTicket.get((t as any).ticket_id) || [];
      list.push(tag);
      tagsByTicket.set((t as any).ticket_id, list);
    }

    // Nome salvo em Contatos (auto-criado no primeiro inbound com o pushName
    // do WhatsApp, ou editado manualmente) — sem isso a lista só mostra o
    // telefone cru.
    const phones = Array.from(new Set(visibleConversations.map((c: any) => c.customer_phone)));
    const { data: contactRows } = phones.length
      ? await supabase.from("imf_contacts").select("phone, name").eq("broker_id", brokerId).in("phone", phones)
      : { data: [] as any[] };
    const nameByPhone = new Map<string, string>();
    for (const c of contactRows || []) if (c.name) nameByPhone.set(c.phone, c.name);

    res.json(visibleConversations.map((c: any) => ({
      id: c.id,
      ticket_id: c.id,
      customer_phone: c.customer_phone,
      contact_name: nameByPhone.get(c.customer_phone) || null,
      ai_active: c.ai_active,
      conversation_status: c.conversation_status,
      queue_id: c.queue_id,
      assigned_user_id: c.assigned_user_id,
      tags: tagsByTicket.get(c.id) || [],
      last_message: lastByTicket.get(c.id)?.body || null,
      last_message_from: lastByTicket.get(c.id)?.sender_type || null,
      last_activity: c.last_activity_at,
      opened_at: c.opened_at,
      closed_at: c.closed_at,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/conversas:", err.message);
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.get("/api/conversas/:ticketId/messages", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    if (!(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

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
      .eq("ticket_id", req.params.ticketId);
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
    console.error("Erro GET /api/conversas/:ticketId/messages:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversas (escrita) — Fase 6 ───────────────────────────────────────────
// Corretor responde direto pela tela nova. Isso É o handover humano — não
// precisa mais do truque do ZWSP pra adivinhar quem mandou, porque o
// ImobiFlow sabe com certeza: quem chama esta rota é o corretor autenticado.
wppShimRouter.post("/api/conversas/:ticketId/reply", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });
    if (ticket.conversation_status === "closed") {
      return res.status(409).json({ error: "Este ticket está encerrado. Uma nova mensagem do cliente abrirá outro ticket." });
    }

    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: "message é obrigatório." });

    // Resolve pela instância própria do membro se a conversa entrou por ela
    // (ver resolveOutboundInstanceToken), senão cai pra instância da conta.
    const instanceToken = await resolveOutboundInstanceToken(brokerId, ticket.customer_phone);
    if (!instanceToken) {
      return res.status(503).json({ error: "Instância UAZAPI não configurada para este corretor ainda." });
    }

    const sent = await sendUazapiText(instanceToken, ticket.customer_phone, message);
    if (!sent.ok) return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });

    await recordConversationMessage({
      brokerId,
      customerPhone: ticket.customer_phone,
      ticketId: ticket.id,
      direction: "out",
      senderType: "broker_manual",
      body: message,
    });

    await pauseAiForHumanTakeover(brokerId, ticket.customer_phone);
    await supabase.from("imf_conversation_tickets").update({
      ai_active: false,
      human_takeover_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", ticket.id).eq("broker_id", brokerId);

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/:ticketId/reply:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Liga/desliga a IA manualmente pra uma conversa (independe de ter respondido ou não).
wppShimRouter.patch("/api/conversas/:ticketId/ai-toggle", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });
    if (ticket.conversation_status === "closed") return res.status(409).json({ error: "Ticket encerrado é imutável." });

    const { ai_active } = req.body || {};
    if (typeof ai_active !== "boolean") return res.status(400).json({ error: "ai_active (boolean) é obrigatório." });

    const updatedAt = new Date().toISOString();
    await supabase.from("imf_conversation_tickets").update({
      ai_active,
      human_takeover_at: ai_active ? null : updatedAt,
      updated_at: updatedAt,
    }).eq("id", ticket.id).eq("broker_id", brokerId);
    await supabase.from("followup_conversations").update({
      ai_active,
      human_takeover_at: ai_active ? null : updatedAt,
      updated_at: updatedAt,
    }).eq("broker_id", brokerId).eq("ticket_id", ticket.id);

    res.json({ ok: true, ai_active });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:ticketId/ai-toggle:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Marca conversa como encerrada/reaberta — substitui a checagem "ticket aberto" do Z-PRO.
wppShimRouter.patch("/api/conversas/:ticketId/status", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { conversation_status } = req.body || {};
    if (!["pending", "open", "closed"].includes(conversation_status)) {
      return res.status(400).json({ error: "conversation_status deve ser 'pending', 'open' ou 'closed'." });
    }

    if (ticket.conversation_status === "closed" && conversation_status !== "closed") {
      return res.status(409).json({ error: "Ticket encerrado é imutável. Uma nova interação deve abrir outro ticket." });
    }

    if (conversation_status !== "closed") {
      const { data: anotherActive } = await supabase
        .from("imf_conversation_tickets")
        .select("id")
        .eq("broker_id", brokerId)
        .eq("customer_phone", ticket.customer_phone)
        .in("conversation_status", ["pending", "open"])
        .neq("id", ticket.id)
        .limit(1)
        .maybeSingle();
      if (anotherActive) {
        return res.status(409).json({ error: "Já existe outro ticket ativo para este telefone." });
      }
    }

    const updatedAt = new Date().toISOString();
    const { error: ticketError } = await supabase.from("imf_conversation_tickets").update({
      conversation_status,
      closed_at: conversation_status === "closed" ? updatedAt : null,
      updated_at: updatedAt,
    }).eq("id", ticket.id).eq("broker_id", brokerId);
    if (ticketError) throw ticketError;

    if (conversation_status === "closed") {
      await supabase.from("followup_conversations").update({
        conversation_status: "closed",
        follow_sent: true,
        updated_at: updatedAt,
      }).eq("broker_id", brokerId).eq("ticket_id", ticket.id);
    } else {
      await supabase.from("followup_conversations").upsert({
        broker_id: brokerId,
        customer_phone: ticket.customer_phone,
        ticket_id: ticket.id,
        conversation_status,
        ai_active: ticket.ai_active,
        assigned_user_id: ticket.assigned_user_id,
        queue_id: ticket.queue_id,
        instance_owner_user_id: ticket.instance_owner_user_id,
        updated_at: updatedAt,
      }, { onConflict: "broker_id,customer_phone" });
    }

    res.json({ ok: true, conversation_status });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:ticketId/status:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Atribui (ou remove, com user_id: null) o atendimento a um membro específico —
// inspirado no "userId" do SetTicketInfo do Z-PRO. Dá acesso à conversa mesmo
// sem lead casando (ver canAccessTicket), então só o dono ou quem já
// acessa a conversa pode atribuir — evita um membro "roubar" ticket alheio às cegas.
wppShimRouter.patch("/api/conversas/:ticketId/assign", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

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

    const updatedAt = new Date().toISOString();
    await supabase.from("imf_conversation_tickets").update({
      assigned_user_id: user_id,
      updated_at: updatedAt,
    }).eq("id", ticket.id).eq("broker_id", brokerId);
    await supabase.from("followup_conversations").update({
      assigned_user_id: user_id,
      updated_at: updatedAt,
    }).eq("broker_id", brokerId).eq("ticket_id", ticket.id);

    res.json({ ok: true, assigned_user_id: user_id });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:ticketId/assign:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Move a conversa pra uma fila (ou tira, com queue_id: null) — inspirado no queueId do Z-PRO.
wppShimRouter.patch("/api/conversas/:ticketId/queue", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { queue_id } = req.body || {};
    if (queue_id !== null && typeof queue_id !== "string") {
      return res.status(400).json({ error: "queue_id deve ser string ou null." });
    }

    if (queue_id) {
      const { data: queue } = await supabase.from("imf_queues").select("id").eq("id", queue_id).eq("broker_id", brokerId).maybeSingle();
      if (!queue) return res.status(400).json({ error: "Fila não encontrada." });
    }

    const updatedAt = new Date().toISOString();
    await supabase.from("imf_conversation_tickets").update({
      queue_id,
      updated_at: updatedAt,
    }).eq("id", ticket.id).eq("broker_id", brokerId);
    await supabase.from("followup_conversations").update({
      queue_id,
      updated_at: updatedAt,
    }).eq("broker_id", brokerId).eq("ticket_id", ticket.id);

    res.json({ ok: true, queue_id });
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/:ticketId/queue:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apaga o ticket inteiro (mensagens, tags, notas e o próprio ticket) —
// exclusão de verdade de UM ciclo de atendimento, não é o mesmo que encerrar
// em /status. Se for o ticket ativo (ponte em followup_conversations), a
// ponte some junto; a próxima mensagem do cliente cria um ciclo novo normalmente.
wppShimRouter.delete("/api/conversas/:ticketId", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    await supabase.from("imf_conversation_messages").delete().eq("broker_id", brokerId).eq("ticket_id", ticket.id);
    await supabase.from("imf_conversation_tag_links").delete().eq("broker_id", brokerId).eq("ticket_id", ticket.id);
    await supabase.from("imf_conversation_notes").delete().eq("broker_id", brokerId).eq("ticket_id", ticket.id);
    await supabase.from("followup_conversations").delete().eq("broker_id", brokerId).eq("ticket_id", ticket.id);
    const { error } = await supabase.from("imf_conversation_tickets").delete().eq("id", ticket.id).eq("broker_id", brokerId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/conversas/:ticketId:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cria um lead a partir do contato da conversa, reaproveitando nome (Contatos,
// auto-salvo no primeiro inbound) e telefone — sem imóvel de interesse ainda
// (property_id null, escopado direto por broker_id). Idempotente: se já
// existir um lead com esse telefone nesta conta (desse fluxo ou do
// tradicional preso a um imóvel), devolve o existente em vez de duplicar.
wppShimRouter.post("/api/conversas/:ticketId/create-lead", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const phone = ticket.customer_phone;

    const { data: propRows } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const propIds = (propRows || []).map((p: any) => p.id);
    let dedupeQuery = supabase.from("leads").select("*").eq("phone", phone);
    dedupeQuery = propIds.length > 0
      ? dedupeQuery.or(`broker_id.eq.${brokerId},property_id.in.(${propIds.join(",")})`)
      : dedupeQuery.eq("broker_id", brokerId);
    const { data: existingRows } = await dedupeQuery.limit(1);
    if (existingRows && existingRows.length > 0) {
      return res.json({ lead: existingRows[0], already_existed: true });
    }

    const { data: contact } = await supabase.from("imf_contacts").select("name").eq("broker_id", brokerId).eq("phone", phone).maybeSingle();
    const name = contact?.name || phone;

    const { pipeline_id, pipeline_stage_id } = await resolveNewLeadStage(brokerId);
    const { data: lead, error } = await supabase.from("leads").insert({
      broker_id: brokerId,
      property_id: null,
      name,
      phone,
      status: "new",
      owner_user_id: userId,
      notes: "Lead criado a partir de uma conversa",
      pipeline_id,
      pipeline_stage_id,
    }).select().single();
    if (error) throw error;

    res.status(201).json({ lead, already_existed: false });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/:ticketId/create-lead:", err.message);
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

wppShimRouter.patch("/api/conversas/tags/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const updates: Record<string, any> = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "name não pode ser vazio." });
      updates.name = name;
    }
    if (req.body?.color !== undefined) updates.color = req.body.color || null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nada para atualizar." });

    const { data, error } = await supabase
      .from("imf_conversation_tags")
      .update(updates)
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .select()
      .maybeSingle();
    if (error) {
      if ((error as any).code === "23505") return res.status(400).json({ error: "Já existe uma tag com esse nome." });
      throw error;
    }
    if (!data) return res.status(404).json({ error: "Tag não encontrada." });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/conversas/tags/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apaga a tag pra conta inteira — os vínculos em imf_conversation_tag_links
// somem em cascata (FK ON DELETE CASCADE), não precisa limpar manualmente.
wppShimRouter.delete("/api/conversas/tags/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { data, error } = await supabase
      .from("imf_conversation_tags")
      .delete()
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Tag não encontrada." });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/conversas/tags/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/:ticketId/tags", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { tag_id } = req.body || {};
    if (!tag_id) return res.status(400).json({ error: "tag_id é obrigatório." });

    const { data: tag } = await supabase
      .from("imf_conversation_tags")
      .select("id")
      .eq("id", tag_id)
      .eq("broker_id", brokerId)
      .maybeSingle();
    if (!tag) return res.status(400).json({ error: "Tag não encontrada nesta conta." });

    const { error } = await supabase
      .from("imf_conversation_tag_links")
      .upsert({ broker_id: brokerId, customer_phone: ticket.customer_phone, ticket_id: ticket.id, tag_id }, { onConflict: "ticket_id,tag_id" });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.delete("/api/conversas/:ticketId/tags/:tagId", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { error } = await supabase
      .from("imf_conversation_tag_links")
      .delete()
      .eq("broker_id", brokerId)
      .eq("ticket_id", req.params.ticketId)
      .eq("tag_id", req.params.tagId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notas internas ─────────────────────────────────────────────────────────
wppShimRouter.get("/api/conversas/:ticketId/notes", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);
    if (!(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { data, error } = await supabase
      .from("imf_conversation_notes")
      .select("id, body, user_id, created_at")
      .eq("broker_id", brokerId)
      .eq("ticket_id", req.params.ticketId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wppShimRouter.post("/api/conversas/:ticketId/notes", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: "body é obrigatório." });

    const { data, error } = await supabase
      .from("imf_conversation_notes")
      .insert({ broker_id: brokerId, customer_phone: ticket.customer_phone, ticket_id: ticket.id, user_id: userId, body: body.trim() })
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

    const ticket = await ensureConversationTicket({
      brokerId,
      customerPhone: cleanPhone,
      initialStatus: "open",
      aiActive: false,
      assignedUserId: userId,
    });

    await recordConversationMessage({
      brokerId,
      customerPhone: cleanPhone,
      ticketId: ticket.id,
      direction: "out",
      senderType: "broker_manual",
      body: message,
    });

    const updatedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("imf_conversation_tickets").update({
        ai_active: false,
        assigned_user_id: userId,
        human_takeover_at: updatedAt,
        last_activity_at: updatedAt,
        updated_at: updatedAt,
      }).eq("id", ticket.id).eq("broker_id", brokerId),
      supabase.from("followup_conversations").update({
        ticket_id: ticket.id,
        conversation_status: "open",
        ai_active: false,
        assigned_user_id: userId,
        human_takeover_at: updatedAt,
        last_customer_message_at: updatedAt,
        updated_at: updatedAt,
      }).eq("broker_id", brokerId).eq("customer_phone", cleanPhone),
    ]);

    res.status(201).json({ ok: true, customer_phone: cleanPhone, ticket_id: ticket.id });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/create:", err.message);
    res.status(500).json({ error: err.message });
  }
});
