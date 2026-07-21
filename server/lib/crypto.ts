import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { LLM_PROXY_ENC_KEY } from "../config";

// ─── AES-256-GCM: criptografa/descriptografa a key OpenRouter do corretor ─────
export function encryptKey(plaintext: string): string {
  if (!LLM_PROXY_ENC_KEY) throw new Error('LLM_PROXY_ENC_KEY não configurada');
  const key = Buffer.from(LLM_PROXY_ENC_KEY, 'hex');
  const iv  = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64'); // iv(12)+tag(16)+ciphertext
}

export function decryptKey(packed: string): string {
  if (!LLM_PROXY_ENC_KEY) throw new Error('LLM_PROXY_ENC_KEY não configurada');
  const key = Buffer.from(LLM_PROXY_ENC_KEY, 'hex');
  const buf = Buffer.from(packed, 'base64');
  const iv         = buf.subarray(0, 12);
  const tag        = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

// Normaliza telefone BR para o formato exigido pelo WhatsApp:
// DDI 55 + DDD (2) + 8 dígitos, sem o nono dígito.
// Ex.: "(62)99159-2150" -> "556291592150"
export function normalizePhoneBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  // Remove DDI 55 se já presente (12+ dígitos = 55 + DDD + 8/9)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  const ddd = d.slice(0, 2);
  let num = d.slice(2);
  // Remove o nono dígito do celular (9 dígitos começando com 9 -> 8 dígitos)
  if (num.length === 9 && num.startsWith('9')) num = num.slice(1);
  return `55${ddd}${num}`;
}

// Mesma normalização de DDI/DDD, mas SEM remover o 9º dígito — usada onde a
// contraparte (ex.: pareamento de WhatsApp da UAZAPI) precisa do número
// completo e exato da conta, não do formato "de mensagem" com 8 dígitos.
// Ex.: "(62)99159-2150" -> "5562991592150"
export function normalizePhoneBRFull(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  const ddd = d.slice(0, 2);
  const num = d.slice(2);
  return `55${ddd}${num}`;
}
