import { isNormalizedIndianPhone, phoneLookupVariants } from "../auth/phone";

export type UserPhoneCandidate = {
  id: string;
  name: string;
};

export type UserPhoneLookupQuery = {
  where: {
    phoneNormalized: string;
  };
  select: {
    id: true;
    name: true;
  };
};

export type UserPhoneFinder = (
  query: UserPhoneLookupQuery,
) => Promise<UserPhoneCandidate | null>;

const USER_PHONE_LOOKUP_SELECT = {
  id: true,
  name: true,
} as const;

/**
 * Finds a user by the canonical normalized phone column. The database enforces
 * uniqueness, so this is a single indexed lookup rather than a candidate scan.
 */
export async function findExistingUserByPhone(
  findUser: UserPhoneFinder,
  phone: string,
): Promise<UserPhoneCandidate | null> {
  if (!isNormalizedIndianPhone(phone)) {
    throw new Error("Phone lookup requires a normalized Indian phone number.");
  }

  return findUser({
    where: { phoneNormalized: phone },
    select: USER_PHONE_LOOKUP_SELECT,
  });
}

export type PhoneLookupCandidate = {
  id: string;
  name: string;
  phone: string;
};

export type PhoneLookupQuery = {
  where: {
    OR: Array<
      { phone: { in: string[] } } | { phone: { contains: string } }
    >;
  };
  select: {
    id: true;
    name: true;
    phone: true;
  };
};

export type PhoneCandidateFinder = (
  query: PhoneLookupQuery,
) => Promise<PhoneLookupCandidate[]>;

/**
 * Candidate filter for legacy retailer phone matching. Retailers still store
 * display-formatted phones, so the exact variants use the phone index where
 * possible and the last-four fallback catches older formats. There is
 * deliberately no `take`: truncating candidates would let an existing retailer
 * be missed.
 */
export function buildNormalizedPhoneLookupWhere(
  phone: string,
): PhoneLookupQuery["where"] {
  return {
    OR: [
      { phone: { in: phoneLookupVariants(phone) } },
      { phone: { contains: phone.slice(-4) } },
    ],
  };
}
