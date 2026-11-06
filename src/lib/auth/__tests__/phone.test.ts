import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AmbiguousPhoneMatchError,
  findUniqueNormalizedPhoneMatch,
  formatPhoneForDisplay,
  maskPhone,
  normalizeIndianPhone,
  phoneLookupVariants,
} from "../phone";

describe("normalizeIndianPhone", () => {
  const validNumbers = [
    "9876543210",
    "+91 98765 43210",
    "+91-98765-43210",
    "919876543210",
    "09876543210",
    " 98765-43210 ",
  ];

  for (const input of validNumbers) {
    it(`normalizes ${JSON.stringify(input)} to +91 E.164`, () => {
      assert.equal(normalizeIndianPhone(input), "+919876543210");
    });
  }

  const invalidNumbers = [
    "",
    "12345",
    "5876543210",
    "+1 9876543210",
    "+44 9876543210",
    "98765abcde",
    "98765432101",
  ];

  for (const input of invalidNumbers) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeIndianPhone(input), null);
    });
  }
});

describe("phone display", () => {
  it("formats an Indian E.164 number for humans", () => {
    assert.equal(formatPhoneForDisplay("+919876543210"), "+91 98765 43210");
  });

  it("masks all but the last four digits", () => {
    assert.equal(maskPhone("+919876543210"), "+91 ••••••3210");
  });

  it("includes the legacy formatted lookup variant", () => {
    assert.ok(
      phoneLookupVariants("+919876543210").includes("+91-98765-43210"),
    );
  });
});

describe("normalized phone match selection", () => {
  it("selects the single row with a differently formatted phone", () => {
    const match = findUniqueNormalizedPhoneMatch(
      [
        { id: "user_1", phone: "+91 90000 00001" },
        { id: "user_2", phone: "+919000000002" },
      ],
      "+919000000001",
    );

    assert.equal(match?.id, "user_1");
  });

  it("returns null when no row normalizes to the phone", () => {
    assert.equal(
      findUniqueNormalizedPhoneMatch(
        [{ id: "user_1", phone: "+919000000002" }],
        "+919000000001",
      ),
      null,
    );
  });

  it("throws an explicit ambiguity error instead of treating duplicates as missing", () => {
    assert.throws(
      () =>
        findUniqueNormalizedPhoneMatch(
          [
            { id: "user_1", phone: "+919000000001" },
            { id: "user_2", phone: "+91-90000-00001" },
          ],
          "+919000000001",
        ),
      AmbiguousPhoneMatchError,
    );
  });
});
