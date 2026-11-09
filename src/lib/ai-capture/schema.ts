import { MAX_LINE_QUANTITY } from "../cart/cookie";
import { CAPTURE_UNIT_KINDS, type CaptureUnitKind } from "./types";

/**
 * Strict validation for optional provider output.
 *
 * The deterministic parser is the default and does not depend on this module.
 * If an external provider is enabled later, its response is treated as
 * untrusted data: every field is checked, unknown fields are rejected, and
 * product identifiers must already exist in the server-generated allowlist.
 */

const MAX_LINES = 20;
const MAX_ALTERNATIVES = 2;
const MAX_ORIGINAL_TEXT_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 300;

const LINE_KEYS = [
  "originalText",
  "description",
  "quantity",
  "unitKind",
  "productSku",
  "confidence",
  "alternatives",
] as const;

const ALTERNATIVE_KEYS = ["sku", "confidence"] as const;

export type ProviderCaptureAlternative = {
  sku: string;
  confidence: number;
};

export type ProviderCaptureLine = {
  originalText: string;
  description: string;
  quantity: number;
  unitKind: CaptureUnitKind;
  productSku: string;
  confidence: number;
  alternatives: ProviderCaptureAlternative[];
};

export type ProviderCaptureOutput = {
  lines: ProviderCaptureLine[];
};

export type ProviderValidationResult =
  | { ok: true; value: ProviderCaptureOutput }
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

function isBoundedText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isAllowedSku(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === "string" && allowed.has(value);
}

function validateAlternative(
  value: unknown,
  allowed: ReadonlySet<string>,
): ProviderCaptureAlternative | null {
  if (!isRecord(value) || !hasExactKeys(value, ALTERNATIVE_KEYS)) {
    return null;
  }

  if (
    !isAllowedSku(value.sku, allowed) ||
    !isConfidence(value.confidence)
  ) {
    return null;
  }

  return { sku: value.sku, confidence: value.confidence };
}

function validateLine(
  value: unknown,
  allowed: ReadonlySet<string>,
): ProviderCaptureLine | null {
  if (!isRecord(value) || !hasExactKeys(value, LINE_KEYS)) {
    return null;
  }

  if (
    !isBoundedText(value.originalText, MAX_ORIGINAL_TEXT_LENGTH) ||
    !isBoundedText(value.description, MAX_DESCRIPTION_LENGTH) ||
    typeof value.quantity !== "number" ||
    !Number.isSafeInteger(value.quantity) ||
    value.quantity < 1 ||
    value.quantity > MAX_LINE_QUANTITY ||
    typeof value.unitKind !== "string" ||
    !CAPTURE_UNIT_KINDS.includes(value.unitKind as CaptureUnitKind) ||
    !isAllowedSku(value.productSku, allowed) ||
    !isConfidence(value.confidence) ||
    !Array.isArray(value.alternatives) ||
    value.alternatives.length > MAX_ALTERNATIVES
  ) {
    return null;
  }

  const alternatives: ProviderCaptureAlternative[] = [];

  for (const alternative of value.alternatives) {
    const valid = validateAlternative(alternative, allowed);

    if (!valid) {
      return null;
    }

    alternatives.push(valid);
  }

  return {
    originalText: value.originalText,
    description: value.description,
    quantity: value.quantity,
    unitKind: value.unitKind as CaptureUnitKind,
    productSku: value.productSku,
    confidence: value.confidence,
    alternatives,
  };
}

export function validateProviderCaptureOutput(
  value: unknown,
  allowedSkus: readonly string[],
): ProviderValidationResult {
  if (!isRecord(value) || !hasExactKeys(value, ["lines"])) {
    return { ok: false, error: "Expected an object with only a lines field." };
  }

  if (!Array.isArray(value.lines) || value.lines.length > MAX_LINES) {
    return { ok: false, error: "Lines must be a bounded array." };
  }

  const allowed = new Set(allowedSkus);
  const lines: ProviderCaptureLine[] = [];

  for (const line of value.lines) {
    const valid = validateLine(line, allowed);

    if (!valid) {
      return { ok: false, error: "A captured line is malformed." };
    }

    lines.push(valid);
  }

  return { ok: true, value: { lines } };
}
