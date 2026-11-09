import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MoneyValueError,
  formatBasisPointsPercent,
  formatPaise,
  multiplyByQuantity,
  paiseToDecimalString,
  parseMoneyToPaise,
  parsePercentToBasisPoints,
  percentageOf,
} from "../money";

describe("parseMoneyToPaise", () => {
  it("parses whole and fractional rupees without floating point", () => {
    assert.equal(parseMoneyToPaise("9.50"), 950n);
    assert.equal(parseMoneyToPaise("9.5"), 950n);
    assert.equal(parseMoneyToPaise("0"), 0n);
    assert.equal(parseMoneyToPaise("112.00"), 11200n);
    assert.equal(
      parseMoneyToPaise({ toString: () => "18.00" }),
      1800n,
    );
  });

  it("rejects malformed, negative and over-precision amounts", () => {
    for (const value of ["", "9.555", "-1.00", "1,000.00", "abc", "9.", ".50"]) {
      assert.throws(() => parseMoneyToPaise(value), MoneyValueError, value);
    }

    assert.throws(() => parseMoneyToPaise(9.5), MoneyValueError);
  });
});

describe("parsePercentToBasisPoints", () => {
  it("parses percentages into basis points", () => {
    assert.equal(parsePercentToBasisPoints("3.00"), 300n);
    assert.equal(parsePercentToBasisPoints("18"), 1800n);
    assert.equal(parsePercentToBasisPoints("0"), 0n);
    assert.equal(parsePercentToBasisPoints("100"), 10000n);
    assert.equal(parsePercentToBasisPoints("3.5"), 350n);
  });

  it("rejects malformed, negative and over-100 percentages", () => {
    for (const value of ["", "100.01", "-1", "3.555", "abc"]) {
      assert.throws(
        () => parsePercentToBasisPoints(value),
        MoneyValueError,
        value,
      );
    }
  });
});

describe("percentageOf", () => {
  it("calculates the 3% detergent slab exactly", () => {
    assert.equal(percentageOf(56000n, 300n), 1680n);
  });

  it("rounds GST half-up to the nearest paise", () => {
    assert.equal(percentageOf(54320n, 1800n), 9778n);
    assert.equal(percentageOf(1n, 5000n), 1n);
  });

  it("returns zero for a zero amount", () => {
    assert.equal(percentageOf(0n, 1800n), 0n);
  });

  it("rejects negative amounts", () => {
    assert.throws(() => percentageOf(-1n, 1800n), MoneyValueError);
  });
});

describe("multiplyByQuantity", () => {
  it("multiplies exact unit prices by an integer quantity", () => {
    assert.equal(multiplyByQuantity(950n, 10), 9500n);
    assert.equal(multiplyByQuantity(11200n, 5), 56000n);
  });

  it("rejects non-integer and negative quantities", () => {
    assert.throws(() => multiplyByQuantity(950n, -1), MoneyValueError);
    assert.throws(() => multiplyByQuantity(950n, 1.5), MoneyValueError);
  });
});

describe("paiseToDecimalString", () => {
  it("converts integer paise to an exact two-decimal string", () => {
    assert.equal(paiseToDecimalString(0n), "0.00");
    assert.equal(paiseToDecimalString(5n), "0.05");
    assert.equal(paiseToDecimalString(950n), "9.50");
    assert.equal(paiseToDecimalString(100_000n), "1000.00");
    assert.equal(paiseToDecimalString(12_345_678n), "123456.78");
  });

  it("rejects negative values", () => {
    assert.throws(() => paiseToDecimalString(-1n), MoneyValueError);
  });
});

describe("formatPaise", () => {
  it("formats Indian currency with two decimal places", () => {
    assert.equal(formatPaise(11210n), "₹112.10");
    assert.equal(formatPaise(64098n), "₹640.98");
    assert.equal(formatPaise(100000n), "₹1,000.00");
    assert.equal(formatPaise(0n), "₹0.00");
    assert.equal(formatPaise(-950n), "-₹9.50");
  });
});

describe("formatBasisPointsPercent", () => {
  it("formats percentages without unnecessary decimals", () => {
    assert.equal(formatBasisPointsPercent(1800n), "18");
    assert.equal(formatBasisPointsPercent(300n), "3");
    assert.equal(formatBasisPointsPercent(350n), "3.5");
    assert.equal(formatBasisPointsPercent(355n), "3.55");
    assert.equal(formatBasisPointsPercent(0n), "0");
  });
});
