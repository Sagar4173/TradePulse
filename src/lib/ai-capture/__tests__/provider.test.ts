import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deterministicCaptureProvider } from "../provider";
import type { MatchProduct } from "../types";

const PRODUCTS: MatchProduct[] = [
  {
    sku: "SKU-BS-075",
    name: "Glucose Biscuit 75g",
    description: "Everyday glucose biscuit for retail counters.",
    brand: "Sunrise Foods",
    category: "Biscuits & Snacks",
    unitLabel: "Case of 96",
    availableCases: 340,
    hasRetailerPrice: true,
  },
];

describe("deterministicCaptureProvider", () => {
  it("exposes the deterministic parser through the provider seam", async () => {
    const result = await deterministicCaptureProvider.extract({
      text: "5 peti biscuit",
      products: PRODUCTS,
      aliases: [],
      history: [],
    });

    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].candidate?.sku, "SKU-BS-075");
    assert.equal(result.lines[0].proposedCaseQuantity, 5);
  });
});
