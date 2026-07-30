const PUBLIC_BROKER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPublicBrokerId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_BROKER_ID_PATTERN.test(value);
}
