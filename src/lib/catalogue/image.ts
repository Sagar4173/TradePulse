/**
 * Only repository-controlled local product images are rendered. This blocks
 * remote URLs, protocol-relative URLs, traversal attempts and unexpected file
 * types even if a future admin form stores an unsafe value.
 */

const SAFE_IMAGE_PATTERN =
  /^\/products\/[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png|webp|jpg|jpeg)$/;

export function resolveProductImage(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!SAFE_IMAGE_PATTERN.test(trimmed) || trimmed.includes("..")) {
    return null;
  }

  return trimmed;
}
