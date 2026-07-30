const PUBLIC_INVITE_CODE_PATTERN = /^[0-9a-f]{32}$/;

export function isValidPublicInviteCode(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_INVITE_CODE_PATTERN.test(value);
}
