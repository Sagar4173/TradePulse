import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_ORDER_SEQUENCE,
  formatOrderNumber,
} from "../order-number";

describe("order number formatting", () => {
  it("formats a sequence using the Asia/Kolkata calendar date", () => {
    assert.equal(
      formatOrderNumber(new Date("2026-11-07T18:29:59.000Z"), 1),
      "TP-20261107-000001",
    );
  });

  it("rolls to the next date at midnight Asia/Kolkata", () => {
    assert.equal(
      formatOrderNumber(new Date("2026-11-07T18:30:00.000Z"), 42),
      "TP-20261108-000042",
    );
  });

  it("pads the sequence to six digits", () => {
    assert.equal(
      formatOrderNumber(new Date("2026-01-02T00:00:00.000Z"), MAX_ORDER_SEQUENCE),
      "TP-20260102-999999",
    );
  });

  it("rejects sequences outside the six-digit range", () => {
    assert.throws(
      () => formatOrderNumber(new Date("2026-11-07T00:00:00.000Z"), 0),
      /sequence/i,
    );
    assert.throws(
      () =>
        formatOrderNumber(
          new Date("2026-11-07T00:00:00.000Z"),
          MAX_ORDER_SEQUENCE + 1,
        ),
      /sequence/i,
    );
    assert.throws(
      () => formatOrderNumber(new Date("2026-11-07T00:00:00.000Z"), 1.5),
      /sequence/i,
    );
  });

  it("rejects an invalid date", () => {
    assert.throws(
      () => formatOrderNumber(new Date(Number.NaN), 1),
      /date/i,
    );
  });
});
