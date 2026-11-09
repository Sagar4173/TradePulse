import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CART_COOKIE_NAME,
  CartCookieError,
  MAX_CART_LINES,
  buildCartCookieOptions,
  countCartUnits,
  decodeCartCookie,
  encodeCartCookie,
  normalizeCartLines,
  readCartLines,
  readCartOrigin,
} from "../cookie";

const OWNER = { userId: "user_1", retailerId: "retailer_1" };

describe("encodeCartCookie / decodeCartCookie", () => {
  it("round-trips an owner-bound cart without prices", () => {
    const encoded = encodeCartCookie(OWNER, [
      { sku: "SKU-BS-075", quantity: 10 },
      { sku: "SKU-DT-1KG", quantity: 2 },
    ]);

    const decoded = decodeCartCookie(encoded);

    assert.deepEqual(decoded, {
      v: 2,
      userId: "user_1",
      retailerId: "retailer_1",
      origin: "MANUAL",
      lines: [
        { sku: "SKU-BS-075", quantity: 10 },
        { sku: "SKU-DT-1KG", quantity: 2 },
      ],
    });
    assert.equal(encoded.includes("950"), false);
    assert.equal(encoded.includes("sellingPrice"), false);
  });

  it("normalizes duplicate and invalid lines before encoding", () => {
    const encoded = encodeCartCookie(OWNER, [
      { sku: "SKU-BS-075", quantity: 2 },
      { sku: "SKU-BS-075", quantity: 3 },
      { sku: "", quantity: 1 },
      { sku: "SKU-DT-1KG", quantity: 0 },
      { sku: "SKU-DT-1KG", quantity: 1.5 },
    ]);

    assert.deepEqual(decodeCartCookie(encoded)?.lines, [
      { sku: "SKU-BS-075", quantity: 5 },
    ]);
  });

  it("caps merged quantities and the number of lines", () => {
    const lines = Array.from({ length: MAX_CART_LINES + 5 }, (_, index) => ({
      sku: `SKU-${index}`,
      quantity: 999,
    }));

    const decoded = decodeCartCookie(encodeCartCookie(OWNER, lines));

    assert.equal(decoded?.lines.length, MAX_CART_LINES);
    assert.equal(
      decodeCartCookie(
        encodeCartCookie(OWNER, [{ sku: "SKU-A", quantity: 999 }]),
      )?.lines[0].quantity,
      999,
    );
  });

  it("rejects malformed, oversized and foreign payloads", () => {
    assert.equal(decodeCartCookie(null), null);
    assert.equal(decodeCartCookie(""), null);
    assert.equal(decodeCartCookie("not-base64-json"), null);
    assert.equal(
      decodeCartCookie(Buffer.from("{}").toString("base64url")),
      null,
    );
    assert.equal(
      decodeCartCookie(
        Buffer.from(
          JSON.stringify({ v: 3, ...OWNER, lines: [] }),
        ).toString("base64url"),
      ),
      null,
    );
    assert.equal(
      decodeCartCookie(
        Buffer.from(
          JSON.stringify({
            v: 1,
            userId: "",
            retailerId: "retailer_1",
            lines: [],
          }),
        ).toString("base64url"),
      ),
      null,
    );

    assert.throws(
      () =>
        encodeCartCookie(
          OWNER,
          Array.from({ length: MAX_CART_LINES }, (_, index) => ({
            sku: `${index}${"X".repeat(60)}`,
            quantity: 999,
          })),
        ),
      CartCookieError,
    );
  });
});

describe("cart origin", () => {
  it("round-trips an AI_TEXT origin without storing prices", () => {
    const encoded = encodeCartCookie(
      OWNER,
      [{ sku: "SKU-BS-075", quantity: 2 }],
      "AI_TEXT",
    );

    assert.equal(decodeCartCookie(encoded)?.origin, "AI_TEXT");
    assert.equal(readCartOrigin(encoded, OWNER), "AI_TEXT");
    assert.equal(encoded.includes("sellingPrice"), false);
    assert.equal(encoded.includes("950"), false);
  });

  it("treats legacy version 1 carts as manual", () => {
    const legacy = Buffer.from(
      JSON.stringify({
        v: 1,
        ...OWNER,
        lines: [{ sku: "SKU-BS-075", quantity: 2 }],
      }),
    ).toString("base64url");

    assert.equal(decodeCartCookie(legacy)?.v, 2);
    assert.equal(readCartOrigin(legacy, OWNER), "MANUAL");
  });

  it("does not expose another owner's origin", () => {
    const encoded = encodeCartCookie(
      OWNER,
      [{ sku: "SKU-BS-075", quantity: 2 }],
      "AI_TEXT",
    );

    assert.equal(
      readCartOrigin(encoded, { userId: "user_2", retailerId: "retailer_1" }),
      "MANUAL",
    );
    assert.equal(readCartOrigin(undefined, OWNER), "MANUAL");
  });
});

describe("readCartLines", () => {
  it("returns lines only for the matching owner", () => {
    const encoded = encodeCartCookie(OWNER, [
      { sku: "SKU-BS-075", quantity: 4 },
    ]);

    assert.deepEqual(readCartLines(encoded, OWNER), [
      { sku: "SKU-BS-075", quantity: 4 },
    ]);
    assert.deepEqual(
      readCartLines(encoded, { userId: "user_2", retailerId: "retailer_1" }),
      [],
    );
    assert.deepEqual(
      readCartLines(encoded, { userId: "user_1", retailerId: "retailer_2" }),
      [],
    );
    assert.deepEqual(readCartLines(undefined, OWNER), []);
  });
});

describe("normalizeCartLines", () => {
  it("drops unknown SKU characters and keeps valid identifiers", () => {
    assert.deepEqual(
      normalizeCartLines([
        { sku: "SKU-BS-075", quantity: 1 },
        { sku: "../../etc/passwd", quantity: 1 },
        { sku: "SKU WITH SPACE", quantity: 1 },
      ]),
      [{ sku: "SKU-BS-075", quantity: 1 }],
    );
  });
});

describe("countCartUnits", () => {
  it("counts paid units across lines", () => {
    assert.equal(
      countCartUnits([
        { sku: "SKU-A", quantity: 3 },
        { sku: "SKU-B", quantity: 4 },
      ]),
      7,
    );
  });
});

describe("buildCartCookieOptions", () => {
  it("uses an HTTP-only, same-site, production-secure cookie", () => {
    const production = buildCartCookieOptions(true);
    const development = buildCartCookieOptions(false);

    assert.equal(CART_COOKIE_NAME, "tradepulse_cart");
    assert.equal(production.httpOnly, true);
    assert.equal(production.sameSite, "lax");
    assert.equal(production.secure, true);
    assert.equal(production.path, "/");
    assert.equal(development.secure, false);
    assert.ok(production.maxAge > 0);
  });
});
