import { createHash, randomInt } from "node:crypto";

export function generateWhatsappVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashWhatsappVerificationCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
