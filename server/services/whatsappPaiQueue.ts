import { createHash, randomUUID } from "node:crypto";
import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { getBrokerId } from "../middleware/auth";
import { sendUazapiText, downloadUazapiMedia, getUazapiPlatformToken } from "./uazapi";
import { resolveAccountCapabilities } from "./accountCapabilities";
import { runAgent, executeAction, type AgentTurn, type AgentAction } from "./agent";
import { parseConfirmedAgentAction } from "../security/agentGuardrails";
import { detectInboundMediaKind, mediaMessageId, declaredFileLength } from "./inboundMedia";
import { transcribeWithOpenRouter, resolveAudioFormat, logAiProviderError, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "./mediaAi";
import { uploadPropertyImageBase64 } from "./propertyImages";
import { storeAgentMediaFromBase64 } from "./conversationMedia";
import {
  MAX_DOCUMENT_BYTES,
  MAX_STAGED_DOCUMENTS,
  documentFileName,
  extractPaiDocument,
  isPaiDocumentMessage,
} from "./whatsappPaiDocuments";

// ─────────────────────────────────────────────────────────────────────────
// WHATSAPP PAI — fila de inbound (Fase 4)
// ─────────────────────────────────────────────────────────────────────────
// Paralela a inboundWebhookQueue.ts, não uma modificação dela — aquela fila
// está entrelaçada com despacho pro n8n e debounce, irrelevantes aqui
// (nativo, sem n8n; cada mensagem do Pai é 1 turno só, o `history` do
// próprio runAgent já dá continuidade entre mensagens separadas, igual já
// faz hoje entre envios separados da CommandBar no painel).
//
// Texto, áudio e foto (Fase 5) + documento como contexto temporário (Fase 7).
// Áudio vira texto via transcrição (mesma IA
// já usada no pipeline do cliente). Foto só faz staging — nunca é descrita
// por IA aqui (diferente do pipeline do cliente): o comando de verdade
// chega no texto que vem depois, igual ao array em memória da CommandBar.tsx
// no painel, só que persistido (WhatsApp entrega cada foto numa mensagem
// separada, sem estado de sessão entre elas).

const WORKER_ID = `${process.pid}:${randomUUID()}`;
const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;
const HISTORY_TURNS = 8;
const MAX_ATTEMPTS = 10;

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function paiDedupeKey(body: Record<string, any>): string {
  const providerMessageId = optionalString(body.message?.id) || optionalString(body.message?.messageid);
  if (providerMessageId) return `message:${providerMessageId}`;
  return `payload:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
}

export function isPaiAlbumEnvelope(message: Record<string, any>): boolean {
  return optionalString(message.mediaType).toLowerCase() === "collection"
    || optionalString(message.messageType).toLowerCase() === "albummessage";
}

// Enfileira um webhook JÁ AUTENTICADO (o token contra imf_platform_instances
// é checado na rota, antes de chamar isto — aqui só filtra o que não é uma
// mensagem de texto de entrada real, mesmo espírito do filtro na borda de
// inboundWebhookQueue.ts).
export async function enqueuePaiWebhook(rawBody: unknown): Promise<"accepted" | "duplicate" | "ignored"> {
  const body = rawBody && typeof rawBody === "object" ? rawBody as Record<string, any> : {};
  const message = body.message;
  const eventType = optionalString(body.EventType) || optionalString(body.event) || optionalString(body.type);
  const isActionable = eventType === "messages" && !!message && !message.fromMe;
  if (!isActionable) return "ignored";

  const senderPhone = normalizePhoneBR(optionalString(message.chatid));
  if (!senderPhone) return "ignored";

  const { error } = await supabase.from("imf_pai_inbox").insert({
    dedupe_key: paiDedupeKey(body),
    sender_phone: senderPhone,
    payload: body,
  });
  if (error) {
    if ((error as any).code === "23505") return "duplicate";
    throw error;
  }
  return "accepted";
}

async function updatePaiInboxStatus(id: string, values: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase
    .from("imf_pai_inbox")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("locked_by", WORKER_ID)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Lease da linha ${id} nao pertence mais a este worker.`);
}

async function markPaiIgnored(id: string, reason: string): Promise<void> {
  await updatePaiInboxStatus(id, {
    status: "ignored", processed_at: new Date().toISOString(),
    locked_at: null, locked_by: null, last_error: reason,
  });
}

async function markPaiCompleted(id: string): Promise<void> {
  await updatePaiInboxStatus(id, {
    status: "completed", processed_at: new Date().toISOString(),
    locked_at: null, locked_by: null, last_error: null,
  });
}

let platformTokenCache: { value: string | null; expires: number } | null = null;
async function getPlatformInstanceToken(): Promise<string | null> {
  if (platformTokenCache && platformTokenCache.expires > Date.now()) return platformTokenCache.value;
  const value = await getUazapiPlatformToken();
  platformTokenCache = { value, expires: Date.now() + 30_000 };
  return value;
}

async function sendPaiReply(instanceToken: string, phone: string, text: string): Promise<void> {
  const sent = await sendUazapiText(instanceToken, phone, text);
  if (!sent.ok) {
    throw new Error(`Falha temporaria ao responder pelo WhatsApp (status ${sent.status}).`);
  }
}

async function enqueueDeferredPhotoCaption(
  senderPhone: string,
  caption: string,
  providerMessageId: string,
): Promise<void> {
  const { error } = await supabase.from("imf_pai_inbox").upsert({
    dedupe_key: `photo-caption:${providerMessageId}`,
    sender_phone: senderPhone,
    payload: {
      EventType: "messages",
      _imobiflow: { kind: "photo_caption", source_message_id: providerMessageId },
      message: {
        id: `photo-caption:${providerMessageId}`,
        text: caption,
        type: "text",
        mediaType: "",
        messageType: "ExtendedTextMessage",
        fromMe: false,
        chatid: `${senderPhone}@s.whatsapp.net`,
      },
    },
  }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
}

async function hasDeferredPhotoCaption(senderPhone: string): Promise<boolean> {
  const { data, error } = await supabase.from("imf_pai_inbox")
    .select("id")
    .eq("sender_phone", senderPhone)
    .in("status", ["pending", "processing"])
    .like("dedupe_key", "photo-caption:%")
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}

async function resolveSenderIdentity(phone: string): Promise<{ userId: string; brokerId: string } | null> {
  const { data } = await supabase
    .from("imf_whatsapp_staff_links")
    .select("user_id")
    .eq("phone_normalized", phone)
    .not("verified_at", "is", null)
    .maybeSingle();
  if (!data?.user_id) return null;
  const brokerId = await getBrokerId(data.user_id);
  if (!brokerId) return null;
  return { userId: data.user_id, brokerId };
}

async function logPaiTurn(
  brokerId: string, userId: string, role: "user" | "ai", text: string,
  providerMessageId?: string | null, actionType?: string,
  mediaUrl?: string | null, mediaType?: "image" | "audio" | null,
): Promise<void> {
  const { error } = await supabase.from("imf_agent_log").insert({
    broker_id: brokerId, user_id: userId, role, text: text.slice(0, 4000),
    action_type: actionType || null, channel: "whatsapp", provider_message_id: providerMessageId || null,
    media_url: mediaUrl || null, media_type: mediaType || null,
  });
  if (error && (error as any).code !== "23505") {
    console.warn("[WhatsApp Pai] falha ao logar turno:", error.message);
  }
}

// Classificação determinística — nunca pergunta ao modelo se uma resposta
// curta é "sim" ou "não" (mesmo princípio de resolveDueAt/computeDueAt em
// agent.ts: código decide o que código consegue decidir com segurança).
// Qualquer coisa fora das duas listas ABANDONA a pendência em silêncio e
// trata a mensagem como um comando novo — nunca executa nada por engano;
// o pior caso é só pedir de novo.
const CONFIRM_WORDS = ["sim", "s", "confirma", "confirmar", "confirmo", "pode", "isso", "ok", "certo", "manda", "envia", "beleza", "positivo"];
const CANCEL_WORDS = ["nao", "n", "cancela", "cancelar", "para", "esquece", "deixa", "negativo"];

function normalizeReply(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function classifyReply(text: string): "confirm" | "cancel" | "other" {
  const normalized = normalizeReply(text);
  // "sim, pode confirmar" sem tirar a pontuação vira firstWord "sim," — não
  // bate com "sim" da lista e cai em "other", abandonando a pendência à toa.
  // Achado ao vivo testando a Fase 4.
  const firstWord = (normalized.split(/\s+/)[0] || "").replace(/[.,!?;:]+$/, "");
  if (CONFIRM_WORDS.includes(firstWord)) return "confirm";
  if (CANCEL_WORDS.includes(firstWord)) return "cancel";
  return "other";
}

interface PaiPendingAction {
  action: unknown;
  broker_id: string;
  status: "pending" | "executing" | "executed" | "cancelled" | "expired";
  expires_at: string;
  execution_message_id?: string | null;
  execution_summary?: string | null;
}

async function deleteHandledPendingAction(userId: string, executionMessageId: string): Promise<void> {
  const { error } = await supabase
    .from("imf_whatsapp_pending_actions")
    .delete()
    .eq("user_id", userId)
    .eq("execution_message_id", executionMessageId);
  if (error) throw error;
}

async function handlePendingAction(
  pending: PaiPendingAction,
  decision: "confirm" | "cancel",
  brokerId: string,
  userId: string,
  senderPhone: string,
  platformToken: string,
  executionMessageId: string,
): Promise<void> {
  // Nunca reaproveita em um tenant uma ação proposta quando o usuário ainda
  // pertencia a outro tenant.
  if (pending.broker_id !== brokerId) {
    const replyText = "Essa ação foi criada em outra conta e foi descartada por segurança. Faça o pedido novamente.";
    const { error } = await supabase.from("imf_whatsapp_pending_actions").delete().eq("user_id", userId);
    if (error) throw error;
    await sendPaiReply(platformToken, senderPhone, replyText);
    await logPaiTurn(brokerId, userId, "ai", replyText);
    return;
  }

  // A mutação terminou e somente a entrega da resposta falhou: reapresenta o
  // resumo persistido sem executar a ação outra vez.
  if (
    (pending.status === "executed" || pending.status === "cancelled")
    && pending.execution_message_id
    && pending.execution_summary
  ) {
    await sendPaiReply(platformToken, senderPhone, pending.execution_summary);
    await logPaiTurn(brokerId, userId, "ai", pending.execution_summary);
    await deleteHandledPendingAction(userId, pending.execution_message_id);
    return;
  }

  // A queda ocorreu na janela impossível de provar atomicamente (depois de
  // iniciar executeAction e antes de persistir o resultado). Reexecutar aqui
  // poderia duplicar cadastro ou disparo. Falha segura e pede conferência.
  if (pending.status === "executing") {
    const replyText = "A execução anterior foi interrompida e não vou repeti-la automaticamente para evitar duplicidade. Confira no painel; se não tiver sido aplicada, faça o pedido novamente.";
    const messageId = pending.execution_message_id || executionMessageId;
    const { error } = await supabase.from("imf_whatsapp_pending_actions").update({
      status: "cancelled",
      execution_message_id: messageId,
      execution_summary: replyText,
      executed_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("broker_id", brokerId).eq("status", "executing");
    if (error) throw error;
    await sendPaiReply(platformToken, senderPhone, replyText);
    await logPaiTurn(brokerId, userId, "ai", replyText);
    await deleteHandledPendingAction(userId, messageId);
    return;
  }

  if (pending.status !== "pending") {
    throw new Error("A ação pendente não está mais disponível para confirmação.");
  }

  if (decision === "cancel") {
    const replyText = "Combinado, cancelei essa ação.";
    const { data: cancelled, error } = await supabase.from("imf_whatsapp_pending_actions").update({
      status: "cancelled",
      execution_message_id: executionMessageId,
      execution_summary: replyText,
      executed_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("broker_id", brokerId).eq("status", "pending").select("user_id").maybeSingle();
    if (error) throw error;
    if (!cancelled) throw new Error("A ação pendente mudou durante o cancelamento.");
    await sendPaiReply(platformToken, senderPhone, replyText);
    await logPaiTurn(brokerId, userId, "ai", "(cancelado)");
    await deleteHandledPendingAction(userId, executionMessageId);
    return;
  }

  const { data: claimed, error: claimError } = await supabase.from("imf_whatsapp_pending_actions").update({
    status: "executing",
    execution_message_id: executionMessageId,
    execution_summary: null,
    executed_at: null,
  }).eq("user_id", userId).eq("broker_id", brokerId).eq("status", "pending").select("user_id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error("A ação pendente mudou durante a confirmação.");

  let replyText: string;
  let actionType: string | undefined;
  try {
    const action = parseConfirmedAgentAction(pending.action) as AgentAction;
    actionType = action.type;
    const { summary } = await executeAction(brokerId, userId, action);
    if (action.type === "create_property") {
      const { error } = await supabase.from("imf_whatsapp_staged_media").delete()
        .eq("user_id", userId).eq("broker_id", brokerId);
      if (error) console.warn("[WhatsApp Pai] imóvel criado, mas o staging de fotos não foi limpo:", error.message);
    }
    replyText = `✓ ${summary}`;
  } catch (err: any) {
    const msg = err?.message || "Não consegui completar essa ação agora.";
    replyText = `Não consegui completar: ${msg}`;
  }

  const { data: finished, error: finishError } = await supabase.from("imf_whatsapp_pending_actions").update({
    status: "executed",
    execution_summary: replyText,
    executed_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("broker_id", brokerId)
    .eq("status", "executing").eq("execution_message_id", executionMessageId)
    .select("user_id").maybeSingle();
  if (finishError) throw finishError;
  if (!finished) throw new Error("O resultado da ação não pôde ser persistido com segurança.");

  await sendPaiReply(platformToken, senderPhone, replyText);
  await logPaiTurn(brokerId, userId, "ai", replyText, null, actionType);
  await deleteHandledPendingAction(userId, executionMessageId);
}

// Baixa e sobe a foto pro bucket de imóveis, sem extrair dado nenhum dela —
// vira anexo puro (mesmo comportamento do painel hoje). O comando de texto
// que descreve o imóvel chega numa mensagem separada e é isso que apanha as
// fotos em staging (via fetchStagedPhotoUrls, logo abaixo).
// Lança em vez de devolver união discriminada {ok,error} — com
// strictNullChecks desligado neste tsconfig, `!resultado.ok` não estreita o
// tipo (confirmado com repro isolado) e vira erro de compilação acessando
// `.error` no ramo falso. Mesma correção já usada em
// whatsappStaffLinks.ts/confirmPhoneVerification para o mesmo problema.
async function handleIncomingPhoto(
  platformToken: string, message: Record<string, any>, userId: string, brokerId: string,
  providerMessageId: string,
): Promise<string> {
  const messageId = mediaMessageId(message);
  if (!messageId) throw new Error("ID da mídia ausente.");
  const { data: existing, error: existingError } = await supabase
    .from("imf_whatsapp_staged_media")
    .select("id, url")
    .eq("user_id", userId)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.url) return existing.url;
  const fileLength = declaredFileLength(message);
  if (fileLength !== null && fileLength > MAX_IMAGE_BYTES) throw new Error("Imagem excede o limite permitido.");

  const media = await downloadUazapiMedia(platformToken, messageId, { generateMp3: false, maxBytes: MAX_IMAGE_BYTES });
  if (!media.mimetype.toLowerCase().startsWith("image/")) throw new Error("A UAZAPI não devolveu um arquivo de imagem.");

  const url = await uploadPropertyImageBase64(userId, `data:${media.mimetype};base64,${media.base64Data}`);
  const { error } = await supabase.from("imf_whatsapp_staged_media").upsert({
    user_id: userId,
    broker_id: brokerId,
    provider_message_id: providerMessageId,
    url,
  }, { onConflict: "user_id,provider_message_id" });
  if (error) throw error;
  return url;
}

// Áudio vira texto (mesma transcrição já usada no pipeline do cliente) e
// segue o fluxo normal como se o usuário tivesse digitado o comando.
async function downloadIncomingAudio(
  platformToken: string,
  message: Record<string, any>,
): Promise<{ base64Data: string; mimetype: string }> {
  const messageId = mediaMessageId(message);
  if (!messageId) throw new Error("ID da mídia ausente.");
  const fileLength = declaredFileLength(message);
  if (fileLength !== null && fileLength > MAX_AUDIO_BYTES) throw new Error("Áudio excede o limite permitido.");

  const media = await downloadUazapiMedia(platformToken, messageId, { generateMp3: true, maxBytes: MAX_AUDIO_BYTES });
  if (!media.mimetype.toLowerCase().startsWith("audio/")) throw new Error("A UAZAPI não devolveu um arquivo de áudio.");
  return { base64Data: media.base64Data, mimetype: media.mimetype };
}

async function handleIncomingDocument(
  platformToken: string,
  message: Record<string, any>,
  userId: string,
  brokerId: string,
): Promise<string> {
  const messageId = mediaMessageId(message);
  if (!messageId) throw new Error("ID do documento ausente.");
  const fileLength = declaredFileLength(message);
  if (fileLength !== null && fileLength > MAX_DOCUMENT_BYTES) throw new Error("Documento excede o limite de 8MB.");

  const media = await downloadUazapiMedia(platformToken, messageId, {
    generateMp3: false,
    maxBytes: MAX_DOCUMENT_BYTES,
  });
  const fileName = documentFileName(message, media.mimetype);
  const extracted = await extractPaiDocument(media.base64Data, media.mimetype, fileName);
  const now = new Date().toISOString();
  const { error } = await supabase.from("imf_whatsapp_staged_documents").upsert({
    user_id: userId,
    broker_id: brokerId,
    file_name: extracted.fileName,
    mime_type: extracted.mimeType,
    byte_size: extracted.byteSize,
    content_hash: extracted.contentHash,
    extracted_text: extracted.text,
    created_at: now,
  }, { onConflict: "user_id,content_hash" });
  if (error) throw error;

  // Mantém somente os documentos mais recentes. O conteúdo é temporário e
  // não pode crescer sem limite enquanto o usuário envia arquivos e some.
  const { data: staged, error: stagedError } = await supabase
    .from("imf_whatsapp_staged_documents")
    .select("id")
    .eq("user_id", userId)
    .eq("broker_id", brokerId)
    .order("created_at", { ascending: false });
  if (stagedError) throw stagedError;
  const overflowIds = (staged || []).slice(MAX_STAGED_DOCUMENTS).map((row: any) => row.id);
  if (overflowIds.length) {
    const { error } = await supabase.from("imf_whatsapp_staged_documents").delete()
      .in("id", overflowIds).eq("user_id", userId).eq("broker_id", brokerId);
    if (error) throw error;
  }
  return extracted.fileName;
}

async function fetchStagedPhotoUrls(userId: string, brokerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("imf_whatsapp_staged_media")
    .select("url")
    .eq("user_id", userId)
    .eq("broker_id", brokerId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => r.url).filter(Boolean);
}

async function fetchStagedDocuments(userId: string, brokerId: string): Promise<{ fileName: string; mimeType: string; text: string }[]> {
  const { data, error } = await supabase
    .from("imf_whatsapp_staged_documents")
    .select("file_name, mime_type, extracted_text")
    .eq("user_id", userId)
    .eq("broker_id", brokerId)
    .order("created_at", { ascending: true })
    .limit(MAX_STAGED_DOCUMENTS);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    fileName: row.file_name,
    mimeType: row.mime_type,
    text: row.extracted_text,
  }));
}

async function processPaiInboxRow(row: { id: string; sender_phone: string; payload: Record<string, any> }): Promise<void> {
  const message = row.payload?.message || {};
  const content = message.content && typeof message.content === "object" ? message.content : {};
  const rawText = optionalString(message.text) || optionalString(message.content) || optionalString(content.caption);
  const providerMessageId = optionalString(message.id) || optionalString(message.messageid) || null;
  const mediaKind = detectInboundMediaKind(message);
  const isDocument = isPaiDocumentMessage(message);

  // A UAZAPI emite um envelope sem arquivo antes dos eventos individuais das
  // fotos do album. Ele nao e uma mensagem do usuario para o agente.
  if (isPaiAlbumEnvelope(message)) {
    await markPaiIgnored(row.id, "Envelope de album; fotos processadas individualmente.");
    return;
  }

  if (!rawText && !mediaKind && !isDocument) {
    await markPaiIgnored(row.id, "Tipo de mensagem ainda não suportado.");
    return;
  }

  const platformToken = await getPlatformInstanceToken();
  if (!platformToken) {
    await markPaiIgnored(row.id, "Instância central sem token.");
    return;
  }

  const identity = await resolveSenderIdentity(row.sender_phone);
  if (!identity) {
    await sendPaiReply(platformToken, row.sender_phone,
      "Não te reconheço ainda. Vincule seu número em Configurações → WhatsApp Pai no painel pra eu poder te ajudar por aqui.");
    await markPaiIgnored(row.id, "Telefone não vinculado.");
    return;
  }
  const { userId, brokerId } = identity;
  // A linha única da inbox é a fonte de idempotência do inbound. O histórico
  // não pode ser usado como marcador de conclusão: ele é gravado antes de
  // algumas etapas e faria um retry descartar uma mensagem ainda incompleta.
  const executionMessageId = providerMessageId || `inbox:${row.id}`;

  let receivedDocumentName: string | null = null;
  if (isDocument) {
    try {
      receivedDocumentName = await handleIncomingDocument(platformToken, message, userId, brokerId);
    } catch (error: any) {
      logAiProviderError("[WhatsApp Pai] processamento de documento falhou", error);
      const replyText = `Não consegui ler esse documento: ${error?.message || "Erro desconhecido."}`;
      await logPaiTurn(brokerId, userId, "user", "[Documento]", providerMessageId);
      await sendPaiReply(platformToken, row.sender_phone, replyText);
      await logPaiTurn(brokerId, userId, "ai", replyText);
      await markPaiCompleted(row.id);
      return;
    }
    if (!rawText) {
      const replyText = `Documento “${receivedDocumentName}” recebido. Agora me diga o que você quer consultar ou fazer com essas informações.`;
      await logPaiTurn(brokerId, userId, "user", `[Documento: ${receivedDocumentName}]`, providerMessageId);
      await sendPaiReply(platformToken, row.sender_phone, replyText);
      await logPaiTurn(brokerId, userId, "ai", replyText);
      await markPaiCompleted(row.id);
      return;
    }
  }

  // Foto: staging + confirmação, nunca chama o agente — a próxima mensagem
  // de texto do mesmo remetente é que dispara o comando de verdade.
  if (mediaKind === "image") {
    let replyText: string;
    let photoUrl: string | null = null;
    try {
      photoUrl = await handleIncomingPhoto(platformToken, message, userId, brokerId, executionMessageId);
      if (rawText) {
        await enqueueDeferredPhotoCaption(row.sender_phone, rawText, executionMessageId);
        replyText = "Foto e descrição recebidas. Vou juntar as imagens antes de preparar o cadastro.";
      } else if (await hasDeferredPhotoCaption(row.sender_phone)) {
        replyText = "";
      } else {
        replyText = "Foto recebida! Manda mais fotos ou já descreve o imóvel (endereço, quartos, valor...) que eu cadastro.";
      }
    } catch (error: any) {
      logAiProviderError("[WhatsApp Pai] processamento de foto falhou", error);
      replyText = `Não consegui processar essa foto: ${error?.message || "Erro desconhecido."}`;
    }
    await logPaiTurn(brokerId, userId, "user", "[Foto]", providerMessageId, undefined, photoUrl, "image");
    if (replyText) {
      await sendPaiReply(platformToken, row.sender_phone, replyText);
      await logPaiTurn(brokerId, userId, "ai", replyText);
    }
    await markPaiCompleted(row.id);
    return;
  }

  let text = rawText;
  let commandMediaUrl: string | null = null;
  let commandMediaType: "audio" | null = null;
  if (mediaKind === "audio") {
    try {
      const audio = await downloadIncomingAudio(platformToken, message);
      const stored = await storeAgentMediaFromBase64({
        brokerId,
        userId,
        base64: audio.base64Data,
        mime: audio.mimetype,
        filenameHint: "comando-pai-audio",
      });
      commandMediaUrl = stored.publicUrl;
      commandMediaType = "audio";
      text = await transcribeWithOpenRouter(
        audio.base64Data,
        resolveAudioFormat(audio.base64Data, audio.mimetype),
      );
      if (!text) throw new Error("A transcrição do áudio voltou vazia.");
    } catch (error: any) {
      logAiProviderError("[WhatsApp Pai] transcrição de áudio falhou", error);
      const replyText = `Não consegui entender esse áudio: ${error?.message || "Erro desconhecido."}`;
      await logPaiTurn(
        brokerId, userId, "user", "[Áudio]", providerMessageId,
        undefined, commandMediaUrl, commandMediaType,
      );
      await sendPaiReply(platformToken, row.sender_phone, replyText);
      await logPaiTurn(brokerId, userId, "ai", replyText);
      await markPaiCompleted(row.id);
      return;
    }
  }

  const userLogText = receivedDocumentName ? `[Documento: ${receivedDocumentName}] ${text}` : text;
  const { data: pending, error: pendingError } = await supabase
    .from("imf_whatsapp_pending_actions")
    .select("action, broker_id, status, expires_at, execution_message_id, execution_summary")
    .eq("user_id", userId)
    .maybeSingle();
  if (pendingError) throw pendingError;

  // Estado de recuperação vence a expiração da proposta: uma mutação já pode
  // ter começado ou terminado, então primeiro reapresenta o resultado (ou o
  // aviso de incerteza) e nunca transforma o retry em um comando novo.
  if (pending && pending.status !== "pending") {
    await logPaiTurn(
      brokerId, userId, "user", userLogText, providerMessageId,
      undefined, commandMediaUrl, commandMediaType,
    );
    await handlePendingAction(
      pending as PaiPendingAction,
      "confirm",
      brokerId,
      userId,
      row.sender_phone,
      platformToken,
      executionMessageId,
    );
    await markPaiCompleted(row.id);
    return;
  }

  if (pending && new Date(pending.expires_at).getTime() > Date.now()) {
    const decision = classifyReply(text);
    if (decision !== "other") {
      await logPaiTurn(
        brokerId, userId, "user", userLogText, providerMessageId,
        undefined, commandMediaUrl, commandMediaType,
      );
      await handlePendingAction(
        pending as PaiPendingAction,
        decision,
        brokerId,
        userId,
        row.sender_phone,
        platformToken,
        executionMessageId,
      );
      await markPaiCompleted(row.id);
      return;
    }
    // "other": abandona a pendência em silêncio, cai pro fluxo normal abaixo
    // tratando a mensagem atual como um comando novo.
    const { error } = await supabase.from("imf_whatsapp_pending_actions").delete()
      .eq("user_id", userId).eq("broker_id", brokerId).eq("status", "pending");
    if (error) throw error;
  } else if (pending) {
    // Pendência vencida encontrada na hora — limpa antes de seguir (o job
    // periódico de expiração cobre o caso comum, isto é só para não deixar
    // a corrida "expirou entre o tick e esta mensagem" gerar confusão).
    const { error } = await supabase.from("imf_whatsapp_pending_actions").delete().eq("user_id", userId);
    if (error) throw error;
  }

  const { data: historyRows } = await supabase
    .from("imf_agent_log")
    .select("role, text")
    .eq("broker_id", brokerId).eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  const history: AgentTurn[] = (historyRows || []).reverse().map((h: any) => ({ role: h.role, text: h.text }));

  const entitlement = await resolveAccountCapabilities(brokerId);
  const stagedPhotoUrls = await fetchStagedPhotoUrls(userId, brokerId);
  const stagedDocuments = await fetchStagedDocuments(userId, brokerId);
  const result = await runAgent({
    brokerId, userId,
    message: text.slice(0, 1000),
    persona: entitlement.accountType,
    capabilities: entitlement.enabled,
    autonomy: "copiloto",
    history,
    imageUrls: stagedPhotoUrls.length ? stagedPhotoUrls : undefined,
    documentContexts: stagedDocuments.length ? stagedDocuments : undefined,
  });

  if (result.proposedAction) {
    const { error } = await supabase.from("imf_whatsapp_pending_actions").upsert({
      user_id: userId, broker_id: brokerId,
      action: result.proposedAction, reply_preview: result.reply,
      status: "pending", expires_at: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString(),
      execution_message_id: null, execution_summary: null, executed_at: null,
    }, { onConflict: "user_id" });
    if (error) throw error;
    await sendPaiReply(platformToken, row.sender_phone, `${result.reply}\n\nResponda *sim* pra confirmar ou *não* pra cancelar.`);
    await logPaiTurn(
      brokerId, userId, "user", userLogText, providerMessageId,
      undefined, commandMediaUrl, commandMediaType,
    );
    await logPaiTurn(brokerId, userId, "ai", result.reply, null, result.proposedAction.type);
  } else {
    await sendPaiReply(platformToken, row.sender_phone, result.reply);
    await logPaiTurn(
      brokerId, userId, "user", userLogText, providerMessageId,
      undefined, commandMediaUrl, commandMediaType,
    );
    await logPaiTurn(brokerId, userId, "ai", result.reply);
  }
  if (stagedDocuments.length) {
    // Só apaga depois que a resposta saiu. Se o provedor falhar, o retry ainda
    // recebe exatamente o mesmo contexto documental.
    const { error } = await supabase.from("imf_whatsapp_staged_documents").delete()
      .eq("user_id", userId).eq("broker_id", brokerId);
    if (error) console.warn("[WhatsApp Pai] limpeza de documento staged falhou:", error.message);
  }
  await markPaiCompleted(row.id);
}

// Trava por processo: sem isto, dois disparos oportunistas (uma mensagem
// chegando enquanto a anterior ainda está sendo processada — o caso comum
// já que runAgent leva alguns segundos) rodam `claim` concorrentemente. O
// SKIP LOCKED do banco impede claim duplicado da MESMA linha, mas duas
// chamadas concorrentes ainda competem à toa pelo mesmo lote; pior,
// encontrado ao vivo: uma chamada tardia e esquecida (de uma mensagem de
// teste anterior) tentando atualizar uma linha que outro ciclo já
// concluiu, batendo no "lease não pertence mais a este worker". Mesmo
// padrão já usado em runWebhookInboxTick (inboundWebhookQueue.ts).
let paiTickRunning = false;

export async function runPaiInboxTick(): Promise<void> {
  if (paiTickRunning) return;
  paiTickRunning = true;
  try {
    const { data: rows, error } = await supabase.rpc("claim_imf_pai_inbox", {
      p_worker_id: WORKER_ID, p_limit: 10, p_lease_seconds: 120,
    });
    if (error) throw error;

    for (const row of rows || []) {
      try {
        await processPaiInboxRow(row);
      } catch (err: any) {
        const message = (err?.message || String(err)).slice(0, 2_000);
        console.error(`[WhatsApp Pai] falha ao processar linha ${row.id}:`, message);
        const attempts = row.attempts || 1;
        const values = attempts >= MAX_ATTEMPTS
          ? { status: "dead", last_error: message, locked_at: null, locked_by: null }
          : {
              status: "pending",
              next_attempt_at: new Date(Date.now() + Math.min(900, 2 ** attempts) * 1000).toISOString(),
              last_error: message, locked_at: null, locked_by: null,
            };
        await updatePaiInboxStatus(row.id, values).catch(() => {});
      }
    }
  } catch (error: any) {
    console.error("[WhatsApp Pai] tick falhou:", error?.message || error);
  } finally {
    paiTickRunning = false;
  }
}
