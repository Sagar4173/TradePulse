/**
 * Exact money arithmetic for TradePulse.
 *
 * All monetary values are represented as integer paise in `bigint`. Floating
 * point is never used for commercial calculations: percentage results are
 * rounded half-up to the nearest paise, matching the GST rounding rule used by
 * the order model (`subtotal − discount + gstAmount = total`).
 */

export class MoneyValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyValueError";
  }
}

type DecimalLike = { toString(): string } | string;

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const MAX_BASIS_POINTS = 10_000n;

function toDecimalString(value: DecimalLike, label: string): string {
  if (typeof value === "number") {
    throw new MoneyValueError(
      `${label} must be a decimal string, not a JavaScript number.`,
    );
  }

  const raw =
    typeof value === "string" ? value : value?.toString?.() ?? "";

  return raw.trim();
}

function parseHundredths(value: DecimalLike, label: string): bigint {
  const text = toDecimalString(value, label);
  const match = DECIMAL_PATTERN.exec(text);

  if (!match) {
    throw new MoneyValueError(
      `${label} must be a non-negative decimal with at most two fraction digits.`,
    );
  }

  const [whole] = text.split(".");
  const fraction = (match[1] ?? "").padEnd(2, "0");

  return BigInt(whole) * 100n + BigInt(fraction);
}

/**
 * Parses a rupee amount such as `"9.50"`, `"112"` or a Prisma `Decimal` into
 * integer paise. Values with more than two decimal places are rejected rather
 * than silently rounded.
 */
export function parseMoneyToPaise(value: DecimalLike): bigint {
  return parseHundredths(value, "Money amount");
}

/**
 * Parses a percentage such as `"18"` or `"3.5"` into basis points
 * (1% = 100 basis points). Percentages above 100 are rejected.
 */
export function parsePercentToBasisPoints(value: DecimalLike): bigint {
  const basisPoints = parseHundredths(value, "Percentage");

  if (basisPoints > MAX_BASIS_POINTS) {
    throw new MoneyValueError("Percentage cannot exceed 100.");
  }

  return basisPoints;
}

/**
 * Returns `amountPaise × basisPoints / 10000`, rounded half-up to the nearest
 * paise using integer arithmetic only.
 */
export function percentageOf(
  amountPaise: bigint,
  basisPoints: bigint,
): bigint {
  if (amountPaise < 0n) {
    throw new MoneyValueError("Amount cannot be negative.");
  }

  if (basisPoints < 0n || basisPoints > MAX_BASIS_POINTS) {
    throw new MoneyValueError("Basis points must be between 0 and 10000.");
  }

  return (amountPaise * basisPoints + 5_000n) / MAX_BASIS_POINTS;
}

/**
 * Multiplies an exact unit price by an integer quantity.
 */
export function multiplyByQuantity(
  unitPaise: bigint,
  quantity: number,
): bigint {
  if (unitPaise < 0n) {
    throw new MoneyValueError("Unit price cannot be negative.");
  }

  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyValueError("Quantity must be a non-negative integer.");
  }

  return unitPaise * BigInt(quantity);
}

function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }

  const lastThree = digits.slice(-3);
  const leading = digits.slice(0, -3);
  const groups: string[] = [];

  for (let index = leading.length; index > 0; index -= 2) {
    groups.unshift(leading.slice(Math.max(0, index - 2), index));
  }

  return `${groups.join(",")},${lastThree}`;
}

/**
 * Formats integer paise as Indian rupees, e.g. `11210n` → `"₹112.10"`.
 */
export function formatPaise(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const rupees = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");

  return `${negative ? "-" : ""}₹${groupIndianDigits(rupees.toString())}.${fraction}`;
}

/**
 * Formats basis points as a percentage without trailing zeros,
 * e.g. `1800n` → `"18"`, `355n` → `"3.55"`.
 */
export function formatBasisPointsPercent(basisPoints: bigint): string {
  if (basisPoints < 0n) {
    throw new MoneyValueError("Basis points cannot be negative.");
  }

  const whole = basisPoints / 100n;
  const fraction = basisPoints % 100n;

  if (fraction === 0n) {
    return whole.toString();
  }

  const digits = fraction.toString().padStart(2, "0");

  return fraction % 10n === 0n
    ? `${whole}.${digits.charAt(0)}`
    : `${whole}.${digits}`;
}
