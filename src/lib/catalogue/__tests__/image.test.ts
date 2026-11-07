import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveProductImage } from "../image";

describe("resolveProductImage", () => {
  it("accepts local product images with safe extensions", () => {
    for (const value of [
      "/products/glucose-biscuit.svg",
      "/products/detergent-powder.png",
      "/products/tea_leaf-250.webp",
    ]) {
      assert.equal(resolveProductImage(value), value);
    }
  });

  it("rejects remote, protocol-relative and traversal paths", () => {
    for (const value of [
      "https://example.com/product.png",
      "//evil.example/product.png",
      "javascript:alert(1)",
      "/products/../../secret.png",
      "/products/..%2Fsecret.png",
      "/other/product.svg",
      "products/product.svg",
      "/products/product.exe",
      "",
      null,
      undefined,
    ]) {
      assert.equal(resolveProductImage(value), null, String(value));
    }
  });
});
