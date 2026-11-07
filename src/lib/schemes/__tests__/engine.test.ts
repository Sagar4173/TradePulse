import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateScheme,
  isSchemeEligible,
  selectBestScheme,
  type SchemeCandidate,
} from "../engine";

const NOW = new Date("2026-11-07T12:00:00.000Z");

function buyXGetY(
  overrides: Partial<SchemeCandidate> = {},
): SchemeCandidate {
  return {
    id: "scheme_buy_10_get_1",
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

function percentage(
  overrides: Partial<SchemeCandidate> = {},
): SchemeCandidate {
  return {
    id: "scheme_3pct_5plus",
    type: "PERCENTAGE_DISCOUNT",
    isActive: true,
    startsAt: null,
    endsAt: null,
    minimumQuantity: 5,
    freeQuantity: null,
    discountPercent: "3.00",
    ...overrides,
  };
}

const BISCUIT = { paidQuantity: 10, unitPricePaise: 950n, now: NOW };
const DETERGENT = { paidQuantity: 5, unitPricePaise: 11_200n, now: NOW };

describe("isSchemeEligible", () => {
  it("requires the scheme to be active", () => {
    assert.equal(isSchemeEligible(buyXGetY(), NOW), true);
    assert.equal(isSchemeEligible(buyXGetY({ isActive: false }), NOW), false);
  });

  it("enforces the validity window inclusively", () => {
    assert.equal(
      isSchemeEligible(
        buyXGetY({ startsAt: new Date("2026-11-07T12:00:00.000Z") }),
        NOW,
      ),
      true,
    );
    assert.equal(
      isSchemeEligible(
        buyXGetY({ startsAt: new Date("2026-11-07T12:00:00.001Z") }),
        NOW,
      ),
      false,
    );
    assert.equal(
      isSchemeEligible(
        buyXGetY({ endsAt: new Date("2026-11-07T12:00:00.000Z") }),
        NOW,
      ),
      true,
    );
    assert.equal(
      isSchemeEligible(
        buyXGetY({ endsAt: new Date("2026-11-07T11:59:59.999Z") }),
        NOW,
      ),
      false,
    );
  });
});

describe("evaluateScheme: BUY_X_GET_Y", () => {
  it("grants one free case for each completed block of ten", () => {
    assert.deepEqual(evaluateScheme(buyXGetY(), BISCUIT), {
      schemeId: "scheme_buy_10_get_1",
      type: "BUY_X_GET_Y",
      paidQuantity: 10,
      freeQuantity: 1,
      fulfilledQuantity: 11,
      discountPaise: 950n,
    });

    assert.deepEqual(
      evaluateScheme(buyXGetY(), { ...BISCUIT, paidQuantity: 20 }),
      {
        schemeId: "scheme_buy_10_get_1",
        type: "BUY_X_GET_Y",
        paidQuantity: 20,
        freeQuantity: 2,
        fulfilledQuantity: 22,
        discountPaise: 1_900n,
      },
    );
  });

  it("does not apply below the minimum quantity", () => {
    assert.equal(
      evaluateScheme(buyXGetY(), { ...BISCUIT, paidQuantity: 9 }),
      null,
    );
  });

  it("ignores incomplete blocks above the minimum", () => {
    const applied = evaluateScheme(buyXGetY(), {
      ...BISCUIT,
      paidQuantity: 19,
    });

    assert.equal(applied?.freeQuantity, 1);
    assert.equal(applied?.discountPaise, 950n);
  });

  it("rejects incomplete Buy X Get Y configuration", () => {
    assert.equal(
      evaluateScheme(buyXGetY({ minimumQuantity: null }), BISCUIT),
      null,
    );
    assert.equal(
      evaluateScheme(buyXGetY({ freeQuantity: null }), BISCUIT),
      null,
    );
    assert.equal(
      evaluateScheme(buyXGetY({ freeQuantity: 0 }), BISCUIT),
      null,
    );
  });
});

describe("evaluateScheme: PERCENTAGE_DISCOUNT", () => {
  it("applies the three percent detergent slab from five cases", () => {
    assert.deepEqual(evaluateScheme(percentage(), DETERGENT), {
      schemeId: "scheme_3pct_5plus",
      type: "PERCENTAGE_DISCOUNT",
      paidQuantity: 5,
      freeQuantity: 0,
      fulfilledQuantity: 5,
      discountPaise: 1_680n,
    });
  });

  it("enforces the minimum quantity", () => {
    assert.equal(
      evaluateScheme(percentage(), { ...DETERGENT, paidQuantity: 4 }),
      null,
    );
  });

  it("applies to any quantity when no minimum is configured", () => {
    const applied = evaluateScheme(
      percentage({ minimumQuantity: null }),
      { ...DETERGENT, paidQuantity: 1 },
    );

    assert.equal(applied?.discountPaise, 336n);
  });

  it("rejects missing, zero and malformed discounts", () => {
    assert.equal(
      evaluateScheme(percentage({ discountPercent: null }), DETERGENT),
      null,
    );
    assert.equal(
      evaluateScheme(percentage({ discountPercent: "0" }), DETERGENT),
      null,
    );
    assert.equal(
      evaluateScheme(percentage({ discountPercent: "not-a-number" }), DETERGENT),
      null,
    );
    assert.equal(
      evaluateScheme(percentage({ discountPercent: "101" }), DETERGENT),
      null,
    );
  });
});

describe("evaluateScheme: global rules", () => {
  it("does not apply outside the active window", () => {
    assert.equal(
      evaluateScheme(
        buyXGetY({ startsAt: new Date("2026-12-01T00:00:00.000Z") }),
        BISCUIT,
      ),
      null,
    );
    assert.equal(
      evaluateScheme(
        buyXGetY({ endsAt: new Date("2026-10-01T00:00:00.000Z") }),
        BISCUIT,
      ),
      null,
    );
  });

  it("ignores unknown scheme types", () => {
    assert.equal(
      evaluateScheme(buyXGetY({ type: "BOGUS" }), BISCUIT),
      null,
    );
  });
});

describe("selectBestScheme", () => {
  it("applies at most one scheme and chooses the greatest benefit", () => {
    const smaller = percentage({
      id: "scheme_small",
      minimumQuantity: 5,
      discountPercent: "1.00",
    });
    const larger = buyXGetY({ id: "scheme_large" });

    const applied = selectBestScheme([smaller, larger], BISCUIT);

    assert.equal(applied?.schemeId, "scheme_large");
    assert.equal(applied?.discountPaise, 950n);
  });

  it("breaks ties deterministically by scheme id", () => {
    const first = percentage({ id: "scheme_a", minimumQuantity: 10 });
    const second = percentage({ id: "scheme_b", minimumQuantity: 10 });

    assert.equal(
      selectBestScheme([second, first], BISCUIT)?.schemeId,
      "scheme_a",
    );
    assert.equal(
      selectBestScheme([first, second], BISCUIT)?.schemeId,
      "scheme_a",
    );
  });

  it("returns null when no scheme is eligible", () => {
    assert.equal(
      selectBestScheme(
        [
          percentage({ minimumQuantity: 50 }),
          buyXGetY({ isActive: false }),
        ],
        BISCUIT,
      ),
      null,
    );
    assert.equal(selectBestScheme([], BISCUIT), null);
  });
});
