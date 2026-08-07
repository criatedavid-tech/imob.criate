import { normalizePhoneBR } from "../lib/crypto";

export const OFFICIAL_WHATSAPP_PAI_PHONE = "556299982218";

export function isOfficialWhatsappPaiPhone(phone: unknown): boolean {
  return normalizePhoneBR(typeof phone === "string" ? phone : "") === OFFICIAL_WHATSAPP_PAI_PHONE;
}
