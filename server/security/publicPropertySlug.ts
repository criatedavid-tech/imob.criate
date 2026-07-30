const PUBLIC_PROPERTY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLIC_PROPERTY_SLUG_MAX_LENGTH = 160;

export function isValidPublicPropertySlug(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= PUBLIC_PROPERTY_SLUG_MAX_LENGTH
    && PUBLIC_PROPERTY_SLUG_PATTERN.test(value);
}
