import { createHash, randomUUID } from "node:crypto";
import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { getBrokerId } from "../middleware/auth";
import { sendUazapiText, downloadUazapiMedia } from "./uazapi";
import { resolveAccountCapabilities } from "./accountCapabilities";
import { runAgent, executeAction, type AgentTurn, type AgentAction } from "./agent";
import { parseConfirmedAgentAction } from "../security/agentGuardrails";
import { detectInboundMediaKind, mediaMessageId, declaredFileLength } from "./inboundMedia";
import { transcribeWithOpenRouter, resolveAudioFormat, logAiProviderError, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "./mediaAi";
import { uploadPropertyImageBase64 } from "./propertyImages";
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
  const { data } = await supabase.from("imf_platform_instances").select("uazapi_instance_token").eq("key", "pai").maybeSingle();
  const value = data?.uazapi_instance_token || null;
  platformTokenCache = { value, expires: Date.now() + 30_000 };
  return value;
}

async function sendPaiReply(instanceToken: string, phone: string, text: string): Promise<void> {
  const sent = await sendUazapiText(instanceToken, phone, text);
  if (!sent.ok) console.warn(`[WhatsApp Pai] falha ao responder ${phone}: status ${sent.status}`);
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
): Promise<void> {
  const { error } = await supabase.from("imf_agent_log").insert({
    broker_id: brokerId, user_id: userId, role, text: text.slice(0, 4000),
    action_type: actionType || null, channel: "whatsapp", provider_message_id: providerMessageId || null,
  });
  if (error) console.warn("[WhatsApp Pai] falha ao logar turno:", error.message);
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

async function handlePendingAction(
  pending: { action: unknown; broker_id: string },
  decision: "confirm" | "cancel",
  brokerId: string, userId: string, senderPhone: string, platformToken: string,
): Promise<void> {
  await supabase.from("imf_whatsapp_pending_actions").delete().eq("user_id", userId);

  if (decision === "cancel") {
    await sendPaiReply(platformToken, senderPhone, "Combinado, cancelei essa ação.");
    await logPaiTurn(brokerId, userId, "ai", "(cancelado)");
    return;
  }

  try {
    const action = parseConfirmedAgentAction(pending.action) as AgentAction;
    const { summary } = await executeAction(brokerId, userId, action);
    if (action.type === "create_property") {
      // Staging cumpriu o papel — limpa pra não vazar fotos velhas pro
      // próximo imóvel que este usuário cadastrar.
      await supabase.from("imf_whatsapp_staged_media").delete().eq("user_id", userId);
    }
    await sendPaiReply(platformToken, senderPhone, `✓ ${summary}`);
    await logPaiTurn(brokerId, userId, "ai", `✓ ${summary}`, null, action.type);
  } catch (err: any) {
    const msg = err?.message || "Não consegui completar essa ação agora.";
    await sendPaiReply(platformToken, senderPhone, `Não consegui completar: ${msg}`);
    await logPaiTurn(brokerId, userId, "ai", `Falhou: ${msg}`);
  }
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
): Promise<void> {
  const messageId = mediaMessageId(message);
  if (!messageId) throw new Error("ID da mídia ausente.");
  const fileLength = declaredFileLength(message);
  if (fileLength !== null && fileLength > MAX_IMAGE_BYTES) throw new Error("Imagem excede o limite permitido.");

  const media = await downloadUazapiMedia(platformToken, messageId, { generateMp3: false, maxBytes: MAX_IMAGE_BYTES });
  if (!media.mimetype.toLowerCase().startsWith("image/")) throw new Error("A UAZAPI não devolveu um arquivo de imagem.");

  const url = await uploadPropertyImageBase64(userId, `data:${media.mimetype};base64,${media.base64Data}`);
  const { error } = await supabase.from("imf_whatsapp_staged_media").insert({ user_id: userId, broker_id: brokerId, url });
  if (error) throw error;
}

// Áudio vira texto (mesma transcrição já usada no pipeline do cliente) e
// segue o fluxo normal como se o usuário tivesse digitado o comando.
async function handleIncomingAudio(platformToken: string, message: Record<string, any>): Promise<string> {
  const messageId = mediaMessageId(message);
  if (!messageId) throw new Error("ID da mídia ausente.");
  const fileLength = declaredFileLength(message);
  if (fileLength !== null && fileLength > MAX_AUDIO_BYTES) throw new Error("Áudio excede o limite permitido.");

  const media = await downloadUazapiMedia(platformToken, messageId, { generateMp3: true, maxBytes: MAX_AUDIO_BYTES });
  if (!media.mimetype.toLowerCase().startsWith("audio/")) throw new Error("A UAZAPI não devolveu um arquivo de áudio.");

  const transcript = await transcribeWithOpenRouter(media.base64Data, resolveAudioFormat(media.base64Data, media.mimetype));
  if (!transcript) throw new Error("A transcrição do áudio voltou vazia.");
  return transcript;
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
  const { data: staged } = await supabase
    .from("imf_whatsapp_staged_documents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const overflowIds = (staged || []).slice(MAX_STAGED_DOCUMENTS).map((row: any) => row.id);
  if (overflowIds.length) {
    await supabase.from("imf_whatsapp_staged_documents").delete().in("id", overflowIds).eq("user_id", userId);
  }
  return extracted.fileName;
}

async function fetchStagedPhotoUrls(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("imf_whatsapp_staged_media")
    .select("url")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data || []).map((r: any) => r.url).filter(Boolean);
}

async function fetchStagedDocuments(userId: string): Promise<{ fileName: string; mimeType: string; text: string }[]> {
  const { data } = await supabase
    .from("imf_whatsapp_staged_documents")
    .select("file_name, mime_type, extracted_text")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_STAGED_DOCUMENTS);
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

  // Idempotência: se esta mensagem já foi processada antes (retry após
  // crash/lease expirado), não reexecuta nem manda resposta duplicada.
  if (providerMessageId) {
    const { data: already } = await supabase
      .from("imf_agent_log")
      .select("id")
      .eq("broker_id", brokerId).eq("user_id", userId).eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (already) { await markPaiCompleted(row.id); return; }
  }

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
    try {
      await handleIncomingPhoto(platformToken, message, userId, brokerId);
      replyText = "Foto recebida! Manda mais fotos ou já descreve o imóvel (endereço, quartos, valor...) que eu cadastro.";
    } catch (error: any) {
      logAiProviderError("[WhatsApp Pai] processamento de foto falhou", error);
      replyText = `Não consegui processar essa foto: ${error?.message || "Erro desconhecido."}`;
    }
    await logPaiTurn(brokerId, userId, "user", "[Foto]", providerMessageId);
    await sendPaiReply(platformToken, row.sender_phone, replyText);
    await logPaiTurn(brokerId, userId, "ai", replyText);
    await markPaiCompleted(row.id);
    return;
  }

  let text = rawText;
  if (mediaKind === "audio") {
    try {
      text = await handleIncomingAudio(platformToken, message);
    } catch (error: any) {
      logAiProviderError("[WhatsApp Pai] transcrição de áudio falhou", error);
      const replyText = `Não consegui entender esse áudio: ${error?.message || "Erro desconhecido."}`;
      await logPaiTurn(brokerId, userId, "user", "[Áudio]", providerMessageId);
      await sendPaiReply(platformToken, row.sender_phone, replyText);
      await logPaiTurn(brokerId, userId, "ai", replyText);
      await markPaiCompleted(row.id);
      return;
    }
  }

  await logPaiTurn(
    brokerId,
    userId,
    "user",
    receivedDocumentName ? `[Documento: ${receivedDocumentName}] ${text}` : text,
    providerMessageId,
  );

  const { data: pending } = await supabase
    .from("imf_whatsapp_pending_actions")
    .select("action, broker_id, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (pending && new Date(pending.expires_at).getTime() > Date.now()) {
    const decision = classifyReply(text);
    if (decision !== "other") {
      await handlePendingAction(pending, decision, brokerId, userId, row.sender_phone, platformToken);
      await markPaiCompleted(row.id);
      return;
    }
    // "other": abandona a pendência em silêncio, cai pro fluxo normal abaixo
    // tratando a mensagem atual como um comando novo.
    await supabase.from("imf_whatsapp_pending_actions").delete().eq("user_id", userId);
  } else if (pending) {
    // Pendência vencida encontrada na hora — limpa antes de seguir (o job
    // periódico de expiração cobre o caso comum, isto é só para não deixar
    // a corrida "expirou entre o tick e esta mensagem" gerar confusão).
    await supabase.from("imf_whatsapp_pending_actions").delete().eq("user_id", userId);
  }

  const { data: historyRows } = await supabase
    .from("imf_agent_log")
    .select("role, text")
    .eq("broker_id", brokerId).eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  const history: AgentTurn[] = (historyRows || []).reverse().map((h: any) => ({ role: h.role, text: h.text }));

  const entitlement = await resolveAccountCapabilities(brokerId);
  const stagedPhotoUrls = await fetchStagedPhotoUrls(userId);
  const stagedDocuments = await fetchStagedDocuments(userId);
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

  if (stagedDocuments.length) {
    // Documento é contexto de uso único do comando que acabou de rodar. A
    // ação proposta já carrega somente os campos validados que serão
    // confirmados depois; não há razão para manter o texto extraído.
    await supabase.from("imf_whatsapp_staged_documents").delete().eq("user_id", userId);
  }

  if (result.proposedAction) {
    await supabase.from("imf_whatsapp_pending_actions").upsert({
      user_id: userId, broker_id: brokerId,
      action: result.proposedAction, reply_preview: result.reply,
      status: "pending", expires_at: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString(),
    }, { onConflict: "user_id" });
    await sendPaiReply(platformToken, row.sender_phone, `${result.reply}\n\nResponda *sim* pra confirmar ou *não* pra cancelar.`);
    await logPaiTurn(brokerId, userId, "ai", result.reply, null, result.proposedAction.type);
  } else {
    await sendPaiReply(platformToken, row.sender_phone, result.reply);
    await logPaiTurn(brokerId, userId, "ai", result.reply);
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
