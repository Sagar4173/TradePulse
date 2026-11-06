const DEFAULT_AFTER_LOGIN = "/dashboard";
const MAX_PATH_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Only same-origin application paths are accepted as post-login destinations.
 * This blocks open redirects such as //evil.example and scheme-relative URLs.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (!value || value.length > MAX_PATH_LENGTH) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  if (CONTROL_CHARACTERS.test(value)) {
    return fallback;
  }

  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) {
    return fallback;
  }

  return value;
}
