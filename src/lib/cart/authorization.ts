import "server-only";

import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import type { CartOwner } from "./cookie";
import { resolveRetailerCartOwner } from "./owner";

export type CartAuthorization =
  | { ok: true; owner: CartOwner }
  | { ok: false; reason: "UNAUTHORIZED" | "FORBIDDEN" };

/**
 * Every cart page and server action calls this. The session is the only source
 * of user and retailer identity; the cart cookie is checked against it.
 */
export async function authorizeRetailerCart(): Promise<CartAuthorization> {
  const session = await getSession();

  if (!session) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.CATALOGUE_VIEW)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const owner = resolveRetailerCartOwner(session.user);

  if (!owner) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  return { ok: true, owner };
}
