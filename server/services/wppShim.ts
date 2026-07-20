import { UAZAPI_HOST } from "../config";
import { normalizePhoneBR } from "../lib/crypto";
import { fetchWithTimeout } from "../lib/http";
import { supabase } from "../supabase";

// ─── Disfarce UAZAPI (substitui o envio via Z-PRO) ──────────────────────────
// Ver plano "Eliminar o Z-PRO" (C:\Users\Criate\.claude\plans\stateless-drifting-turing.md).
//
// ✅ FORMATO CONFIRMADO AO VIVO (2026-07-03) contra a instância real do Hunter
// (WhatsApp conectado de verdade): POST /send/text — SEM identificador nenhum
// na URL, header "token" = o API Token da própria instância (não o
// UAZAPI_TOKEN de plataforma), body {number, text}. Resposta 200 devolve o
// objeto da mensagem enviada (chatid, id do WhatsApp, messageTimestamp, etc.).
// Diferente da hipótese anterior (que usava /message/text/:id, testada e
// descartada — dava 405 Method Not Allowed pra qualquer valor no path).
export async function sendUazapiText(
  instanceToken: string,
  number: string,
  text: string
): Promise<{ ok: boolean; status: number; raw: string }> {
  try {
    const r = await fetchWithTimeout(`${UAZAPI_HOST}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({ number: normalizePhoneBR(number), text }),
    });
    const raw = await r.text();
    return { ok: r.ok, status: r.status, raw };
  } catch (e: any) {
    console.warn("[WppShim] sendUazapiText exceção:", e.message);
    return { ok: false, status: 0, raw: e.message };
  }
}

export interface DownloadedUazapiMedia {
  base64Data: string;
  mimetype: string;
}

interface DownloadUazapiMediaOptions {
  generateMp3: boolean;
  maxBytes: number;
}

const BASE64_MEDIA_PAYLOAD = /^[a-zA-Z0-9+/]+={0,2}$/;

// O URL presente no webhook aponta para um arquivo criptografado do WhatsApp.
// A UAZAPI faz a descriptografia no endpoint oficial /message/download e
// devolve o conteúdo em base64, sem que o ImobiFlow precise persistir um link
// público temporário ou manipular mediaKey/directPath.
export async function downloadUazapiMedia(
  instanceToken: string,
  messageId: string,
  options: DownloadUazapiMediaOptions,
): Promise<DownloadedUazapiMedia> {
  const response = await fetchWithTimeout(`${UAZAPI_HOST}/message/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: instanceToken },
    body: JSON.stringify({
      id: messageId,
      return_base64: true,
      return_link: false,
      generate_mp3: options.generateMp3,
      transcribe: false,
    }),
  }, 30_000);
  const contentLength = Number(response.headers.get("content-length"));
  const maxEncodedResponseBytes = Math.ceil(options.maxBytes / 3) * 4 + 4096;
  if (Number.isFinite(contentLength) && contentLength > maxEncodedResponseBytes) {
    throw new Error("Resposta de mídia excede o limite permitido.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia pela UAZAPI (HTTP ${response.status}).`);
  }

  const rawBase64 = typeof data?.base64Data === "string" ? data.base64Data : "";
  const commaIndex = rawBase64.indexOf(",");
  const base64Data = commaIndex >= 0 ? rawBase64.slice(commaIndex + 1) : rawBase64;
  const mimetype = typeof data?.mimetype === "string" ? data.mimetype.trim() : "";
  if (
    !base64Data
    || base64Data.length % 4 !== 0
    || !BASE64_MEDIA_PAYLOAD.test(base64Data)
    || !mimetype
  ) {
    throw new Error("Resposta de mídia inválida da UAZAPI.");
  }
  if (Buffer.byteLength(base64Data, "base64") > options.maxBytes) {
    throw new Error("Mídia excede o limite permitido.");
  }
  return { base64Data, mimetype };
}

// Decide qual instância usar pra RESPONDER esse cliente: se a conversa
// entrou pela instância própria de um membro (marcado em
// followup_conversations.instance_owner_user_id pelo webhook inbound — ver
// POST /api/wpp-shim/inbound/:instanceId em server/routes/wppShim.ts),
// responde por ela; senão cai pra instância compartilhada da conta
// (comportamento de sempre, e também o fallback se a instância do membro
// tiver sumido/nunca terminado de provisionar — não falha o envio por isso).
export async function resolveOutboundInstanceToken(brokerId: string, customerPhone: string): Promise<string | null> {
  const { data: conv } = await supabase
    .from("followup_conversations")
    .select("instance_owner_user_id")
    .eq("broker_id", brokerId)
    .eq("customer_phone", customerPhone)
    .maybeSingle();

  if (conv?.instance_owner_user_id) {
    const { data: member } = await supabase
      .from("imf_broker_members")
      .select("uazapi_instance_token")
      .eq("broker_id", brokerId)
      .eq("user_id", conv.instance_owner_user_id)
      .maybeSingle();
    if (member?.uazapi_instance_token) return member.uazapi_instance_token;
  }

  const { data: broker } = await supabase
    .from("imf_brokers")
    .select("uazapi_instance_token")
    .eq("id", brokerId)
    .maybeSingle();
  return broker?.uazapi_instance_token || null;
}
