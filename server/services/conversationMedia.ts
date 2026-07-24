import { supabase } from "../supabase";

// Armazenamento de mídia de conversa (imagem/documento/áudio), compartilhado
// entre o ENVIO (rota /reply-media) e a RECEPÇÃO (worker de inbound). Guardar a
// mídia num bucket público e referenciar por media_url deixa a tela de
// Conversas renderizar a imagem/áudio/documento nativamente, dos dois lados.
const CONVERSA_MEDIA_BUCKET = "imf-conversation-media";
const MAX_CONVERSA_MEDIA_BYTES = 7 * 1024 * 1024;

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "audio/ogg": ".ogg", "audio/webm": ".webm", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/aac": ".aac",
    "application/pdf": ".pdf",
  };
  return map[mime.split(";")[0].trim().toLowerCase()] || "";
}

// Upload no caminho quente sem pagar um round-trip de createBucket por request:
// tenta subir; só se o bucket não existir, cria e repete uma vez.
async function uploadConversaMedia(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const attempt = () => supabase.storage.from(CONVERSA_MEDIA_BUCKET).upload(path, buffer, { contentType, upsert: false });
  let { error } = await attempt();
  if (error && /bucket.*not.*found|not found/i.test(error.message || "")) {
    await supabase.storage.createBucket(CONVERSA_MEDIA_BUCKET, { public: true, fileSizeLimit: MAX_CONVERSA_MEDIA_BYTES }).catch(() => {});
    ({ error } = await attempt());
  }
  if (error) throw error;
}

function sanitizeName(hint: string | undefined, fallback: string): string {
  const clean = String(hint || fallback).replace(/[^\w.\-]+/g, "_").slice(-80) || fallback;
  return clean;
}

// Recebe base64 (com ou sem prefixo data:), grava no bucket e devolve a URL
// pública. `ext`/nome derivados do mime quando o hint não traz extensão.
export async function storeConversationMediaFromBase64(opts: {
  brokerId: string;
  ticketId: string;
  base64: string;
  mime: string;
  filenameHint?: string;
}): Promise<{ publicUrl: string; path: string; size: number }> {
  const raw = opts.base64.includes(",") ? opts.base64.slice(opts.base64.indexOf(",") + 1) : opts.base64;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("Arquivo vazio ou base64 inválido.");
  if (buffer.length > MAX_CONVERSA_MEDIA_BYTES) throw new Error("Arquivo excede o limite permitido.");

  const clean = sanitizeName(opts.filenameHint, "media");
  const nameWithExt = clean.includes(".") ? clean : `${clean}${extensionFromMime(opts.mime)}`;
  const path = `${opts.brokerId}/${opts.ticketId}/${Date.now()}-${nameWithExt}`;
  await uploadConversaMedia(path, buffer, opts.mime);
  const { data } = supabase.storage.from(CONVERSA_MEDIA_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path, size: buffer.length };
}
