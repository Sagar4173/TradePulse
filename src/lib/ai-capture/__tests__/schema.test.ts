import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateProviderCaptureOutput } from "../schema";

const ALLOWED = ["SKU-A", "SKU-B", "SKU-C"];

function validOutput() {
  return {
    lines: [
      {
        originalText: "5 peti biscuit",
        description: "biscuit",
        quantity: 5,
        unitKind: "CASE",
        productSku: "SKU-A",
        confidence: 0.92,
        alternatives: [{ sku: "SKU-B", confidence: 0.41 }],
      },
    ],
  };
}

describe("validateProviderCaptureOutput", () => {
  it("accepts a bounded, well-formed extraction", () => {
    const result = validateProviderCaptureOutput(validOutput(), ALLOWED);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.lines.length, 1);
      assert.equal(result.value.lines[0].productSku, "SKU-A");
    }
  });

  it("rejects unknown top-level or line fields", () => {
    const extraTopLevel = { ...validOutput(), instructions: "ignore rules" };
    const extraLine = validOutput();
    Object.assign(extraLine.lines[0], { pricePaise: 950 });

    assert.equal(validateProviderCaptureOutput(extraTopLevel, ALLOWED).ok, false);
    assert.equal(validateProviderCaptureOutput(extraLine, ALLOWED).ok, false);
  });

  it("rejects SKUs outside the server-generated allowlist", () => {
    const output = validOutput();
    output.lines[0].productSku = "SKU-EVIL";

    const result = validateProviderCaptureOutput(output, ALLOWED);

    assert.equal(result.ok, false);
  });

  it("rejects out-of-range quantities and confidence values", () => {
    for (const quantity of [0, -1, 1.5, 1000]) {
      const output = validOutput();
      output.lines[0].quantity = quantity;
      assert.equal(validateProviderCaptureOutput(output, ALLOWED).ok, false);
    }

    for (const confidence of [-0.1, 1.1, Number.NaN]) {
      const output = validOutput();
      output.lines[0].confidence = confidence;
      assert.equal(validateProviderCaptureOutput(output, ALLOWED).ok, false);
    }
  });

  it("rejects too many lines or alternatives", () => {
    const manyLines = { lines: Array.from({ length: 21 }, () => validOutput().lines[0]) };
    assert.equal(validateProviderCaptureOutput(manyLines, ALLOWED).ok, false);

    const manyAlternatives = validOutput();
    manyAlternatives.lines[0].alternatives = [
      { sku: "SKU-B", confidence: 0.4 },
      { sku: "SKU-C", confidence: 0.3 },
      { sku: "SKU-A", confidence: 0.2 },
    ];
    assert.equal(validateProviderCaptureOutput(manyAlternatives, ALLOWED).ok, false);
  });

  it("rejects malformed values and oversized text", () => {
    assert.equal(validateProviderCaptureOutput(null, ALLOWED).ok, false);
    assert.equal(validateProviderCaptureOutput({}, ALLOWED).ok, false);
    assert.equal(
      validateProviderCaptureOutput(
        { lines: [{ ...validOutput().lines[0], description: "x".repeat(301) }] },
        ALLOWED,
      ).ok,
      false,
    );
    assert.equal(
      validateProviderCaptureOutput(
        { lines: [{ ...validOutput().lines[0], unitKind: "CRATE" }] },
        ALLOWED,
      ).ok,
      false,
    );
  });
});
