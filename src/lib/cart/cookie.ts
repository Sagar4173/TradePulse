/**
 * Owner-bound cart cookie codec.
 *
 * The cookie deliberately stores only SKUs and paid quantities. Prices,
 * discounts, tax and stock are always reloaded and recalculated on the server.
 * The payload is also bound to the authenticated user and retailer so one
 * account's cart cannot appear in another account's session on a shared
 * browser. The cookie is untrusted input: every field is revalidated here.
 */

export const CART_COOKIE_NAME = "tradepulse_cart";
export const CART_COOKIE_VERSION = 2;
export const CART_ORIGINS = ["MANUAL", "AI_TEXT"] as const;
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 999;
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Conservative limit below the usual 4 KB browser cookie cap. */
export const MAX_ENCODED_CART_LENGTH = 3_800;
const MAX_DECODE_LENGTH = 8_000;
const LEGACY_CART_COOKIE_VERSION = 1;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CartOrigin = (typeof CART_ORIGINS)[number];

export type CartOwner = {
  userId: string;
  retailerId: string;
};

export type CartLineInput = {
  sku: string;
  quantity: number;
};

export type CartCookiePayload = CartOwner & {
  v: typeof CART_COOKIE_VERSION;
  origin: CartOrigin;
  lines: CartLineInput[];
};

export type CartCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export class CartCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartCookieError";
  }
}

export function isValidSku(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SKU_PATTERN.test(value) &&
    !value.includes("..")
  );
}

export function isValidLineQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_LINE_QUANTITY
  );
}

function isValidOwnerPart(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 128
  );
}

/**
 * Drops malformed lines, merges duplicate SKUs, caps merged quantities and
 * enforces the line limit. First-seen order is preserved.
 */
export function normalizeCartLines(
  lines: readonly CartLineInput[],
): CartLineInput[] {
  const merged = new Map<string, number>();

  for (const line of lines) {
    if (!isValidSku(line.sku) || !isValidLineQuantity(line.quantity)) {
      continue;
    }

    const existing = merged.get(line.sku);

    if (existing !== undefined) {
      merged.set(
        line.sku,
        Math.min(MAX_LINE_QUANTITY, existing + line.quantity),
      );
      continue;
    }

    if (merged.size >= MAX_CART_LINES) {
      continue;
    }

    merged.set(line.sku, line.quantity);
  }

  return [...merged.entries()].map(([sku, quantity]) => ({ sku, quantity }));
}

export function countCartUnits(lines: readonly CartLineInput[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function encodeCartCookie(
  owner: CartOwner,
  lines: readonly CartLineInput[],
  origin: CartOrigin = "MANUAL",
): string {
  if (!isValidOwnerPart(owner.userId) || !isValidOwnerPart(owner.retailerId)) {
    throw new CartCookieError("Cart owner is invalid.");
  }

  if (!CART_ORIGINS.includes(origin)) {
    throw new CartCookieError("Cart origin is invalid.");
  }

  const payload: CartCookiePayload = {
    v: CART_COOKIE_VERSION,
    userId: owner.userId,
    retailerId: owner.retailerId,
    origin,
    lines: normalizeCartLines(lines),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

  if (encoded.length > MAX_ENCODED_CART_LENGTH) {
    throw new CartCookieError("Cart is too large to store.");
  }

  return encoded;
}

export function decodeCartCookie(
  value: string | null | undefined,
): CartCookiePayload | null {
  if (!value || value.length > MAX_DECODE_LENGTH) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const version = candidate.v;

  if (
    (version !== CART_COOKIE_VERSION &&
      version !== LEGACY_CART_COOKIE_VERSION) ||
    !isValidOwnerPart(candidate.userId) ||
    !isValidOwnerPart(candidate.retailerId) ||
    !Array.isArray(candidate.lines)
  ) {
    return null;
  }

  const origin: CartOrigin =
    version === LEGACY_CART_COOKIE_VERSION
      ? "MANUAL"
      : CART_ORIGINS.includes(candidate.origin as CartOrigin)
        ? (candidate.origin as CartOrigin)
        : "MANUAL";

  if (
    version === CART_COOKIE_VERSION &&
    candidate.origin !== undefined &&
    !CART_ORIGINS.includes(candidate.origin as CartOrigin)
  ) {
    return null;
  }

  const lines = normalizeCartLines(
    candidate.lines.filter(
      (line): line is CartLineInput =>
        Boolean(line) &&
        typeof line === "object" &&
        typeof (line as CartLineInput).sku === "string" &&
        typeof (line as CartLineInput).quantity === "number",
    ),
  );

  return {
    v: CART_COOKIE_VERSION,
    userId: candidate.userId,
    retailerId: candidate.retailerId,
    origin,
    lines,
  };
}

export function readCartOrigin(
  value: string | null | undefined,
  owner: CartOwner,
): CartOrigin {
  const payload = decodeCartCookie(value);

  if (
    !payload ||
    payload.userId !== owner.userId ||
    payload.retailerId !== owner.retailerId
  ) {
    return "MANUAL";
  }

  return payload.origin;
}

export function readCartLines(
  value: string | null | undefined,
  owner: CartOwner,
): CartLineInput[] {
  const payload = decodeCartCookie(value);

  if (
    !payload ||
    payload.userId !== owner.userId ||
    payload.retailerId !== owner.retailerId
  ) {
    return [];
  }

  return payload.lines;
}

export function buildCartCookieOptions(
  isProduction: boolean,
): CartCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  };
}
