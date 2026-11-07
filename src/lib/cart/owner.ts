import type { Role } from "../auth/types";
import type { CartOwner } from "./cookie";

type CartUser = {
  id: string;
  role: Role;
  retailerId: string | null;
};

/**
 * Cart access requires a retailer account linked to exactly one store. The
 * session — never the cart cookie — establishes this identity.
 */
export function resolveRetailerCartOwner(user: CartUser): CartOwner | null {
  if (user.role !== "RETAILER" || !user.retailerId) {
    return null;
  }

  return { userId: user.id, retailerId: user.retailerId };
}
