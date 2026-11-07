import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addCartLine,
  clearCartLines,
  removeCartLine,
  updateCartLine,
  validateRequestedQuantity,
} from "../lines";
import { MAX_CART_LINES } from "../cookie";

describe("addCartLine", () => {
  it("adds a new line and merges an existing SKU", () => {
    const first = addCartLine([], { sku: "SKU-BS-075", quantity: 2 });
    assert.equal(first.ok, true);

    if (!first.ok) {
      return;
    }

    const second = addCartLine(first.lines, {
      sku: "SKU-BS-075",
      quantity: 3,
    });

    assert.equal(second.ok, true);

    if (second.ok) {
      assert.deepEqual(second.lines, [{ sku: "SKU-BS-075", quantity: 5 }]);
    }
  });

  it("rejects invalid quantities and SKUs", () => {
    for (const quantity of [0, -1, 1.5, 1000, Number.NaN]) {
      assert.deepEqual(
        addCartLine([], { sku: "SKU-BS-075", quantity }),
        { ok: false, code: "INVALID_QUANTITY" },
      );
    }

    assert.deepEqual(
      addCartLine([], { sku: "../bad", quantity: 1 }),
      { ok: false, code: "INVALID_SKU" },
    );
  });

  it("rejects a merged quantity above the per-line maximum", () => {
    const existing = [{ sku: "SKU-BS-075", quantity: 999 }];

    assert.deepEqual(
      addCartLine(existing, { sku: "SKU-BS-075", quantity: 1 }),
      { ok: false, code: "QUANTITY_LIMIT" },
    );
  });

  it("rejects a new line when the cart is full", () => {
    const full = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      sku: `SKU-${index}`,
      quantity: 1,
    }));

    assert.deepEqual(
      addCartLine(full, { sku: "SKU-NEW", quantity: 1 }),
      { ok: false, code: "CART_FULL" },
    );
  });
});

describe("updateCartLine", () => {
  const lines = [{ sku: "SKU-BS-075", quantity: 2 }];

  it("replaces the quantity of an existing line", () => {
    assert.deepEqual(updateCartLine(lines, "SKU-BS-075", 7), {
      ok: true,
      lines: [{ sku: "SKU-BS-075", quantity: 7 }],
    });
  });

  it("reports missing lines and invalid quantities", () => {
    assert.deepEqual(updateCartLine(lines, "SKU-MISSING", 1), {
      ok: false,
      code: "LINE_NOT_FOUND",
    });
    assert.deepEqual(updateCartLine(lines, "SKU-BS-075", 0), {
      ok: false,
      code: "INVALID_QUANTITY",
    });
    assert.deepEqual(updateCartLine(lines, "SKU-BS-075", 2.5), {
      ok: false,
      code: "INVALID_QUANTITY",
    });
  });
});

describe("removeCartLine / clearCartLines", () => {
  it("removes one line without mutating the input", () => {
    const lines = [
      { sku: "SKU-A", quantity: 1 },
      { sku: "SKU-B", quantity: 2 },
    ];

    assert.deepEqual(removeCartLine(lines, "SKU-A"), [
      { sku: "SKU-B", quantity: 2 },
    ]);
    assert.equal(lines.length, 2);
    assert.deepEqual(clearCartLines(), []);
  });
});

describe("validateRequestedQuantity", () => {
  it("accepts quantities within available stock", () => {
    assert.deepEqual(validateRequestedQuantity(5, 10), { ok: true });
    assert.deepEqual(validateRequestedQuantity(10, 10), { ok: true });
  });

  it("rejects invalid quantities", () => {
    for (const quantity of [0, -3, 1.5, Number.NaN]) {
      assert.deepEqual(validateRequestedQuantity(quantity, 10), {
        ok: false,
        code: "INVALID_QUANTITY",
      });
    }
  });

  it("rejects unavailable, empty and insufficient stock", () => {
    assert.deepEqual(validateRequestedQuantity(1, null), {
      ok: false,
      code: "STOCK_UNAVAILABLE",
    });
    assert.deepEqual(validateRequestedQuantity(1, 0), {
      ok: false,
      code: "OUT_OF_STOCK",
    });
    assert.deepEqual(validateRequestedQuantity(6, 5), {
      ok: false,
      code: "INSUFFICIENT_STOCK",
      availableCases: 5,
    });
  });
});
