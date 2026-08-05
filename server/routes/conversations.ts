import express from "express";
import { supabase } from "../supabase";
import { sendUazapiText, sendUazapiMedia, resolveOutboundInstanceToken } from "../services/uazapi";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";
import { pauseAiForHumanTakeover } from "../services/followup";
import {
  ensureConversationTicket,
  getConversationTicket,
  recordConversationMessage,
} from "../services/conversationTickets";
import { resolveNewLeadStage } from "../services/crmPipelines";
import { enqueueUazapiWebhook, runWebhookInboxTick } from "../services/inboundWebhookQueue";
import { requireInternalToken } from "../middleware/internalAuth";
import { splitReplyIntoBubbles, sanitizeReply, typingDelayMs } from "../services/replyChunks";
import { n8nInternalLimiter, inboundWebhookLimiter } from "../middleware/rateLimits";
import {
  isValidNormalizedBrazilianPhone,
  N8nInputValidationError,
  parseN8nAiReply,
} from "../security/n8nGuardrails";

// Resposta em balões: ver server/services/replyChunks.ts. Desligar volta ao
// bloco único de antes.
const AI_REPLY_BUBBLES = process.env.AI_REPLY_BUBBLES !== "off";
const AI_REPLY_MAX_BUBBLES = Math.min(Math.max(Number(process.env.AI_REPLY_MAX_BUBBLES) || 3, 1), 4);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const conversationsRouter = express.Router();

// Tick oportunista da inbox no processo web (ver a rota de inbound abaixo).
// WEB_OPPORTUNISTIC_TICK=off desliga sem redeploy de código, se um incidente
// exigir que o web só sirva HTTP.
const WEB_OPPORTUNISTIC_TICK = process.env.WEB_OPPORTUNISTIC_TICK !== "off";
const OPPORTUNISTIC_TICK_MIN_INTERVAL_MS = Number(process.env.WEB_OPPORTUNISTIC_TICK_MS) || 500;
let lastOpportunisticTickAt = 0;

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

// [N8N] Resposta da IA de atendimento automático — envia via UAZAPI nativo
// (resolvendo a instância certa, inclusive WhatsApp por membro via
// resolveOutboundInstanceToken) e grava em imf_conversation_messages pra
// aparecer no Conversas do app. Usa o mesmo padrão de autenticação interna
// de /api/followup/inbound e não depende de credenciais de outro sistema.
// Auth: Bearer INTERNAL_PROXY_TOKEN.
// Body: { broker_id, customer_phone, text, ticket_id? }.
conversationsRouter.post("/api/wpp-shim/ai-reply", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const input = parseN8nAiReply(req.body);
    const brokerId = input.broker_id;
    const text = input.text;
    const customerPhone = normalizePhoneBR(input.customer_phone);
    const ticketId = input.ticket_id;
    if (!isValidNormalizedBrazilianPhone(customerPhone)) {
      return res.status(400).json({ error: "customer_phone inválido." });
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

    // A resposta sai em balões, como uma pessoa escreve. Ver replyChunks.ts.
    const bubbles = AI_REPLY_BUBBLES ? splitReplyIntoBubbles(text, AI_REPLY_MAX_BUBBLES) : [sanitizeReply(text)];
    if (!bubbles.length) return res.status(400).json({ error: "Resposta vazia." });

    let enviados = 0;
    for (const [index, bubble] of bubbles.entries()) {
      if (index > 0) await delay(typingDelayMs(bubble));
      const sent = await sendUazapiText(instanceToken, customerPhone, bubble);
      if (!sent.ok) {
        console.warn(`[WhatsApp] envio de resposta da IA falhou pro broker ${brokerId}: status=${sent.status}`);
        // Falhar no PRIMEIRO balão é seguro para o n8n tentar de novo: nada
        // saiu ainda. Falhar depois, não — repetir mandaria o primeiro balão
        // duas vezes para o cliente. Nesse caso reportamos sucesso parcial.
        if (index === 0) return res.status(502).json({ error: "Falha ao enviar via UAZAPI." });
        break;
      }
      enviados++;
      await recordConversationMessage({
        brokerId,
        customerPhone,
        ticketId: ticket.id,
        direction: "out",
        senderType: "ai",
        body: bubble,
        initialStatus: "open",
      });
    }

    res.json({ ok: true, baloes: enviados, parcial: enviados < bubbles.length });
  } catch (err: any) {
    if (err instanceof N8nInputValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[WhatsApp] erro em /ai-reply:", err.message);
    res.status(500).json({ error: "Falha interna ao enviar resposta." });
  }
});

// ─── Entrada direto da UAZAPI (Fase 5) ──────────────────────────────────────
// A rota preserva o payload bruto numa inbox duravel antes do ACK. O parsing,
// a persistencia da conversa e o repasse ao n8n acontecem nos workers de
// inboundWebhookQueue.ts, com deduplicacao, lease, retry e DLQ.
conversationsRouter.post("/api/wpp-shim/inbound/:instanceId", inboundWebhookLimiter, async (req, res) => {
  try {
    const result = await enqueueUazapiWebhook(req.params.instanceId, req.body);

    // Duplicatas e payloads invalidos recebem 200 para o provedor nao insistir.
    // Eventos validos so chegam aqui depois do INSERT duravel na inbox.
    res.status(200).json({ ok: true, queued: result === "accepted" });

    // Processa JÁ, no próprio processo web, sem esperar o worker dedicado —
    // inbound quase-instantâneo e resiliente a uma eventual indisponibilidade do
    // processo `worker`. Seguro rodar em paralelo com o worker: claim_imf_webhook
    // _inbox usa lease/lock, então nenhuma linha é processada em duplicidade.
    //
    // O DEBOUNCE importa: a flag interna do tick só evita execuções
    // sobrepostas, não a cadência. Sob carga (dezenas de webhooks/s) o web
    // encadeava um tick atrás do outro sem folga, virando um worker em tempo
    // integral que por acaso também serve o app. Com o intervalo mínimo abaixo
    // ele continua dando latência baixa quando o tráfego é esparso (o caso em
    // que isso importa) e devolve o trabalho ao `worker` quando aperta.
    // Desligável por env em caso de incidente.
    if (result === "accepted" && WEB_OPPORTUNISTIC_TICK) {
      const now = Date.now();
      if (now - lastOpportunisticTickAt >= OPPORTUNISTIC_TICK_MIN_INTERVAL_MS) {
        lastOpportunisticTickAt = now;
        void runWebhookInboxTick().catch((e: any) =>
          console.warn("[WhatsApp] tick oportunista do inbox falhou:", e?.message));
      }
    }

  } catch (err: any) {
    // Sem persistencia nao ha ACK: 503 pede que a UAZAPI tente novamente.
    console.error("[WhatsApp] falha ao persistir webhook na inbox:", err.message);
    res.status(503).json({ error: "Webhook temporariamente indisponivel." });
  }
});

// ─── Conversas (leitura) — Fase 4 ───────────────────────────────────────────
conversationsRouter.get("/api/conversas", requireUser, async (req, res) => {
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

conversationsRouter.get("/api/conversas/:ticketId/messages", requireUser, async (req, res) => {
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
conversationsRouter.post("/api/conversas/:ticketId/reply", requireUser, async (req, res) => {
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

// ─── Resposta com MÍDIA (imagem / documento / áudio) ────────────────────────
// Também é handover humano (mesma regra do /reply em texto). O arquivo chega em
// base64 (limite do express.json = 10 MB → teto real ~7 MB de binário), é
// gravado no Storage e enviado ao cliente por URL pública via UAZAPI. Guardar a
// URL em media_url deixa a própria tela de Conversas renderizar a mídia.
const CONVERSA_MEDIA_BUCKET = "imf-conversation-media";
const MAX_CONVERSA_MEDIA_BYTES = 7 * 1024 * 1024;
const CONVERSA_MEDIA_KIND_TO_UAZAPI: Record<string, "image" | "document" | "ptt"> = {
  image: "image",
  document: "document",
  audio: "ptt",
};

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "audio/ogg": ".ogg", "audio/webm": ".webm", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  return map[mime.split(";")[0].trim().toLowerCase()] || "";
}

// Upload no caminho quente sem pagar um round-trip de createBucket por request:
// tenta subir; só se o bucket não existir, cria e repete uma vez.
async function uploadConversaMedia(path: string, buffer: Buffer, contentType: string) {
  const attempt = () => supabase.storage.from(CONVERSA_MEDIA_BUCKET).upload(path, buffer, { contentType, upsert: false });
  let { error } = await attempt();
  if (error && /bucket.*not.*found|not found/i.test(error.message || "")) {
    await supabase.storage.createBucket(CONVERSA_MEDIA_BUCKET, { public: true, fileSizeLimit: MAX_CONVERSA_MEDIA_BYTES }).catch(() => {});
    ({ error } = await attempt());
  }
  if (error) throw error;
}

conversationsRouter.post("/api/conversas/:ticketId/reply-media", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });
    if (ticket.conversation_status === "closed") {
      return res.status(409).json({ error: "Este ticket está encerrado. Uma nova mensagem do cliente abrirá outro ticket." });
    }

    const { kind, data_base64, mime, filename, caption } = req.body || {};
    if (!["image", "document", "audio"].includes(kind)) return res.status(400).json({ error: "kind deve ser image, document ou audio." });
    if (typeof data_base64 !== "string" || !data_base64) return res.status(400).json({ error: "data_base64 é obrigatório." });
    if (typeof mime !== "string" || !mime) return res.status(400).json({ error: "mime é obrigatório." });
    if (kind === "image" && !mime.startsWith("image/")) return res.status(400).json({ error: "mime não corresponde a uma imagem." });
    if (kind === "audio" && !mime.startsWith("audio/")) return res.status(400).json({ error: "mime não corresponde a um áudio." });

    const rawBase64 = data_base64.includes(",") ? data_base64.slice(data_base64.indexOf(",") + 1) : data_base64;
    const buffer = Buffer.from(rawBase64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "Arquivo vazio ou base64 inválido." });
    if (buffer.length > MAX_CONVERSA_MEDIA_BYTES) return res.status(413).json({ error: "Arquivo excede o limite de 7 MB." });

    const instanceToken = await resolveOutboundInstanceToken(brokerId, ticket.customer_phone);
    if (!instanceToken) return res.status(503).json({ error: "Instância WhatsApp não configurada para este corretor ainda." });

    const cleanName = String(filename || kind).replace(/[^\w.\-]+/g, "_").slice(-80) || kind;
    const nameWithExt = cleanName.includes(".") ? cleanName : `${cleanName}${extensionFromMime(mime)}`;
    const path = `${brokerId}/${ticket.id}/${Date.now()}-${nameWithExt}`;
    await uploadConversaMedia(path, buffer, mime);
    const { data: pub } = supabase.storage.from(CONVERSA_MEDIA_BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const cleanCaption = typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 1000) : undefined;
    const sent = await sendUazapiMedia(instanceToken, ticket.customer_phone, {
      type: CONVERSA_MEDIA_KIND_TO_UAZAPI[kind],
      file: publicUrl,
      caption: cleanCaption,
      docName: kind === "document" ? nameWithExt : undefined,
    });
    if (!sent.ok) {
      console.warn(`[Conversas] envio de mídia falhou pro broker ${brokerId}: status=${sent.status} raw=${String(sent.raw).slice(0, 200)}`);
      return res.status(502).json({ error: "Falha ao enviar a mídia pelo WhatsApp." });
    }

    await recordConversationMessage({
      brokerId,
      customerPhone: ticket.customer_phone,
      ticketId: ticket.id,
      direction: "out",
      senderType: "broker_manual",
      body: cleanCaption || null,
      mediaUrl: publicUrl,
      mediaType: kind,
    });

    await pauseAiForHumanTakeover(brokerId, ticket.customer_phone);
    await supabase.from("imf_conversation_tickets").update({
      ai_active: false,
      human_takeover_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", ticket.id).eq("broker_id", brokerId);

    res.json({ ok: true, media_url: publicUrl, media_type: kind });
  } catch (err: any) {
    console.error("Erro POST /api/conversas/:ticketId/reply-media:", err.message);
    res.status(500).json({ error: "Falha ao enviar a mídia." });
  }
});

// Status do lead no CRM para ESTE contato (mesma dedupe do create-lead): existe
// um lead com esse telefone nesta conta? Em qual pipeline/etapa ele está? A tela
// de Conversas usa isso pra decidir entre "Criar no CRM" e o seletor de etapa.
conversationsRouter.get("/api/conversas/:ticketId/lead", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    const ticket = await getConversationTicket(brokerId, req.params.ticketId);
    if (!ticket || !(await canAccessTicket(userId, brokerId, req.params.ticketId))) return res.status(403).json({ error: "Acesso negado." });

    const phone = ticket.customer_phone;
    const { data: propRows } = await supabase.from("imf_properties").select("id").eq("broker_id", brokerId);
    const propIds = (propRows || []).map((p: any) => p.id);
    let query = supabase.from("leads").select("id, name, pipeline_id, pipeline_stage_id").eq("phone", phone);
    query = propIds.length > 0
      ? query.or(`broker_id.eq.${brokerId},property_id.in.(${propIds.join(",")})`)
      : query.eq("broker_id", brokerId);
    const { data: rows } = await query.limit(1);
    const lead = rows && rows[0];
    if (!lead) return res.json({ exists: false });
    res.json({
      exists: true,
      lead_id: lead.id,
      pipeline_id: lead.pipeline_id || null,
      pipeline_stage_id: lead.pipeline_stage_id || null,
    });
  } catch (err: any) {
    console.error("Erro GET /api/conversas/:ticketId/lead:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Liga/desliga a IA manualmente pra uma conversa (independe de ter respondido ou não).
conversationsRouter.patch("/api/conversas/:ticketId/ai-toggle", requireUser, async (req, res) => {
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

// Marca conversa como encerrada ou reaberta. Reabrir um ticket encerrado é
// permitido (decisão de produto 2026-07-23: "reabrir atendimento" na tela de
// Conversas) — a checagem logo abaixo ("já existe outro ticket ativo pra esse
// telefone") é o guarda-corpo real: ensureConversationTicket
// (conversationTickets.ts) reaproveita esse MESMO ticket_id se o cliente
// mandar mensagem de novo enquanto ele está reaberto, então os dois caminhos
// (reabertura manual e reabertura automática pelo cliente) convergem com
// segurança pro mesmo ciclo, sem violar o índice único parcial de
// "1 ticket ativo por telefone" (uq_conversation_ticket_active_phone).
conversationsRouter.patch("/api/conversas/:ticketId/status", requireUser, async (req, res) => {
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
// Atribui a conversa a um usuário da equipe. Dá acesso à conversa mesmo
// sem lead casando (ver canAccessTicket), então só o dono ou quem já
// acessa a conversa pode atribuir — evita um membro "roubar" ticket alheio às cegas.
conversationsRouter.patch("/api/conversas/:ticketId/assign", requireUser, async (req, res) => {
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

// Move a conversa para uma fila, ou remove com queue_id: null.
conversationsRouter.patch("/api/conversas/:ticketId/queue", requireUser, async (req, res) => {
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
conversationsRouter.delete("/api/conversas/:ticketId", requireUser, async (req, res) => {
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
conversationsRouter.post("/api/conversas/:ticketId/create-lead", requireUser, async (req, res) => {
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
conversationsRouter.get("/api/conversas/queues", requireUser, async (req, res) => {
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

conversationsRouter.post("/api/conversas/queues", requireUser, async (req, res) => {
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

conversationsRouter.delete("/api/conversas/queues/:id", requireUser, async (req, res) => {
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
conversationsRouter.get("/api/conversas/tags", requireUser, async (req, res) => {
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

conversationsRouter.post("/api/conversas/tags", requireUser, async (req, res) => {
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

conversationsRouter.patch("/api/conversas/tags/:id", requireUser, async (req, res) => {
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
conversationsRouter.delete("/api/conversas/tags/:id", requireUser, async (req, res) => {
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

conversationsRouter.post("/api/conversas/:ticketId/tags", requireUser, async (req, res) => {
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

conversationsRouter.delete("/api/conversas/:ticketId/tags/:tagId", requireUser, async (req, res) => {
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
conversationsRouter.get("/api/conversas/:ticketId/notes", requireUser, async (req, res) => {
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

conversationsRouter.post("/api/conversas/:ticketId/notes", requireUser, async (req, res) => {
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
// de atendimento) — antes só existia responder o que já chegou. IA começa desligada:
// quem abriu manualmente está assumindo o atendimento, não faz sentido a IA
// entrar no meio de uma conversa que um humano decidiu começar.
conversationsRouter.post("/api/conversas/create", requireUser, async (req, res) => {
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
