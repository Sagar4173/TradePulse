import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import { config, proxy } from "../../../proxy";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/catalogue",
  "/orders",
  "/retailers",
  "/users",
  "/products",
  "/inventory",
  "/schemes",
  "/audit-logs",
  "/account",
] as const;

describe("proxy gate", () => {
  it("redirects a cookie-less request to login and preserves the destination", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/dashboard?tab=orders"),
    );

    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3000/login?next=%2Fdashboard%3Ftab%3Dorders",
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("allows a request that carries a session cookie", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/users", {
        headers: { cookie: "tradepulse_session=opaque-token" },
      }),
    );

    assert.equal(response.status, 200);
  });

  it("applies to every protected route prefix", () => {
    assert.deepEqual(
      config.matcher,
      PROTECTED_PREFIXES.map((prefix) => `${prefix}/:path*`),
    );
  });
});
