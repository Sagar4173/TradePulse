import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOW_STOCK_THRESHOLD,
  calculateStock,
} from "../stock";

describe("calculateStock", () => {
  it("reports available cases minus reservations", () => {
    assert.deepEqual(calculateStock({ stockCases: 340, reservedCases: 12 }), {
      status: "IN_STOCK",
      availableCases: 328,
    });
  });

  it("treats ten or fewer available cases as low stock", () => {
    assert.deepEqual(calculateStock({ stockCases: 10, reservedCases: 0 }), {
      status: "LOW_STOCK",
      availableCases: 10,
    });
    assert.deepEqual(calculateStock({ stockCases: 11, reservedCases: 1 }), {
      status: "LOW_STOCK",
      availableCases: 10,
    });
    assert.deepEqual(calculateStock({ stockCases: 1, reservedCases: 0 }), {
      status: "LOW_STOCK",
      availableCases: 1,
    });
  });

  it("treats quantities above the threshold as in stock", () => {
    assert.deepEqual(
      calculateStock({
        stockCases: LOW_STOCK_THRESHOLD + 1,
        reservedCases: 0,
      }),
      { status: "IN_STOCK", availableCases: LOW_STOCK_THRESHOLD + 1 },
    );
  });

  it("reports out of stock when stock is zero", () => {
    assert.deepEqual(calculateStock({ stockCases: 0, reservedCases: 0 }), {
      status: "OUT_OF_STOCK",
      availableCases: 0,
    });
  });

  it("never reports negative availability", () => {
    assert.deepEqual(calculateStock({ stockCases: 3, reservedCases: 5 }), {
      status: "OUT_OF_STOCK",
      availableCases: 0,
    });
  });

  it("reports unavailable when no inventory record exists", () => {
    assert.deepEqual(calculateStock(null), {
      status: "UNAVAILABLE",
      availableCases: null,
    });
    assert.deepEqual(calculateStock(undefined), {
      status: "UNAVAILABLE",
      availableCases: null,
    });
  });
});
