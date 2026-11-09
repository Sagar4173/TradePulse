import {
  MAX_LINE_QUANTITY,
  MAX_CART_LINES,
  isValidSku,
} from "../cart/cookie";
import { MAX_ALIAS_PHRASE_LENGTH } from "./alias";

/**
 * Strict parser for the browser's confirmed-line payload.
 *
 * The payload is never trusted for prices or product identity. The server
 * rechecks every selected SKU, retailer price, quantity and stock level before
 * it writes the cart. Only confirmed case quantities are accepted here because
 * the existing cart is case-based. An empty phrase is allowed when the retailer
 * selected a product manually and the captured text did not contain a
 * description; no alias is learned in that case.
 */

const LINE_KEYS = ["phrase", "selectedSku", "quantity", "confirmed"] as const;

export type ConfirmedCaptureLine = {
  phrase: string;
  selectedSku: string;
  quantity: number;
};

export type CaptureConfirmationResult =
  | { ok: true; lines: ConfirmedCaptureLine[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

export function parseCaptureConfirmationPayload(
  value: unknown,
): CaptureConfirmationResult {
  if (!isRecord(value) || !hasExactKeys(value, ["lines"])) {
    return { ok: false, error: "The confirmed lines are malformed." };
  }

  if (
    !Array.isArray(value.lines) ||
    value.lines.length === 0 ||
    value.lines.length > MAX_CART_LINES
  ) {
    return { ok: false, error: "Choose between 1 and 50 confirmed lines." };
  }

  const lines: ConfirmedCaptureLine[] = [];

  for (const line of value.lines) {
    if (!isRecord(line) || !hasExactKeys(line, LINE_KEYS)) {
      return { ok: false, error: "A confirmed line is malformed." };
    }

    const phrase =
      typeof line.phrase === "string" ? line.phrase.trim() : null;

    if (
      phrase === null ||
      phrase.length > MAX_ALIAS_PHRASE_LENGTH ||
      !isValidSku(line.selectedSku) ||
      typeof line.quantity !== "number" ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_LINE_QUANTITY ||
      line.confirmed !== true
    ) {
      return { ok: false, error: "A confirmed line is invalid." };
    }

    lines.push({
      phrase,
      selectedSku: line.selectedSku,
      quantity: line.quantity,
    });
  }

  return { ok: true, lines };
}
