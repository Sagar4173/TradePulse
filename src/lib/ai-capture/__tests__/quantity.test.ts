import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCasePackSize,
  parseNumberToken,
  parsePackSizeHint,
  unitKindForToken,
} from "../quantity";

describe("parseNumberToken", () => {
  it("parses digits and common Hindi number words", () => {
    assert.equal(parseNumberToken("5"), 5);
    assert.equal(parseNumberToken("५"), 5);
    assert.equal(parseNumberToken("ek"), 1);
    assert.equal(parseNumberToken("paanch"), 5);
    assert.equal(parseNumberToken("bees"), 20);
    assert.equal(parseNumberToken("sau"), 100);
  });

  it("parses fractional Hindi quantities without rounding", () => {
    assert.equal(parseNumberToken("dedh"), 1.5);
    assert.equal(parseNumberToken("dhai"), 2.5);
  });

  it("keeps decimal quantities exact", () => {
    assert.equal(parseNumberToken("0.5"), 0.5);
    assert.equal(parseNumberToken("2.5"), 2.5);
  });

  it("rejects signs, fractions, ranges and malformed decimals", () => {
    assert.equal(parseNumberToken("1/2"), null);
    assert.equal(parseNumberToken("1-2"), null);
    assert.equal(parseNumberToken("-2"), null);
    assert.equal(parseNumberToken("+2"), null);
    assert.equal(parseNumberToken(".5"), null);
    assert.equal(parseNumberToken("1.2.3"), null);
  });

  it("tolerates surrounding punctuation without inventing a value", () => {
    assert.equal(parseNumberToken("(5)"), 5);
    assert.equal(parseNumberToken("5,"), 5);
    assert.equal(parseNumberToken("5."), 5);
  });

  it("rejects non-numbers", () => {
    assert.equal(parseNumberToken("biscuit"), null);
    assert.equal(parseNumberToken(""), null);
  });
});

describe("case pack sizes", () => {
  it("reads only explicit Case of N labels", () => {
    assert.equal(parseCasePackSize("Case of 96"), 96);
    assert.equal(parseCasePackSize("case of 20"), 20);
    assert.equal(parseCasePackSize("Case of 0"), null);
    assert.equal(parseCasePackSize("Case of 1.5"), null);
    assert.equal(parseCasePackSize("Box of 20"), null);
    assert.equal(parseCasePackSize("20 per case"), null);
  });
});

describe("pack size hints", () => {
  it("extracts weight and volume hints without treating them as quantities", () => {
    assert.equal(parsePackSizeHint("washing powder 1 kilo"), "1 kg");
    assert.equal(parsePackSizeHint("biscuit 75g"), "75 g");
    assert.equal(parsePackSizeHint("tea 250 wala"), "250");
    assert.equal(parsePackSizeHint("oil 1 litre"), "1 l");
  });

  it("returns null when no pack size is present", () => {
    assert.equal(parsePackSizeHint("glucose biscuit"), null);
  });
});

describe("unitKindForToken", () => {
  it("classifies case, piece, weight and volume words", () => {
    assert.equal(unitKindForToken("peti"), "CASE");
    assert.equal(unitKindForToken("box"), "CASE");
    assert.equal(unitKindForToken("packet"), "PIECE");
    assert.equal(unitKindForToken("pcs"), "PIECE");
    assert.equal(unitKindForToken("kilo"), "WEIGHT");
    assert.equal(unitKindForToken("litre"), "VOLUME");
    assert.equal(unitKindForToken("biscuit"), null);
  });
});
