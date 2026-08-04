import { createHash, randomBytes } from "node:crypto";

const TRIAL_VOUCHER_CODE_PATTERN = /^imf_trial_[A-Za-z0-9_-]{32}$/;

export function generateTrialVoucherCode(): string {
  return `imf_trial_${randomBytes(24).toString("base64url")}`;
}

export function isValidTrialVoucherCode(value: unknown): value is string {
  return typeof value === "string" && TRIAL_VOUCHER_CODE_PATTERN.test(value);
}

export function hashTrialVoucherCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function trialVoucherCodeHint(code: string): string {
  return `${code.slice(0, 10)}...${code.slice(-6)}`;
}
