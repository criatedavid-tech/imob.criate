import {
  describeImageWithOpenRouter,
  logAiProviderError,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  resolveAudioFormat,
  transcribeWithOpenRouter,
} from "./mediaAi";
import { downloadUazapiMedia } from "./uazapi";

export type InboundMediaKind = "audio" | "image";

export interface InboundMediaMessage {
  id?: unknown;
  messageid?: unknown;
  mediaType?: unknown;
  messageType?: unknown;
  text?: unknown;
  content?: {
    caption?: unknown;
    fileLength?: unknown;
    mimetype?: unknown;
  } | unknown;
}

export interface ResolvedInboundMedia {
  agentText: string;
  storedBody: string;
  mediaType: InboundMediaKind;
  usedFallback: boolean;
  // Bytes do arquivo baixado da UAZAPI, para o worker persistir no Storage e a
  // tela de Conversas tocar o áudio / mostrar a imagem (não só a transcrição).
  // Ausentes no fallback (quando a mídia não pôde ser baixada).
  mediaBase64?: string;
  mediaMimetype?: string;
}

interface InboundMediaDependencies {
  download: typeof downloadUazapiMedia;
  transcribe: typeof transcribeWithOpenRouter;
  describeImage: typeof describeImageWithOpenRouter;
}

const DEFAULT_DEPENDENCIES: InboundMediaDependencies = {
  download: downloadUazapiMedia,
  transcribe: transcribeWithOpenRouter,
  describeImage: describeImageWithOpenRouter,
};

const AUDIO_FALLBACK = "O cliente enviou um áudio, mas a transcrição não ficou disponível. Responda de forma gentil confirmando o recebimento e peça que ele repita a informação por texto.";
const IMAGE_FALLBACK = "O cliente enviou uma imagem, mas a leitura automática não ficou disponível. Responda de forma gentil confirmando o recebimento e pergunte o que ele deseja saber sobre a foto.";

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Exportadas também para o pipeline de mídia do WhatsApp Pai
// (whatsappPaiQueue.ts, Fase 5) — mesma extração de id/tamanho declarado do
// payload da UAZAPI, reaproveitada em vez de duplicada.
export function mediaMessageId(message: InboundMediaMessage): string {
  const directId = optionalString(message.messageid);
  if (directId) return directId;
  const compositeId = optionalString(message.id);
  const separatorIndex = compositeId.lastIndexOf(":");
  return separatorIndex >= 0 ? compositeId.slice(separatorIndex + 1) : compositeId;
}

export function declaredFileLength(message: InboundMediaMessage): number | null {
  if (!message.content || typeof message.content !== "object") return null;
  const value = Number((message.content as Record<string, unknown>).fileLength);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function messageCaption(message: InboundMediaMessage): string {
  if (message.content && typeof message.content === "object") {
    const caption = optionalString((message.content as Record<string, unknown>).caption);
    if (caption) return caption;
  }
  return optionalString(message.text);
}

export function detectInboundMediaKind(message: InboundMediaMessage): InboundMediaKind | null {
  const mediaType = optionalString(message.mediaType).toLowerCase();
  const messageType = optionalString(message.messageType).toLowerCase();
  if (mediaType === "ptt" || mediaType === "audio" || messageType === "audiomessage") return "audio";
  if (mediaType === "image" || messageType === "imagemessage") return "image";
  return null;
}

function fallbackResult(kind: InboundMediaKind): ResolvedInboundMedia {
  if (kind === "audio") {
    return {
      agentText: AUDIO_FALLBACK,
      storedBody: "[Áudio recebido — transcrição indisponível]",
      mediaType: kind,
      usedFallback: true,
    };
  }
  return {
    agentText: IMAGE_FALLBACK,
    storedBody: "[Imagem recebida — leitura indisponível]",
    mediaType: kind,
    usedFallback: true,
  };
}

export async function resolveInboundMedia(
  message: InboundMediaMessage,
  instanceToken: string,
  dependencies: InboundMediaDependencies = DEFAULT_DEPENDENCIES,
): Promise<ResolvedInboundMedia | null> {
  const kind = detectInboundMediaKind(message);
  if (!kind) return null;

  try {
    const messageId = mediaMessageId(message);
    if (!messageId) throw new Error("ID da mídia ausente.");

    const maxBytes = kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
    const fileLength = declaredFileLength(message);
    if (fileLength !== null && fileLength > maxBytes) {
      throw new Error(`${kind === "audio" ? "Áudio" : "Imagem"} excede o limite permitido.`);
    }

    const media = await dependencies.download(instanceToken, messageId, {
      generateMp3: kind === "audio",
      maxBytes,
    });

    if (kind === "audio") {
      if (!media.mimetype.toLowerCase().startsWith("audio/")) {
        throw new Error("A UAZAPI não devolveu um arquivo de áudio.");
      }
      const transcript = await dependencies.transcribe(
        media.base64Data,
        resolveAudioFormat(media.base64Data, media.mimetype),
      );
      if (!transcript) throw new Error("A transcrição do áudio voltou vazia.");
      return {
        agentText: `[Áudio transcrito do cliente] ${transcript}`,
        storedBody: `[Áudio] ${transcript}`,
        mediaType: kind,
        usedFallback: false,
        mediaBase64: media.base64Data,
        mediaMimetype: media.mimetype,
      };
    }

    if (!media.mimetype.toLowerCase().startsWith("image/")) {
      throw new Error("A UAZAPI não devolveu um arquivo de imagem.");
    }
    const caption = messageCaption(message);
    const description = await dependencies.describeImage(media.base64Data, media.mimetype, caption);
    if (!description) throw new Error("A descrição da imagem voltou vazia.");
    const captionSuffix = caption ? ` Legenda do cliente: ${caption}` : "";
    return {
      agentText: `[Imagem enviada pelo cliente] Descrição automática: ${description}.${captionSuffix}`,
      storedBody: `[Imagem] ${description}${captionSuffix}`,
      mediaType: kind,
      usedFallback: false,
      mediaBase64: media.base64Data,
      mediaMimetype: media.mimetype,
    };
  } catch (error: any) {
    logAiProviderError(`[WhatsApp] processamento de ${kind} falhou`, error);
    return fallbackResult(kind);
  }
}
