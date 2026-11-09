import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAliasPhrase,
  normalizeText,
  normalizeToken,
} from "../normalize";

describe("normalizeText", () => {
  it("lowercases, collapses whitespace and strips control characters", () => {
    assert.equal(
      normalizeText("  Bhaiya,\u0000  FIVE\tPeti  BISCUIT!!  "),
      "bhaiya, five peti biscuit!!",
    );
  });

  it("converts Devanagari digits and transliterates common words", () => {
    assert.equal(normalizeText("५ पेटी बिस्किट"), "5 peti biscuit");
    assert.equal(normalizeText("२ पेटी वाशिंग पाउडर"), "2 peti detergent powder");
    assert.equal(
      normalizeText("५ पेटी ग्लूकोज बिस्किट"),
      "5 peti glucose biscuit",
    );
    assert.equal(
      normalizeText("२ पेटी डिटर्जेंट पाउडर"),
      "2 peti detergent powder",
    );
  });

  it("canonicalises common Hindi and Hinglish spelling variants", () => {
    assert.equal(normalizeText("biskut, biscut aur biskit"), "biscuit, biscuit aur biscuit");
    assert.equal(normalizeText("washing powder"), "detergent powder");
    assert.equal(normalizeText("chai patti 250 wala"), "tea leaf 250 wala");
    assert.equal(normalizeText("petee / petti"), "peti / peti");
  });

  it("keeps alias phrases descriptive instead of removing size words", () => {
    assert.equal(normalizeAliasPhrase("  Chhota BISKUT!! "), "chhota biscuit");
  });

  it("normalizes a single token without punctuation", () => {
    assert.equal(normalizeToken("  Biskut!! "), "biscuit");
    assert.equal(normalizeToken("५"), "5");
  });
});
