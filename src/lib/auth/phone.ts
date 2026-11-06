const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;
const NORMALIZED_PATTERN = /^\+91[6-9]\d{9}$/;

/**
 * Normalizes common Indian mobile formats to E.164 (+91XXXXXXXXXX).
 * Only Indian mobile numbers are accepted; landlines and other countries are
 * rejected rather than guessed.
 */
export function normalizeIndianPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");

  if (!compact) {
    return null;
  }

  let digits: string;

  if (compact.startsWith("+")) {
    if (!compact.startsWith("+91")) {
      return null;
    }
    digits = compact.slice(3);
  } else if (compact.length === 12 && compact.startsWith("91")) {
    digits = compact.slice(2);
  } else if (compact.length === 11 && compact.startsWith("0")) {
    digits = compact.slice(1);
  } else {
    digits = compact;
  }

  if (!INDIAN_MOBILE_PATTERN.test(digits)) {
    return null;
  }

  return `+91${digits}`;
}

export function isNormalizedIndianPhone(value: string): boolean {
  return NORMALIZED_PATTERN.test(value);
}

export function formatPhoneForDisplay(phone: string): string {
  if (!NORMALIZED_PATTERN.test(phone)) {
    return phone;
  }

  return `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) {
    return "••••";
  }

  return `+91 ••••••${phone.slice(-4)}`;
}

export class AmbiguousPhoneMatchError extends Error {
  constructor() {
    super("Multiple records normalize to the same phone number.");
    this.name = "AmbiguousPhoneMatchError";
  }
}

/**
 * Returns the only candidate whose stored phone normalizes to the supplied
 * E.164 value, or null when there are no matches. More than one normalized
 * match throws AmbiguousPhoneMatchError instead of returning null, so callers
 * cannot mistake an ambiguous account for a missing one.
 */
export function findUniqueNormalizedPhoneMatch<T extends { phone: string }>(
  candidates: readonly T[],
  phone: string,
): T | null {
  const matches = candidates.filter(
    (candidate) => normalizeIndianPhone(candidate.phone) === phone,
  );

  if (matches.length > 1) {
    throw new AmbiguousPhoneMatchError();
  }

  return matches[0] ?? null;
}

export function phoneLookupVariants(phone: string): string[] {
  if (!NORMALIZED_PATTERN.test(phone)) {
    return [phone];
  }

  const digits = phone.slice(3);
  return [
    phone,
    digits,
    `0${digits}`,
    `91${digits}`,
    `+91-${digits}`,
    `+91-${digits.slice(0, 5)}-${digits.slice(5)}`,
  ];
}
