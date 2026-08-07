import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { getUazapiPlatformToken, sendUazapiText } from "./uazapi";
import { generateWhatsappVerificationCode, hashWhatsappVerificationCode } from "../security/whatsappVerificationCode";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

async function sendVerificationCode(phone: string, code: string): Promise<void> {
  const platformToken = await getUazapiPlatformToken();
  if (!platformToken) {
    throw new Error("Envio de WhatsApp não configurado no servidor.");
  }
  const text = `🏠 *ImobiFlow*\n\nSeu código de verificação do WhatsApp Pai é:\n\n*${code}*\n\nVálido por 10 minutos. Se não foi você, ignore esta mensagem.`;
  const sent = await sendUazapiText(platformToken, phone, text);
  if (!sent.ok) throw new Error("Falha ao enviar o código pelo WhatsApp. Tente novamente em instantes.");
}

export function normalizeStaffPhone(rawPhone: string): string {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (!/^[1-9]\d{9,10}$/.test(local)) throw new Error("Telefone inválido.");
  return normalizePhoneBR(local);
}

// Início do vínculo: usuário já autenticado no painel informa o número, um
// código de 6 dígitos é gerado, com hash salvo (nunca o código em texto
// puro) e enviado de verdade pelo WhatsApp da própria plataforma. Se o
// número já está VERIFICADO por outra conta, recusa — nunca sobrescreve um
// vínculo confirmado silenciosamente (evitaria "roubar" o número de
// outra pessoa). Um vínculo ainda não confirmado pode ser reiniciado por
// qualquer um (nada foi provado ainda, sem risco em deixar reiniciar).
export async function startPhoneVerification(userId: string, rawPhone: string): Promise<{ phone: string }> {
  const phone = normalizeStaffPhone(rawPhone);
  const code = generateWhatsappVerificationCode();
  const { data, error } = await supabase.rpc("imf_start_whatsapp_phone_verification", {
    p_user_id: userId,
    p_phone: phone,
    p_otp_code_hash: hashWhatsappVerificationCode(code),
    p_otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  if (error) throw error;
  const outcome = data?.[0]?.outcome;
  if (outcome === "owned_by_other") {
    throw new Error("Esse número já está vinculado a outra conta. Peça pra quem administra desvincular antes, se for engano.");
  }
  if (outcome === "already_verified") throw new Error("Esse número já está vinculado à sua conta.");
  if (outcome !== "started") throw new Error("Não foi possível iniciar a verificação do telefone.");

  await sendVerificationCode(phone, code);
  return { phone };
}

// Confirma sempre a tentativa de vínculo mais recente do usuário (não
// verificada ainda) — a tela só mantém um fluxo de código aberto por vez,
// então não precisa do telefone de novo aqui, só do código digitado.
export async function confirmPhoneVerification(userId: string, code: string): Promise<{ phone: string }> {
  const { data, error } = await supabase.rpc("imf_confirm_whatsapp_phone_verification", {
    p_user_id: userId,
    p_otp_code_hash: hashWhatsappVerificationCode(code.trim()),
    p_max_attempts: MAX_OTP_ATTEMPTS,
  });
  if (error) throw error;
  const result = data?.[0];
  if (result?.outcome === "none") throw new Error("Nenhuma verificação pendente. Peça um código novo.");
  if (result?.outcome === "expired") throw new Error("Código expirado. Peça um código novo.");
  if (result?.outcome === "too_many") throw new Error("Muitas tentativas erradas. Peça um código novo.");
  if (result?.outcome === "incorrect") throw new Error("Código incorreto.");
  if (result?.outcome !== "verified" || !result.phone_normalized) {
    throw new Error("Não foi possível confirmar o telefone.");
  }
  return { phone: result.phone_normalized };
}

export async function listVerifiedPhones(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("imf_whatsapp_staff_links")
    .select("phone_normalized")
    .eq("user_id", userId)
    .not("verified_at", "is", null);
  if (error) throw error;
  return (data || []).map((r: any) => r.phone_normalized);
}

// Filtra por user_id além do telefone — impede desvincular o número de
// outra pessoa mesmo que alguém adivinhe/veja o número em algum lugar.
export async function unlinkPhone(userId: string, rawPhone: string): Promise<void> {
  const phone = normalizePhoneBR(rawPhone);
  const { error } = await supabase.from("imf_whatsapp_staff_links").delete()
    .eq("phone_normalized", phone).eq("user_id", userId);
  if (error) throw error;
}
