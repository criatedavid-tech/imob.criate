import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { UAZAPI_PLATFORM_SESSION } from "../config";
import { sendUazapiText } from "./uazapi";
import { generateWhatsappVerificationCode, hashWhatsappVerificationCode } from "../security/whatsappVerificationCode";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// UAZAPI_PLATFORM_SESSION aqui já É o token da instância da plataforma (não
// um "nome de sessão" pra combinar com o token admin) — mesmo formato
// confirmado ao vivo em uazapi.ts (POST /send/text, header token = token da
// própria instância). O formato antigo /message/text/:id (usado até aqui só
// pela recuperação de senha) está confirmado quebrado (405 pra qualquer
// valor) desde 2026-07-03; não reproduzir esse padrão aqui.
async function sendVerificationCode(phone: string, code: string): Promise<void> {
  if (!UAZAPI_PLATFORM_SESSION) {
    throw new Error("Envio de WhatsApp não configurado no servidor.");
  }
  const text = `🏠 *ImobiFlow*\n\nSeu código de verificação do WhatsApp Pai é:\n\n*${code}*\n\nVálido por 10 minutos. Se não foi você, ignore esta mensagem.`;
  const sent = await sendUazapiText(UAZAPI_PLATFORM_SESSION, phone, text);
  if (!sent.ok) throw new Error("Falha ao enviar o código pelo WhatsApp. Tente novamente em instantes.");
}

// Início do vínculo: usuário já autenticado no painel informa o número, um
// código de 6 dígitos é gerado, com hash salvo (nunca o código em texto
// puro) e enviado de verdade pelo WhatsApp da própria plataforma. Se o
// número já está VERIFICADO por outra conta, recusa — nunca sobrescreve um
// vínculo confirmado silenciosamente (evitaria "roubar" o número de
// outra pessoa). Um vínculo ainda não confirmado pode ser reiniciado por
// qualquer um (nada foi provado ainda, sem risco em deixar reiniciar).
export async function startPhoneVerification(userId: string, rawPhone: string): Promise<{ phone: string }> {
  const phone = normalizePhoneBR(rawPhone);
  if (!/^\d{10,13}$/.test(phone)) throw new Error("Telefone inválido.");

  const { data: existing } = await supabase
    .from("imf_whatsapp_staff_links")
    .select("user_id, verified_at")
    .eq("phone_normalized", phone)
    .maybeSingle();
  if (existing?.verified_at && existing.user_id !== userId) {
    throw new Error("Esse número já está vinculado a outra conta. Peça pra quem administra desvincular antes, se for engano.");
  }

  const code = generateWhatsappVerificationCode();
  const { error } = await supabase.from("imf_whatsapp_staff_links").upsert({
    phone_normalized: phone,
    user_id: userId,
    otp_code_hash: hashWhatsappVerificationCode(code),
    otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    otp_attempts: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_normalized" });
  if (error) throw error;

  await sendVerificationCode(phone, code);
  return { phone };
}

// Confirma sempre a tentativa de vínculo mais recente do usuário (não
// verificada ainda) — a tela só mantém um fluxo de código aberto por vez,
// então não precisa do telefone de novo aqui, só do código digitado.
export async function confirmPhoneVerification(userId: string, code: string): Promise<{ phone: string }> {
  const { data: pending } = await supabase
    .from("imf_whatsapp_staff_links")
    .select("phone_normalized, otp_code_hash, otp_expires_at, otp_attempts")
    .eq("user_id", userId)
    .is("verified_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pending) throw new Error("Nenhuma verificação pendente. Peça um código novo.");
  if (!pending.otp_expires_at || new Date(pending.otp_expires_at).getTime() < Date.now()) {
    throw new Error("Código expirado. Peça um código novo.");
  }
  if (pending.otp_attempts >= MAX_OTP_ATTEMPTS) {
    throw new Error("Muitas tentativas erradas. Peça um código novo.");
  }
  if (pending.otp_code_hash !== hashWhatsappVerificationCode(code.trim())) {
    await supabase.from("imf_whatsapp_staff_links")
      .update({ otp_attempts: pending.otp_attempts + 1, updated_at: new Date().toISOString() })
      .eq("phone_normalized", pending.phone_normalized);
    throw new Error("Código incorreto.");
  }

  const { error } = await supabase.from("imf_whatsapp_staff_links")
    .update({ verified_at: new Date().toISOString(), otp_code_hash: null, updated_at: new Date().toISOString() })
    .eq("phone_normalized", pending.phone_normalized);
  if (error) throw error;
  return { phone: pending.phone_normalized };
}

export async function listVerifiedPhones(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("imf_whatsapp_staff_links")
    .select("phone_normalized")
    .eq("user_id", userId)
    .not("verified_at", "is", null);
  return (data || []).map((r: any) => r.phone_normalized);
}

// Filtra por user_id além do telefone — impede desvincular o número de
// outra pessoa mesmo que alguém adivinhe/veja o número em algum lugar.
export async function unlinkPhone(userId: string, rawPhone: string): Promise<void> {
  const phone = normalizePhoneBR(rawPhone);
  await supabase.from("imf_whatsapp_staff_links").delete().eq("phone_normalized", phone).eq("user_id", userId);
}
