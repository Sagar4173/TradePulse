import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRetailerCartOwner } from "../owner";

describe("resolveRetailerCartOwner", () => {
  it("resolves a linked retailer user", () => {
    assert.deepEqual(
      resolveRetailerCartOwner({
        id: "user_1",
        role: "RETAILER",
        retailerId: "retailer_1",
      }),
      { userId: "user_1", retailerId: "retailer_1" },
    );
  });

  it("rejects non-retailer roles", () => {
    for (const role of ["ADMIN", "SALESMAN", "ORDER_DESK"] as const) {
      assert.equal(
        resolveRetailerCartOwner({
          id: "user_1",
          role,
          retailerId: "retailer_1",
        }),
        null,
      );
    }
  });

  it("rejects a retailer without a linked store", () => {
    assert.equal(
      resolveRetailerCartOwner({
        id: "user_1",
        role: "RETAILER",
        retailerId: null,
      }),
      null,
    );
  });
});
