import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeNextPath } from "../redirect";

describe("safeNextPath", () => {
  it("allows internal application paths", () => {
    assert.equal(safeNextPath("/dashboard"), "/dashboard");
    assert.equal(safeNextPath("/orders?status=open"), "/orders?status=open");
    assert.equal(safeNextPath("/retailers?page=2#list"), "/retailers?page=2#list");
  });

  it("falls back for external, protocol-relative, and malformed paths", () => {
    const fallback = "/dashboard";

    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "dashboard",
      "",
      "/login",
      "/login?next=/dashboard",
      "/dashboard\nLocation: https://evil.example",
    ]) {
      assert.equal(safeNextPath(value), fallback, value);
    }
  });

  it("supports a custom fallback", () => {
    assert.equal(safeNextPath("/login", "/account"), "/account");
  });
});
