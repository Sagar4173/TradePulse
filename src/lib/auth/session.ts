import "server-only";

import { cookies } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { cache } from "react";

import { getAuthConfig, getSessionServiceDeps } from "./runtime";
import {
  buildSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "./cookies";
import { hasAnyPermission, hasPermission } from "./permissions";
import type { Permission } from "./permissions";
import { validateSessionToken } from "./session-service";
import type { AuthSession } from "./types";

export const getSession = cache(async (): Promise<AuthSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return validateSessionToken(getSessionServiceDeps(), token);
});

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();

  if (!session) {
    unauthorized();
  }

  return session;
}

export async function requirePermission(
  permission: Permission,
): Promise<AuthSession> {
  const session = await requireSession();

  if (!hasPermission(session.user.role, permission)) {
    forbidden();
  }

  return session;
}

export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<AuthSession> {
  const session = await requireSession();

  if (!hasAnyPermission(session.user.role, permissions)) {
    forbidden();
  }

  return session;
}

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    token,
    buildSessionCookieOptions(getAuthConfig(), expiresAt),
  );
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
