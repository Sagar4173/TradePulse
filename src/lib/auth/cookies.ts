import type { AuthConfig } from "./types";

export const SESSION_COOKIE_NAME = "tradepulse_session";

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
};

/**
 * Session cookies are HTTP-only, SameSite=Lax, site-wide, and Secure in
 * production. The opaque token itself is never logged or exposed to JS.
 */
export function buildSessionCookieOptions(
  config: AuthConfig,
  expiresAt: Date,
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  };
}
