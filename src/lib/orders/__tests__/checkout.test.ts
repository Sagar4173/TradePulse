import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCheckoutFingerprint,
  buildCheckoutReview,
  compareCheckoutReview,
  encodeCheckoutReview,
  parseCheckoutReview,
} from "../checkout";
import type { CheckoutLineLike } from "../checkout";

function line(overrides: Partial<CheckoutLineLike> = {}): CheckoutLineLike {
  return {
    sku: "SKU-A",
    paidQuantity: 2,
    freeQuantity: 1,
    unitPricePaise: 5_000n,
    discountPaise: 5_000n,
    gstPaise: 2_700n,
    totalPaise: 32_700n,
    availableCases: 20,
    scheme: { schemeId: "scheme_a", type: "BUY_X_GET_Y" },
    ...overrides,
  };
}

describe("checkout review fingerprint", () => {
  it("is stable regardless of cart line order", () => {
    const first = line({ sku: "SKU-A" });
    const second = line({ sku: "SKU-B" });

    assert.equal(
      buildCheckoutFingerprint([first, second]),
      buildCheckoutFingerprint([second, first]),
    );
  });

  it("changes when price, stock, quantity, or scheme eligibility changes", () => {
    const base = buildCheckoutFingerprint([line()]);

    assert.notEqual(
      base,
      buildCheckoutFingerprint([line({ unitPricePaise: 5_100n })]),
    );
    assert.notEqual(
      base,
      buildCheckoutFingerprint([line({ availableCases: 19 })]),
    );
    assert.notEqual(
      base,
      buildCheckoutFingerprint([line({ paidQuantity: 3 })]),
    );
    assert.notEqual(
      base,
      buildCheckoutFingerprint([
        line({ scheme: { schemeId: "scheme_b", type: "BUY_X_GET_Y" } }),
      ]),
    );
    assert.notEqual(
      base,
      buildCheckoutFingerprint([line({ scheme: null, freeQuantity: 0 })]),
    );
  });

  it("is a bounded opaque token", () => {
    const fingerprint = buildCheckoutFingerprint([line()]);
    assert.match(fingerprint, /^[A-Za-z0-9_-]{43}$/);
  });
});

describe("checkout review token", () => {
  it("round-trips a review without exposing bigint values", () => {
    const review = buildCheckoutReview([line()]);
    const token = encodeCheckoutReview(review);
    const parsed = parseCheckoutReview(token);

    assert.ok(parsed);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.fingerprint, review.fingerprint);
    assert.deepEqual(parsed.lines, [
      {
        sku: "SKU-A",
        paidQuantity: 2,
        freeQuantity: 1,
        unitPricePaise: "5000",
        discountPaise: "5000",
        gstPaise: "2700",
        totalPaise: "32700",
        availableCases: 20,
        schemeId: "scheme_a",
        schemeType: "BUY_X_GET_Y",
      },
    ]);
  });

  it("rejects malformed, oversized, and unsupported tokens", () => {
    assert.equal(parseCheckoutReview(""), null);
    assert.equal(parseCheckoutReview("not-base64!"), null);
    assert.equal(
      parseCheckoutReview(
        Buffer.from(JSON.stringify({ version: 2, fingerprint: "x", lines: [] }))
          .toString("base64url"),
      ),
      null,
    );
    assert.equal(parseCheckoutReview("A".repeat(20_000)), null);
    assert.equal(
      parseCheckoutReview(
        Buffer.from(
          JSON.stringify({
            version: 1,
            fingerprint: "not-a-fingerprint",
            lines: [],
          }),
        ).toString("base64url"),
      ),
      null,
    );
  });
});

describe("checkout review comparison", () => {
  it("reports no changes when authoritative values are unchanged", () => {
    const review = buildCheckoutReview([line()]);
    assert.deepEqual(compareCheckoutReview(review, [line()]), []);
  });

  it("identifies price, stock, scheme, and quantity changes per line", () => {
    const review = buildCheckoutReview([
      line({ sku: "SKU-A" }),
      line({ sku: "SKU-B" }),
      line({ sku: "SKU-C" }),
      line({ sku: "SKU-D" }),
    ]);

    assert.deepEqual(
      compareCheckoutReview(review, [
        line({ sku: "SKU-A", unitPricePaise: 5_100n }),
        line({ sku: "SKU-B", availableCases: 19 }),
        line({
          sku: "SKU-C",
          scheme: { schemeId: "scheme_b", type: "BUY_X_GET_Y" },
        }),
        line({ sku: "SKU-D", paidQuantity: 4 }),
      ]),
      [
        { sku: "SKU-A", reasons: ["PRICE_CHANGED"] },
        { sku: "SKU-B", reasons: ["STOCK_CHANGED"] },
        { sku: "SKU-C", reasons: ["SCHEME_CHANGED"] },
        { sku: "SKU-D", reasons: ["QUANTITY_CHANGED"] },
      ],
    );
  });

  it("reports removed and newly added lines", () => {
    const review = buildCheckoutReview([line({ sku: "SKU-A" })]);

    assert.deepEqual(
      compareCheckoutReview(review, [line({ sku: "SKU-B" })]),
      [
        { sku: "SKU-A", reasons: ["PRODUCT_UNAVAILABLE"] },
        { sku: "SKU-B", reasons: ["PRODUCT_ADDED"] },
      ],
    );
  });
});
