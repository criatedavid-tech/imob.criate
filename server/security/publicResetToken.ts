const PUBLIC_RESET_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isValidPublicResetToken(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_RESET_TOKEN_PATTERN.test(value);
}
