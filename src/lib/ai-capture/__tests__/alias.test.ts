import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planAliasWrite } from "../alias";

describe("planAliasWrite", () => {
  it("creates an alias when the retailer corrects a parsed match", () => {
    const plan = planAliasWrite({
      phrase: "chhota biscuit",
      parsedSku: "SKU-A",
      selectedSku: "SKU-B",
      existing: null,
    });

    assert.deepEqual(plan, {
      action: "CREATE",
      phrase: "chhota biscuit",
      normalizedPhrase: "chhota biscuit",
      productSku: "SKU-B",
    });
  });

  it("updates an existing alias that points at a different SKU", () => {
    const plan = planAliasWrite({
      phrase: "chhota biscuit",
      parsedSku: "SKU-A",
      selectedSku: "SKU-B",
      existing: { productSku: "SKU-C", isActive: true },
    });

    assert.deepEqual(plan, {
      action: "UPDATE",
      phrase: "chhota biscuit",
      normalizedPhrase: "chhota biscuit",
      productSku: "SKU-B",
      previousSku: "SKU-C",
    });
  });

  it("reactivates an existing alias without changing its SKU", () => {
    const plan = planAliasWrite({
      phrase: "chhota biscuit",
      parsedSku: "SKU-A",
      selectedSku: "SKU-B",
      existing: { productSku: "SKU-B", isActive: false },
    });

    assert.equal(plan.action, "REACTIVATE");
  });

  it("skips aliases when the match was already correct", () => {
    const plan = planAliasWrite({
      phrase: "chhota biscuit",
      parsedSku: "SKU-B",
      selectedSku: "SKU-B",
      existing: null,
    });

    assert.equal(plan.action, "SKIP");
  });

  it("skips aliases when no description was captured", () => {
    const plan = planAliasWrite({
      phrase: "   ",
      parsedSku: "SKU-A",
      selectedSku: "SKU-B",
      existing: null,
    });

    assert.equal(plan.action, "SKIP");
  });

  it("never allows an alias longer than the database limit", () => {
    const plan = planAliasWrite({
      phrase: "x".repeat(300),
      parsedSku: "SKU-A",
      selectedSku: "SKU-B",
      existing: null,
    });

    assert.equal(plan.action, "SKIP");
  });

  it("skips an alias whose normalized form exceeds the database limit", () => {
    const phrase = "फ".repeat(150);

    assert.equal(phrase.length <= 200, true);
    assert.equal(
      planAliasWrite({
        phrase,
        parsedSku: "SKU-A",
        selectedSku: "SKU-B",
        existing: null,
      }).action,
      "SKIP",
    );
  });
});
