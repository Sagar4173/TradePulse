import type { Prisma } from "../../src/generated/prisma/client";
import { findExistingUserByPhone as findExistingUserByPhoneWithLookup } from "../../src/lib/users/phone-lookup";

/**
 * Prisma adapter for the shared canonical-phone lookup. The unique
 * User.phoneNormalized index makes this a single exact lookup.
 */
export function findExistingUserByPhone(
  db: Prisma.TransactionClient,
  phone: string,
): Promise<{ id: string; name: string } | null> {
  return findExistingUserByPhoneWithLookup(
    (query) => db.user.findUnique(query),
    phone,
  );
}
