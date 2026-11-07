import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeEligibleSchemes, describeScheme } from "../scheme-labels";
import type { SchemeCandidate } from "../../schemes/engine";

const NOW = new Date("2026-11-07T12:00:00.000Z");

function scheme(overrides: Partial<SchemeCandidate>): SchemeCandidate {
  return {
    id: "scheme",
    type: "BUY_X_GET_Y",
    isActive: true,
    startsAt: null,
    endsAt: null,
    minimumQuantity: 10,
    freeQuantity: 1,
    discountPercent: null,
    ...overrides,
  };
}

describe("describeScheme", () => {
  it("describes Buy X Get Y mechanics", () => {
    assert.equal(
      describeScheme(scheme({ minimumQuantity: 10, freeQuantity: 1 })),
      "Buy 10, get 1 free",
    );
  });

  it("describes percentage discounts with and without a minimum", () => {
    assert.equal(
      describeScheme(
        scheme({
          type: "PERCENTAGE_DISCOUNT",
          minimumQuantity: 5,
          freeQuantity: null,
          discountPercent: "3.00",
        }),
      ),
      "3% off on 5+ cases",
    );

    assert.equal(
      describeScheme(
        scheme({
          type: "PERCENTAGE_DISCOUNT",
          minimumQuantity: null,
          freeQuantity: null,
          discountPercent: "2.50",
        }),
      ),
      "2.5% off",
    );
  });

  it("returns null for malformed or unknown schemes", () => {
    assert.equal(describeScheme(scheme({ minimumQuantity: null })), null);
    assert.equal(describeScheme(scheme({ freeQuantity: 0 })), null);
    assert.equal(
      describeScheme(
        scheme({
          type: "PERCENTAGE_DISCOUNT",
          discountPercent: null,
        }),
      ),
      null,
    );
    assert.equal(describeScheme(scheme({ type: "BOGUS" })), null);
  });
});

describe("describeEligibleSchemes", () => {
  it("drops inactive, future and expired schemes", () => {
    assert.deepEqual(
      describeEligibleSchemes(
        [
          scheme({ id: "active" }),
          scheme({ id: "inactive", isActive: false }),
          scheme({
            id: "future",
            startsAt: new Date("2026-12-01T00:00:00.000Z"),
          }),
          scheme({
            id: "expired",
            endsAt: new Date("2026-10-01T00:00:00.000Z"),
          }),
        ],
        NOW,
      ),
      ["Buy 10, get 1 free"],
    );
  });
});
