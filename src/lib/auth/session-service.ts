import type { AuthSession, SessionServiceDeps } from "./types";

const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Resolves a raw cookie token to a live session. Tokens are stored hashed, and
 * the user record is re-read on every request so role/status changes take effect
 * immediately rather than waiting for the session to expire.
 */
export async function validateSessionToken(
  deps: SessionServiceDeps,
  token: string,
): Promise<AuthSession | null> {
  if (!token) {
    return null;
  }

  const now = deps.now();
  const stored = await deps.store.findSessionByTokenHash(deps.hashToken(token));

  if (!stored) {
    return null;
  }

  const { session, user } = stored;

  if (session.revokedAt || session.expiresAt <= now) {
    return null;
  }

  if (user.status !== "ACTIVE") {
    await deps.store.revokeSession(session.id, now);
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_TOUCH_INTERVAL_MS) {
    await deps.store.touchSession(session.id, now);
  }

  return {
    sessionId: session.id,
    user,
    expiresAt: session.expiresAt,
  };
}

export async function revokeSessionToken(
  deps: SessionServiceDeps,
  token: string,
): Promise<void> {
  if (!token) {
    return;
  }

  await deps.store.revokeSessionByTokenHash(deps.hashToken(token), deps.now());
}
