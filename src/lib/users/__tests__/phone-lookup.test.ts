import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeIndianPhone } from "../../auth/phone";
import {
  buildNormalizedPhoneLookupWhere,
  findExistingUserByPhone,
  type UserPhoneLookupQuery,
} from "../phone-lookup";

const PHONE = "+919876543210";

function captureUser(found: { id: string; name: string } | null) {
  let query: UserPhoneLookupQuery | undefined;

  return {
    finder: async (input: UserPhoneLookupQuery) => {
      query = input;
      return found;
    },
    getQuery: () => query,
  };
}

describe("findExistingUserByPhone", () => {
  it("queries the canonical normalized column exactly", async () => {
    const { finder, getQuery } = captureUser({
      id: "user_1",
      name: "Matched User",
    });

    const match = await findExistingUserByPhone(finder, PHONE);

    assert.equal(match?.id, "user_1");
    assert.deepEqual(getQuery(), {
      where: { phoneNormalized: PHONE },
      select: { id: true, name: true },
    });
  });

  it("returns null when no user has the normalized phone", async () => {
    const { finder } = captureUser(null);

    assert.equal(await findExistingUserByPhone(finder, PHONE), null);
  });

  it("rejects a phone that is not normalized before querying", async () => {
    const { finder, getQuery } = captureUser(null);

    await assert.rejects(
      findExistingUserByPhone(finder, "9876543210"),
      /normalized Indian phone/i,
    );
    assert.equal(getQuery(), undefined);
  });

  it("normalizes every supported input format to the same identity", () => {
    const formats = [
      "9876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "919876543210",
      "09876543210",
      " 98765-43210 ",
    ];

    for (const format of formats) {
      assert.equal(normalizeIndianPhone(format), PHONE);
    }
  });
});

describe("buildNormalizedPhoneLookupWhere", () => {
  it("keeps legacy variant matching for retailers", () => {
    assert.deepEqual(buildNormalizedPhoneLookupWhere(PHONE), {
      OR: [
        {
          phone: {
            in: [
              "+919876543210",
              "9876543210",
              "09876543210",
              "919876543210",
              "+91-9876543210",
              "+91-98765-43210",
            ],
          },
        },
        { phone: { contains: "3210" } },
      ],
    });
  });
});
