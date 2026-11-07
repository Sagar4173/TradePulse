/**
 * Human-readable scheme mechanics for catalogue cards. This module only
 * describes configuration; eligibility and monetary benefits are decided by
 * the scheme engine.
 */

import {
  formatBasisPointsPercent,
  parsePercentToBasisPoints,
} from "../money";
import {
  isSchemeEligible,
  type SchemeCandidate,
} from "../schemes/engine";

export function describeScheme(scheme: SchemeCandidate): string | null {
  if (scheme.type === "BUY_X_GET_Y") {
    const minimum = scheme.minimumQuantity;
    const free = scheme.freeQuantity;

    if (
      !Number.isSafeInteger(minimum) ||
      (minimum as number) < 1 ||
      !Number.isSafeInteger(free) ||
      (free as number) < 1
    ) {
      return null;
    }

    return `Buy ${minimum}, get ${free} free`;
  }

  if (scheme.type === "PERCENTAGE_DISCOUNT") {
    if (scheme.discountPercent === null) {
      return null;
    }

    let basisPoints: bigint;

    try {
      basisPoints = parsePercentToBasisPoints(scheme.discountPercent);
    } catch {
      return null;
    }

    if (basisPoints === 0n) {
      return null;
    }

    const percent = formatBasisPointsPercent(basisPoints);
    const minimum = scheme.minimumQuantity;

    if (Number.isSafeInteger(minimum) && (minimum as number) > 0) {
      return `${percent}% off on ${minimum}+ cases`;
    }

    return `${percent}% off`;
  }

  return null;
}

export function describeEligibleSchemes(
  schemes: readonly SchemeCandidate[],
  now: Date = new Date(),
): string[] {
  const labels = new Set<string>();

  for (const scheme of schemes) {
    if (!isSchemeEligible(scheme, now)) {
      continue;
    }

    const label = describeScheme(scheme);

    if (label) {
      labels.add(label);
    }
  }

  return [...labels];
}
