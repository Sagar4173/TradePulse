import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planStockReservation,
  stockEffectForTransition,
} from "../stock";

describe("stock reservation planning", () => {
  const inventory = new Map([
    ["SKU-A", { stockCases: 10, reservedCases: 2 }],
    ["SKU-B", { stockCases: 5, reservedCases: 0 }],
    ["SKU-C", { stockCases: 8, reservedCases: 8 }],
  ]);

  it("reserves paid and free cases together when stock is sufficient", () => {
    assert.deepEqual(
      planStockReservation(
        [
          { sku: "SKU-B", cases: 2 },
          { sku: "SKU-A", cases: 8 },
        ],
        inventory,
      ),
      {
        ok: true,
        reservations: [
          { sku: "SKU-A", cases: 8 },
          { sku: "SKU-B", cases: 2 },
        ],
      },
    );
  });

  it("reports every shortage without partially succeeding", () => {
    assert.deepEqual(
      planStockReservation(
        [
          { sku: "SKU-A", cases: 9 },
          { sku: "SKU-C", cases: 1 },
          { sku: "SKU-MISSING", cases: 1 },
        ],
        inventory,
      ),
      {
        ok: false,
        shortages: [
          { sku: "SKU-A", requestedCases: 9, availableCases: 8 },
          { sku: "SKU-C", requestedCases: 1, availableCases: 0 },
          { sku: "SKU-MISSING", requestedCases: 1, availableCases: 0 },
        ],
      },
    );
  });

  it("aggregates duplicate product lines before checking availability", () => {
    assert.deepEqual(
      planStockReservation(
        [
          { sku: "SKU-B", cases: 2 },
          { sku: "SKU-B", cases: 4 },
        ],
        inventory,
      ),
      {
        ok: false,
        shortages: [
          { sku: "SKU-B", requestedCases: 6, availableCases: 5 },
        ],
      },
    );
  });

  it("rejects invalid quantities", () => {
    assert.throws(
      () => planStockReservation([{ sku: "SKU-A", cases: 0 }], inventory),
      /cases/i,
    );
    assert.throws(
      () => planStockReservation([{ sku: "", cases: 1 }], inventory),
      /sku/i,
    );
  });
});

describe("stock lifecycle effects", () => {
  it("reserves stock when a credit hold is released into approval", () => {
    assert.deepEqual(
      stockEffectForTransition("ON_CREDIT_HOLD", "APPROVED", "NONE"),
      { ok: true, operation: "RESERVE", nextState: "RESERVED" },
    );
    assert.deepEqual(
      stockEffectForTransition("ON_CREDIT_HOLD", "APPROVED", "RELEASED"),
      { ok: true, operation: "RESERVE", nextState: "RESERVED" },
    );
  });

  it("does not reserve twice for an already reserved approval", () => {
    assert.deepEqual(
      stockEffectForTransition("PENDING_REVIEW", "APPROVED", "RESERVED"),
      { ok: true, operation: "NONE", nextState: "RESERVED" },
    );
  });

  it("releases a reservation exactly once on rejection or cancellation", () => {
    assert.deepEqual(
      stockEffectForTransition("PENDING_REVIEW", "REJECTED", "RESERVED"),
      { ok: true, operation: "RELEASE", nextState: "RELEASED" },
    );
    assert.deepEqual(
      stockEffectForTransition("PENDING_REVIEW", "CANCELLED", "RESERVED"),
      { ok: true, operation: "RELEASE", nextState: "RELEASED" },
    );
    assert.deepEqual(
      stockEffectForTransition("ON_CREDIT_HOLD", "CANCELLED", "NONE"),
      { ok: true, operation: "NONE", nextState: "NONE" },
    );
    assert.deepEqual(
      stockEffectForTransition("APPROVED", "CANCELLED", "RELEASED"),
      { ok: true, operation: "NONE", nextState: "RELEASED" },
    );
  });

  it("deducts reserved stock exactly once on dispatch", () => {
    assert.deepEqual(
      stockEffectForTransition("READY_FOR_DISPATCH", "DISPATCHED", "RESERVED"),
      { ok: true, operation: "DEDUCT", nextState: "DEDUCTED" },
    );
    assert.deepEqual(
      stockEffectForTransition("READY_FOR_DISPATCH", "DISPATCHED", "DEDUCTED"),
      { ok: true, operation: "NONE", nextState: "DEDUCTED" },
    );
  });

  it("rejects dispatch without a reservation", () => {
    assert.deepEqual(
      stockEffectForTransition("READY_FOR_DISPATCH", "DISPATCHED", "NONE"),
      { ok: false, code: "INVALID_STOCK_STATE" },
    );
  });

  it("leaves stock untouched for non-stock transitions", () => {
    assert.deepEqual(
      stockEffectForTransition("APPROVED", "PROCESSING", "RESERVED"),
      { ok: true, operation: "NONE", nextState: "RESERVED" },
    );
    assert.deepEqual(
      stockEffectForTransition("DISPATCHED", "DELIVERED", "DEDUCTED"),
      { ok: true, operation: "NONE", nextState: "DEDUCTED" },
    );
  });
});
