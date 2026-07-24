import { createHash, randomUUID } from "node:crypto";
import { N8N_WEBHOOK_TOKEN, N8N_WEBHOOK_URL } from "../config";
import { normalizePhoneBR } from "../lib/crypto";
import { fetchWithTimeout } from "../lib/http";
import { supabase } from "../supabase";
import {
  ensureConversationTicket,
  recordConversationMessage,
} from "./conversationTickets";
import { resolveInboundMedia } from "./inboundMedia";
import { storeConversationMediaFromBase64 } from "./conversationMedia";

type EnqueueResult = "accepted" | "duplicate" | "ignored";

interface InboxRow {
  id: string;
  instance_id: string;
  broker_id: string;
  instance_owner_user_id: string | null;
  payload: Record<string, any>;
  attempts: number;
}

interface OutboxRow {
  id: string;
  payload: Record<string, any>;
  attempts: number;
}

interface ResolvedInstance {
  brokerId: string;
  instanceToken: string;
  instanceOwnerUserId: string | null;
}

const WORKER_ID = `${process.pid}:${randomUUID()}`;
const INBOX_BATCH_SIZE = envInteger("WEBHOOK_INBOX_BATCH_SIZE", 10, 1, 100);
const OUTBOX_BATCH_SIZE = envInteger("WEBHOOK_OUTBOX_BATCH_SIZE", 20, 1, 200);
const MAX_ATTEMPTS = envInteger("WEBHOOK_QUEUE_MAX_ATTEMPTS", 20, 1, 100);

let inboxTickRunning = false;
let outboxTickRunning = false;

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function eventType(body: Record<string, any>): string {
  return optionalString(body.EventType)
    || optionalString(body.event)
    || optionalString(body.type)
    || "unknown";
}

function webhookDedupeKey(body: Record<string, any>): string {
  const providerMessageId = optionalString(body.message?.id)
    || optionalString(body.message?.messageid);
  if (providerMessageId) return `message:${providerMessageId}`;
  return `payload:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
}

function retryDelaySeconds(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(3_600, Math.ceil(retryAfterSeconds));
  }
  const base = Math.min(900, 2 ** Math.min(Math.max(attempt - 1, 0), 10));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.ceil(base * 0.1)));
  return base + jitter;
}

function safeError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return message.slice(0, 2_000);
}

async function resolveInstance(instanceId: string): Promise<ResolvedInstance | null> {
  const { data: broker, error: brokerError } = await supabase
    .from("imf_brokers")
    .select("id, uazapi_instance_token")
    .eq("uazapi_instance_id", instanceId)
    .maybeSingle();
  if (brokerError) throw brokerError;

  if (broker?.uazapi_instance_token) {
    return {
      brokerId: broker.id,
      instanceToken: broker.uazapi_instance_token,
      instanceOwnerUserId: null,
    };
  }

  const { data: member, error: memberError } = await supabase
    .from("imf_broker_members")
    .select("broker_id, user_id, uazapi_instance_token")
    .eq("uazapi_instance_id", instanceId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member?.uazapi_instance_token) return null;

  return {
    brokerId: member.broker_id,
    instanceToken: member.uazapi_instance_token,
    instanceOwnerUserId: member.user_id,
  };
}

// `includeBody: false` grava só o cabeçalho do evento (~50 bytes) em vez do
// payload inteiro (2-5 KB). Usado no descarte de eventos não acionáveis, que
// são a maioria do tráfego — sem isso, webhook_logs cresce mais rápido que a
// própria inbox e a purga de 90 dias não dá conta.
function logWebhookBestEffort(
  instanceId: string,
  body: Record<string, any>,
  status: string,
  includeBody = true,
): void {
  void Promise.resolve(
    supabase.from("webhook_logs").insert({
      source: "uazapi",
      event_type: eventType(body),
      payload: includeBody ? { instance_id: instanceId, body } : { instance_id: instanceId },
      status,
    }),
  ).then(({ error }) => {
    if (error) console.warn("[Webhook Inbox] auditoria em webhook_logs falhou:", error.message);
  }).catch((error) => {
    console.warn("[Webhook Inbox] auditoria em webhook_logs falhou:", safeError(error));
  });
}

export async function enqueueUazapiWebhook(
  instanceId: string,
  rawBody: unknown,
): Promise<EnqueueResult> {
  const body = rawBody && typeof rawBody === "object"
    ? rawBody as Record<string, any>
    : {};
  const instance = await resolveInstance(instanceId);

  // Instancia inexistente ou token adulterado nao entra na fila. Retornar 200
  // evita que o provedor faca retry infinito de um evento que nunca sera valido.
  if (!instance || !instance.instanceToken || body.token !== instance.instanceToken) {
    logWebhookBestEffort(instanceId, body, "rejected");
    return "ignored";
  }

  // Filtro na BORDA: só entra na fila o que o worker realmente processaria.
  // Medido em produção: 68% dos eventos gravados eram descartados depois
  // (messages_update/recibos de leitura = 57%, mais contacts/history/eco da
  // própria IA). Cada um desses consumia 2 SELECTs + INSERT na inbox + INSERT
  // em webhook_logs e — pior — um slot do orçamento de vazão do claim, que é
  // o gargalo do pipeline. Descartar aqui multiplica a vazão útil por ~3-6x.
  const message = body.message;
  const isActionable = eventType(body) === "messages" && !!message && !message.fromMe;
  if (!isActionable) {
    logWebhookBestEffort(instanceId, body, "filtered", false);
    return "ignored";
  }

  const customerPhone = normalizePhoneBR(optionalString(body.message?.chatid));
  const partitionKey = customerPhone
    ? `${instance.brokerId}:${customerPhone}`
    : `${instance.brokerId}:instance:${instanceId}`;

  const { error } = await supabase.from("imf_webhook_inbox").insert({
    source: "uazapi",
    instance_id: instanceId,
    broker_id: instance.brokerId,
    instance_owner_user_id: instance.instanceOwnerUserId,
    event_type: eventType(body),
    dedupe_key: webhookDedupeKey(body),
    partition_key: partitionKey,
    payload: body,
  });

  if (error) {
    if ((error as any).code === "23505") {
      logWebhookBestEffort(instanceId, body, "duplicate", false);
      return "duplicate";
    }
    throw error;
  }

  // Sem log de "queued": a própria linha da inbox já guarda o payload completo,
  // então duplicar em webhook_logs só amplificava escrita no caminho quente.
  return "accepted";
}

async function updateInboxStatus(
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from("imf_webhook_inbox")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("locked_by", WORKER_ID)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Lease da inbox ${id} nao pertence mais a este worker.`);
}

async function markInboxIgnored(id: string, reason: string): Promise<void> {
  await updateInboxStatus(id, {
    status: "ignored",
    processed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: reason,
  });
}

async function markInboxCompleted(id: string): Promise<void> {
  await updateInboxStatus(id, {
    status: "completed",
    processed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
  });
}

async function rescheduleInbox(row: InboxRow, error: unknown): Promise<void> {
  const isDead = row.attempts >= MAX_ATTEMPTS;
  const delaySeconds = retryDelaySeconds(row.attempts);
  await updateInboxStatus(row.id, {
    status: isDead ? "dead" : "pending",
    next_attempt_at: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: safeError(error),
  });
  console.error(
    `[Webhook Inbox] ${isDead ? "DLQ" : `retry em ${delaySeconds}s`} para ${row.id}:`,
    safeError(error),
  );
}

async function findRecordedMessage(brokerId: string, providerMessageId: string) {
  const { data, error } = await supabase
    .from("imf_conversation_messages")
    .select("id, ticket_id, body, media_type, created_at")
    .eq("broker_id", brokerId)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function agentTextFromRecordedMessage(
  storedBody: string | null,
  mediaType: string | null,
  plainText: string,
): string {
  if (!mediaType) return plainText || storedBody || "";
  if (mediaType === "audio") return `[Audio recebido do cliente] ${storedBody || ""}`.trim();
  if (mediaType === "image") return `[Imagem enviada pelo cliente] ${storedBody || ""}`.trim();
  return storedBody || plainText;
}

async function enqueueN8nOutbox(input: {
  inboxId: string;
  brokerId: string;
  customerPhone: string;
  providerMessageId: string | null;
  ticketId: string;
  agentText: string;
  inputType: string;
}): Promise<void> {
  const partitionKey = `${input.brokerId}:${input.customerPhone}`;
  const { error } = await supabase.from("imf_webhook_outbox").upsert({
    event_type: "n8n.inbound_message",
    aggregate_id: input.inboxId,
    broker_id: input.brokerId,
    partition_key: partitionKey,
    payload: {
      source: "imobiflow_wpp_shim",
      broker_id: input.brokerId,
      customer_phone: input.customerPhone,
      message_id: input.providerMessageId,
      ticket_id: input.ticketId,
      text: input.agentText,
      input_type: input.inputType,
    },
  }, {
    onConflict: "event_type,aggregate_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function processInboxRow(row: InboxRow): Promise<void> {
  try {
    const body = row.payload || {};
    const message = body.message;
    if (!message) return await markInboxIgnored(row.id, "Evento sem mensagem.");
    if (message.fromMe) return await markInboxIgnored(row.id, "Eco de mensagem propria.");

    const customerPhone = normalizePhoneBR(optionalString(message.chatid));
    if (!customerPhone) return await markInboxIgnored(row.id, "Telefone ausente ou invalido.");

    const providerMessageId = optionalString(message.id) || optionalString(message.messageid) || null;
    const persistenceMessageId = providerMessageId || `inbox:${row.id}`;
    const plainText = optionalString(message.text) || optionalString(message.content);
    let recorded = await findRecordedMessage(row.broker_id, persistenceMessageId);
    let ticketId = optionalString(recorded?.ticket_id);
    let storedBody = optionalString(recorded?.body);
    let inboundMediaType = optionalString(recorded?.media_type) || null;
    let agentText = agentTextFromRecordedMessage(storedBody, inboundMediaType, plainText);
    let inboundMediaBase64: string | null = null;
    let inboundMediaMimetype: string | null = null;

    if (!recorded) {
      if (message.type === "text") {
        if (!plainText) return await markInboxIgnored(row.id, "Mensagem textual vazia.");
        storedBody = plainText;
        agentText = plainText;
      } else if (message.type === "media") {
        if (message.isGroup) return await markInboxIgnored(row.id, "Midia de grupo ignorada.");
        const instanceToken = optionalString(body.token);
        if (!instanceToken) throw new Error("Token da instancia ausente no payload persistido.");
        const media = await resolveInboundMedia(message, instanceToken);
        if (!media) return await markInboxIgnored(row.id, "Tipo de midia ainda nao suportado.");
        storedBody = media.storedBody;
        agentText = media.agentText;
        inboundMediaType = media.mediaType;
        inboundMediaBase64 = media.mediaBase64 || null;
        inboundMediaMimetype = media.mediaMimetype || null;
      } else {
        return await markInboxIgnored(row.id, "Tipo de mensagem ainda nao suportado.");
      }

      const activityAt = new Date().toISOString();
      const ticket = await ensureConversationTicket({
        brokerId: row.broker_id,
        customerPhone,
        initialStatus: "pending",
        aiActive: true,
        instanceOwnerUserId: row.instance_owner_user_id,
        lastActivityAt: activityAt,
      });
      ticketId = ticket.id;

      // Persiste o arquivo recebido (áudio/imagem) no Storage pra tocar/ver na
      // tela de Conversas. Best-effort: se o upload falhar, a mensagem é gravada
      // mesmo assim (com a transcrição/descrição em body) — nunca perde a msg.
      let inboundMediaUrl: string | null = null;
      if (inboundMediaBase64 && inboundMediaMimetype) {
        try {
          const stored = await storeConversationMediaFromBase64({
            brokerId: row.broker_id,
            ticketId,
            base64: inboundMediaBase64,
            mime: inboundMediaMimetype,
            filenameHint: inboundMediaType === "audio" ? "audio-recebido" : "imagem-recebida",
          });
          inboundMediaUrl = stored.publicUrl;
        } catch (mediaError: any) {
          console.warn("[Webhook Inbox] upload de midia recebida falhou:", safeError(mediaError));
        }
      }

      try {
        const result = await recordConversationMessage({
          brokerId: row.broker_id,
          customerPhone,
          ticketId,
          direction: "in",
          senderType: "customer",
          body: storedBody,
          mediaType: inboundMediaType,
          mediaUrl: inboundMediaUrl,
          providerMessageId: persistenceMessageId,
        });
        recorded = result.message;
      } catch (error: any) {
        if (error?.code !== "23505") throw error;
        recorded = await findRecordedMessage(row.broker_id, persistenceMessageId);
        if (!recorded) throw error;
        ticketId = optionalString(recorded.ticket_id) || ticketId;
        storedBody = optionalString(recorded.body) || storedBody;
        inboundMediaType = optionalString(recorded.media_type) || inboundMediaType;
        agentText = agentTextFromRecordedMessage(storedBody, inboundMediaType, plainText);
      }
    }

    if (!ticketId) {
      const ticket = await ensureConversationTicket({
        brokerId: row.broker_id,
        customerPhone,
        initialStatus: "pending",
        aiActive: true,
        instanceOwnerUserId: row.instance_owner_user_id,
      });
      ticketId = ticket.id;
    }

    const activityAt = optionalString(recorded?.created_at) || new Date().toISOString();
    const pushName = optionalString(body.chat?.wa_contactName)
      || optionalString(body.chat?.wa_name)
      || optionalString(message.senderName)
      || customerPhone;

    const { error: contactError } = await supabase.from("imf_contacts").upsert(
      { broker_id: row.broker_id, phone: customerPhone, name: pushName },
      { onConflict: "broker_id,phone", ignoreDuplicates: true },
    );
    if (contactError) throw contactError;

    const { error: followupError } = await supabase.from("followup_conversations").update({
      ticket_id: ticketId,
      last_customer_message_at: activityAt,
      follow_sent: false,
      instance_owner_user_id: row.instance_owner_user_id,
      updated_at: activityAt,
    }).eq("broker_id", row.broker_id).eq("customer_phone", customerPhone);
    if (followupError) throw followupError;

    await enqueueN8nOutbox({
      inboxId: row.id,
      brokerId: row.broker_id,
      customerPhone,
      providerMessageId,
      ticketId,
      agentText,
      inputType: inboundMediaType || "text",
    });
    await markInboxCompleted(row.id);
  } catch (error) {
    try {
      await rescheduleInbox(row, error);
    } catch (rescheduleError) {
      console.error("[Webhook Inbox] nao foi possivel reagendar", row.id, safeError(rescheduleError));
    }
  }
}

export async function runWebhookInboxTick(): Promise<void> {
  if (inboxTickRunning) return;
  inboxTickRunning = true;
  try {
    const { data, error } = await supabase.rpc("claim_imf_webhook_inbox", {
      p_worker_id: WORKER_ID,
      p_limit: INBOX_BATCH_SIZE,
      p_lease_seconds: 120,
    });
    if (error) {
      console.error("[Webhook Inbox] claim falhou:", error.message);
      return;
    }
    await Promise.all((data || []).map((row: InboxRow) => processInboxRow(row)));
  } catch (error) {
    console.error("[Webhook Inbox] tick falhou:", safeError(error));
  } finally {
    inboxTickRunning = false;
  }
}

async function updateOutboxStatus(
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from("imf_webhook_outbox")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("locked_by", WORKER_ID)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Lease da outbox ${id} nao pertence mais a este worker.`);
}

async function rescheduleOutbox(
  row: OutboxRow,
  error: unknown,
  retryAfterSeconds?: number,
): Promise<void> {
  const isDead = row.attempts >= MAX_ATTEMPTS;
  const delaySeconds = retryDelaySeconds(row.attempts, retryAfterSeconds);
  await updateOutboxStatus(row.id, {
    status: isDead ? "dead" : "pending",
    next_attempt_at: new Date(Date.now() + delaySeconds * 1_000).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: safeError(error),
  });
  console.error(
    `[Webhook Outbox] ${isDead ? "DLQ" : `retry em ${delaySeconds}s`} para ${row.id}:`,
    safeError(error),
  );
}

async function dispatchOutboxRow(row: OutboxRow): Promise<void> {
  let retryAfterSeconds: number | undefined;
  try {
    if (!N8N_WEBHOOK_URL) throw new Error("N8N_WEBHOOK_URL nao configurada.");
    const response = await fetchWithTimeout(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ImobiFlow-Event-Id": row.id,
        ...(N8N_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${N8N_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ ...row.payload, event_id: row.id }),
      // 60s (o default do fetchWithTimeout é 15s). O fluxo do n8n responde ao
      // cliente DENTRO da execução e leva 5-14s com o agente de IA; no default
      // nós abortávamos uma execução que já tinha enviado o WhatsApp, e o
      // retry fazia o cliente receber a mesma resposta de novo (até 20x).
    }, 60_000);
    retryAfterSeconds = Number(response.headers.get("retry-after")) || undefined;
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new Error(`n8n respondeu HTTP ${response.status}: ${responseBody}`);
    }

    await updateOutboxStatus(row.id, {
      status: "completed",
      delivered_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    });
  } catch (error) {
    try {
      await rescheduleOutbox(row, error, retryAfterSeconds);
    } catch (rescheduleError) {
      console.error("[Webhook Outbox] nao foi possivel reagendar", row.id, safeError(rescheduleError));
    }
  }
}

export async function runWebhookOutboxTick(): Promise<void> {
  if (outboxTickRunning) return;
  outboxTickRunning = true;
  try {
    const { data, error } = await supabase.rpc("claim_imf_webhook_outbox", {
      p_worker_id: WORKER_ID,
      p_limit: OUTBOX_BATCH_SIZE,
      p_lease_seconds: 60,
    });
    if (error) {
      console.error("[Webhook Outbox] claim falhou:", error.message);
      return;
    }
    await Promise.all((data || []).map((row: OutboxRow) => dispatchOutboxRow(row)));
  } catch (error) {
    console.error("[Webhook Outbox] tick falhou:", safeError(error));
  } finally {
    outboxTickRunning = false;
  }
}
