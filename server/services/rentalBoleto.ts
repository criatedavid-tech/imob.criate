import { randomUUID } from "node:crypto";
import { supabase } from "../supabase";

const RENTAL_BILLS_BUCKET = "imf-rental-bills";
const MAX_BOLETO_BYTES = 6 * 1024 * 1024;
const SIGNED_URL_SECONDS = 31 * 24 * 60 * 60;

function safeFileName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
  return (normalized || "boleto.pdf").slice(0, 180);
}

export function decodeRentalBoleto(fileData: string): Buffer {
  const match = /^data:(?:application\/pdf|application\/octet-stream)?;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(fileData.trim());
  if (!match) throw new Error("Envie o boleto em PDF.");
  const buffer = Buffer.from(match[1].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("O PDF esta vazio.");
  if (buffer.length > MAX_BOLETO_BYTES) throw new Error("O boleto deve ter no maximo 6 MB.");
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("O arquivo enviado nao e um PDF valido.");
  return buffer;
}

export async function signedRentalBoletoUrl(payment: {
  boleto_file_path?: string | null;
  boleto_url?: string | null;
}): Promise<string | null> {
  if (!payment.boleto_file_path) return payment.boleto_url || null;
  const { data, error } = await supabase.storage
    .from(RENTAL_BILLS_BUCKET)
    .createSignedUrl(payment.boleto_file_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Nao foi possivel gerar o link temporario do boleto.");
  return data.signedUrl;
}

export async function uploadRentalBoleto(input: {
  brokerId: string;
  contractId: string;
  paymentId: string;
  fileData: string;
  fileName: string;
  previousPath?: string | null;
}): Promise<{ filePath: string; fileName: string; signedUrl: string }> {
  const buffer = decodeRentalBoleto(input.fileData);
  const fileName = safeFileName(input.fileName);
  const filePath = `${input.brokerId}/${input.contractId}/${input.paymentId}/${randomUUID()}.pdf`;
  const { error } = await supabase.storage.from(RENTAL_BILLS_BUCKET).upload(filePath, buffer, {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });
  if (error) throw new Error("Nao foi possivel armazenar o boleto.");

  try {
    const signedUrl = await signedRentalBoletoUrl({ boleto_file_path: filePath });
    if (!signedUrl) throw new Error("Nao foi possivel gerar o link do boleto.");
    if (input.previousPath) {
      const { error: removeError } = await supabase.storage.from(RENTAL_BILLS_BUCKET).remove([input.previousPath]);
      if (removeError) console.error("Falha ao remover boleto substituido:", removeError.message);
    }
    return { filePath, fileName, signedUrl };
  } catch (error) {
    await supabase.storage.from(RENTAL_BILLS_BUCKET).remove([filePath]);
    throw error;
  }
}

export async function removeRentalBoleto(filePath: string): Promise<void> {
  const { error } = await supabase.storage.from(RENTAL_BILLS_BUCKET).remove([filePath]);
  if (error) console.error("Falha ao remover boleto apos erro de persistencia:", error.message);
}
