import { supabase } from "../supabase";
import { downloadUazapiMedia } from "./uazapi";
import { storeConversationMediaFromBase64 } from "./conversationMedia";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "./mediaAi";

// ─── Backfill de mídia recebida ─────────────────────────────────────────────
// Mensagens de áudio/imagem recebidas ANTES do fix (ou que falharam no upload
// ao vivo) ficaram só com a transcrição/descrição, sem arquivo tocável. Este
// job varre as recentes sem media_url, RE-BAIXA o conteúdo da UAZAPI pelo
// messageid, sobe pro Storage e preenche media_url — deixando-as tocáveis na
// tela de Conversas. Best-effort e idempotente: quem já tem media_url é
// ignorado; mídia velha demais (a UAZAPI/WhatsApp expira) simplesmente não
// baixa e é pulada (some da janela de 14 dias com o tempo). Bounded por run.

let running = false;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1_000;
const BATCH = 15;

interface PendingMediaMessage {
  id: string;
  broker_id: string;
  ticket_id: string | null;
  media_type: string | null;
  provider_message_id: string | null;
}

export async function runInboundMediaBackfillTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { data: pending, error } = await supabase
      .from("imf_conversation_messages")
      .select("id, broker_id, ticket_id, media_type, provider_message_id")
      .eq("direction", "in")
      .in("media_type", ["audio", "image"])
      .is("media_url", null)
      .gte("created_at", new Date(Date.now() - LOOKBACK_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(BATCH);
    if (error) { console.error("[Backfill Mídia] busca falhou:", error.message); return; }
    if (!pending?.length) return;

    const tokenCache = new Map<string, string | null>();
    const tokenFor = async (brokerId: string): Promise<string | null> => {
      if (tokenCache.has(brokerId)) return tokenCache.get(brokerId)!;
      const { data } = await supabase.from("imf_brokers").select("uazapi_instance_token").eq("id", brokerId).maybeSingle();
      const token = data?.uazapi_instance_token || null;
      tokenCache.set(brokerId, token);
      return token;
    };

    let done = 0;
    for (const msg of pending as PendingMediaMessage[]) {
      try {
        if (!msg.ticket_id) continue;
        const token = await tokenFor(msg.broker_id);
        if (!token) continue;

        // O provider_message_id guardado é o id composto ("telefone:HEX"); o
        // /message/download da UAZAPI usa só o HEX (parte após o ":").
        const stored = String(msg.provider_message_id || "");
        const downloadId = stored.includes(":") ? stored.slice(stored.lastIndexOf(":") + 1) : stored;
        if (!downloadId || downloadId.startsWith("inbox")) continue;

        const isAudio = msg.media_type === "audio";
        const media = await downloadUazapiMedia(token, downloadId, {
          generateMp3: isAudio,
          maxBytes: isAudio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES,
        });
        const uploaded = await storeConversationMediaFromBase64({
          brokerId: msg.broker_id,
          ticketId: msg.ticket_id,
          base64: media.base64Data,
          mime: media.mimetype,
          filenameHint: isAudio ? "audio-recebido" : "imagem-recebida",
        });
        await supabase.from("imf_conversation_messages")
          .update({ media_url: uploaded.publicUrl })
          .eq("id", msg.id)
          .is("media_url", null);
        done++;
      } catch {
        // mídia expirada / download falhou → pula; será tentada de novo no
        // próximo run enquanto estiver dentro da janela.
      }
    }
    if (done > 0) console.log(`[Backfill Mídia] ${done} áudio(s)/imagem(ns) recebidos ganharam arquivo tocável.`);
  } catch (error: any) {
    console.error("[Backfill Mídia] tick falhou:", error?.message);
  } finally {
    running = false;
  }
}
