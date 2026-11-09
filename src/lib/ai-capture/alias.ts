import { isValidSku } from "../cart/cookie";
import { normalizeAliasPhrase } from "./normalize";

/**
 * Decides the smallest alias-table write after a retailer explicitly confirms
 * a captured line. The caller persists the plan and the audit event in one
 * transaction; this module is pure so the decision can be tested in isolation.
 */

export const MAX_ALIAS_PHRASE_LENGTH = 200;

export type ExistingAlias = {
  productSku: string;
  isActive: boolean;
};

export type AliasWriteInput = {
  phrase: string;
  parsedSku: string | null;
  selectedSku: string;
  existing: ExistingAlias | null;
};

export type AliasWritePlan =
  | { action: "SKIP" }
  | {
      action: "CREATE";
      phrase: string;
      normalizedPhrase: string;
      productSku: string;
    }
  | {
      action: "UPDATE";
      phrase: string;
      normalizedPhrase: string;
      productSku: string;
      previousSku: string;
    }
  | {
      action: "REACTIVATE";
      phrase: string;
      normalizedPhrase: string;
      productSku: string;
    };

export function planAliasWrite(input: AliasWriteInput): AliasWritePlan {
  const phrase = input.phrase.trim().replace(/\s+/g, " ");
  const normalizedPhrase = normalizeAliasPhrase(phrase);

  if (
    !phrase ||
    !normalizedPhrase ||
    phrase.length > MAX_ALIAS_PHRASE_LENGTH ||
    normalizedPhrase.length > MAX_ALIAS_PHRASE_LENGTH ||
    !isValidSku(input.selectedSku)
  ) {
    return { action: "SKIP" };
  }

  const selectedSku = input.selectedSku;

  if (!input.existing) {
    // Confirming an already-correct automatic match does not create a second
    // copy of the catalogue name as an alias.
    if (input.parsedSku === selectedSku) {
      return { action: "SKIP" };
    }

    return {
      action: "CREATE",
      phrase,
      normalizedPhrase,
      productSku: selectedSku,
    };
  }

  if (input.existing.productSku !== selectedSku) {
    return {
      action: "UPDATE",
      phrase,
      normalizedPhrase,
      productSku: selectedSku,
      previousSku: input.existing.productSku,
    };
  }

  if (!input.existing.isActive) {
    return {
      action: "REACTIVATE",
      phrase,
      normalizedPhrase,
      productSku: selectedSku,
    };
  }

  return { action: "SKIP" };
}
