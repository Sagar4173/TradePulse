import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREDIT_EXPOSURE_STATUSES,
  assessCredit,
  isCreditExposureStatus,
  sumOpenOrderExposure,
} from "../credit";

describe("credit exposure", () => {
  it("includes credit-held and in-flight orders in exposure", () => {
    for (const status of [
      "PENDING_REVIEW",
      "ON_CREDIT_HOLD",
      "APPROVED",
      "PROCESSING",
      "READY_FOR_DISPATCH",
      "DISPATCHED",
      "DELIVERED",
      "FULFILLED",
    ]) {
      assert.equal(isCreditExposureStatus(status), true, status);
    }

    assert.deepEqual(
      [...CREDIT_EXPOSURE_STATUSES].sort(),
      [
        "APPROVED",
        "DELIVERED",
        "DISPATCHED",
        "FULFILLED",
        "ON_CREDIT_HOLD",
        "PENDING_REVIEW",
        "PROCESSING",
        "READY_FOR_DISPATCH",
      ].sort(),
    );
  });

  it("excludes draft, rejected, and cancelled orders from exposure", () => {
    for (const status of ["DRAFT", "REJECTED", "CANCELLED"]) {
      assert.equal(isCreditExposureStatus(status), false, status);
    }
  });

  it("sums only open orders using exact paise", () => {
    assert.equal(
      sumOpenOrderExposure([
        { status: "PENDING_REVIEW", totalPaise: 10_000n },
        { status: "ON_CREDIT_HOLD", totalPaise: 25_000n },
        { status: "DRAFT", totalPaise: 99_000n },
        { status: "REJECTED", totalPaise: 88_000n },
        { status: "CANCELLED", totalPaise: 77_000n },
        { status: "DELIVERED", totalPaise: 5_000n },
      ]),
      40_000n,
    );
  });

  it("passes when projected exposure is exactly at the limit", () => {
    assert.deepEqual(
      assessCredit({
        creditLimitPaise: 100_000n,
        openExposurePaise: 60_000n,
        orderTotalPaise: 40_000n,
      }),
      {
        passed: true,
        projectedExposurePaise: 100_000n,
        availableCreditPaise: 40_000n,
      },
    );
  });

  it("fails by one paise above the limit", () => {
    assert.deepEqual(
      assessCredit({
        creditLimitPaise: 100_000n,
        openExposurePaise: 60_000n,
        orderTotalPaise: 40_001n,
      }),
      {
        passed: false,
        projectedExposurePaise: 100_001n,
        availableCreditPaise: 40_000n,
      },
    );
  });

  it("keeps available credit at zero when exposure already exceeds the limit", () => {
    assert.deepEqual(
      assessCredit({
        creditLimitPaise: 50_000n,
        openExposurePaise: 70_000n,
        orderTotalPaise: 1n,
      }),
      {
        passed: false,
        projectedExposurePaise: 70_001n,
        availableCreditPaise: 0n,
      },
    );
  });

  it("rejects negative monetary inputs", () => {
    assert.throws(
      () =>
        assessCredit({
          creditLimitPaise: -1n,
          openExposurePaise: 0n,
          orderTotalPaise: 0n,
        }),
      /credit limit/i,
    );
    assert.throws(
      () =>
        assessCredit({
          creditLimitPaise: 1n,
          openExposurePaise: -1n,
          orderTotalPaise: 0n,
        }),
      /exposure/i,
    );
    assert.throws(
      () =>
        assessCredit({
          creditLimitPaise: 1n,
          openExposurePaise: 0n,
          orderTotalPaise: -1n,
        }),
      /order total/i,
    );
  });
});
