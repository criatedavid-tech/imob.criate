import { createHash } from "node:crypto";
import { extractPdfWithOpenRouter } from "./mediaAi";

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_STAGED_DOCUMENTS = 3;
export const MAX_DOCUMENT_CONTEXT_CHARS = 2_000;

const PDF_MIME = "application/pdf";
const TEXT_DOCUMENT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
  "application/json",
  "application/xml",
]);

export interface PaiDocumentMessage {
  mediaType?: unknown;
  messageType?: unknown;
  mimetype?: unknown;
  fileName?: unknown;
  filename?: unknown;
  title?: unknown;
  content?: Record<string, unknown> | unknown;
}

export interface ExtractedPaiDocument {
  fileName: string;
  mimeType: string;
  text: string;
  contentHash: string;
  byteSize: number;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocumentMime(value: unknown): string {
  return optionalString(value).split(";", 1)[0].toLowerCase();
}

export function resolveDocumentMime(mimeTypeInput: unknown, fileNameInput: unknown): string {
  const mimeType = normalizeDocumentMime(mimeTypeInput);
  if (mimeType === PDF_MIME || TEXT_DOCUMENT_MIMES.has(mimeType)) return mimeType;
  const fileName = optionalString(fileNameInput).toLowerCase();
  if (fileName.endsWith(".pdf")) return PDF_MIME;
  if (fileName.endsWith(".csv")) return "text/csv";
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown")) return "text/markdown";
  if (fileName.endsWith(".xml")) return "application/xml";
  if (fileName.endsWith(".txt")) return "text/plain";
  return mimeType;
}

function contentRecord(message: PaiDocumentMessage): Record<string, unknown> {
  return message.content && typeof message.content === "object"
    ? message.content as Record<string, unknown>
    : {};
}

function documentMimeFromMessage(message: PaiDocumentMessage): string {
  const content = contentRecord(message);
  return normalizeDocumentMime(message.mimetype)
    || normalizeDocumentMime(content.mimetype)
    || normalizeDocumentMime(content.mimeType);
}

function rawDocumentFileName(message: PaiDocumentMessage): string {
  const content = contentRecord(message);
  return optionalString(message.fileName)
    || optionalString(message.filename)
    || optionalString(message.title)
    || optionalString(content.fileName)
    || optionalString(content.filename)
    || optionalString(content.title);
}

export function isPaiDocumentMessage(message: PaiDocumentMessage): boolean {
  const mediaType = optionalString(message.mediaType).toLowerCase();
  const messageType = optionalString(message.messageType).toLowerCase();
  const mimeType = resolveDocumentMime(documentMimeFromMessage(message), rawDocumentFileName(message));
  return mediaType === "document"
    || messageType === "documentmessage"
    || mimeType === PDF_MIME
    || TEXT_DOCUMENT_MIMES.has(mimeType);
}

export function documentFileName(message: PaiDocumentMessage, mimeType: string): string {
  const raw = rawDocumentFileName(message);
  const base = raw.replace(/\\/g, "/").split("/").pop() || "";
  const safe = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._() -]/gu, "_")
    .trim()
    .slice(0, 180);
  if (safe) return safe;
  if (mimeType === PDF_MIME) return "documento.pdf";
  if (mimeType === "text/csv") return "documento.csv";
  if (mimeType === "application/json") return "documento.json";
  return "documento.txt";
}

function assertSupportedDocument(mimeType: string, bytes: Buffer): void {
  if (bytes.length === 0) throw new Error("O documento está vazio.");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Documento excede o limite de 8MB.");
  if (mimeType === PDF_MIME) {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("O arquivo recebido não é um PDF válido.");
    }
    return;
  }
  if (!TEXT_DOCUMENT_MIMES.has(mimeType)) {
    throw new Error("Tipo não suportado. Envie PDF, TXT, CSV, JSON, Markdown ou XML.");
  }
}

function decodeTextDocument(bytes: Buffer): string {
  if (bytes.includes(0)) throw new Error("O arquivo de texto contém dados binários inválidos.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("O documento de texto precisa estar em UTF-8.");
  }
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export async function extractPaiDocument(
  base64Data: string,
  mimeTypeInput: string,
  fileNameInput: string,
  pdfExtractor: typeof extractPdfWithOpenRouter = extractPdfWithOpenRouter,
): Promise<ExtractedPaiDocument> {
  const mimeType = resolveDocumentMime(mimeTypeInput, fileNameInput);
  const bytes = Buffer.from(base64Data, "base64");
  assertSupportedDocument(mimeType, bytes);

  const fileName = documentFileName({ fileName: fileNameInput }, mimeType);
  const rawText = mimeType === PDF_MIME
    ? await pdfExtractor(base64Data, fileName)
    : decodeTextDocument(bytes);
  const text = rawText.replace(/\s+/g, " ").trim().slice(0, MAX_DOCUMENT_CONTEXT_CHARS);
  if (!text) throw new Error("Não encontrei texto legível nesse documento.");

  return {
    fileName,
    mimeType,
    text,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
  };
}
