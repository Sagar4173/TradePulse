import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCaptureText } from "../parse";
import type {
  MatchAlias,
  MatchHistoryEntry,
  MatchProduct,
} from "../types";

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
  {
    sku: "SKU-DT-1KG",
    name: "Detergent Powder 1kg",
    description: "Household detergent powder in a one-kilogram pack.",
    brand: "CleanWave",
    category: "Home Care",
    unitLabel: "Case of 20",
    availableCases: 85,
    hasRetailerPrice: true,
  },
  {
    sku: "SKU-TE-250",
    name: "Tea Leaf 250g",
    description: "Packaged tea leaf for kirana retail.",
    brand: "Hilltop Tea",
    category: "Beverages",
    unitLabel: "Case of 40",
    availableCases: 0,
    hasRetailerPrice: true,
  },
];

function parse(
  text: string,
  options: {
    products?: MatchProduct[];
    aliases?: MatchAlias[];
    history?: MatchHistoryEntry[];
  } = {},
) {
  return parseCaptureText({
    text,
    products: options.products ?? PRODUCTS,
    aliases: options.aliases ?? [],
    history: options.history ?? [],
  });
}

describe("parseCaptureText", () => {
  it("resolves the required order into the seeded catalogue", () => {
    const result = parse(
      "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti",
    );

    assert.equal(result.lines.length, 3);

    const [biscuit, detergent, tea] = result.lines;

    assert.equal(biscuit.candidate?.sku, "SKU-BS-075");
    assert.equal(biscuit.quantity, 5);
    assert.equal(biscuit.unitKind, "CASE");
    assert.equal(biscuit.proposedCaseQuantity, 5);
    assert.equal(biscuit.status, "READY");
    assert.equal(biscuit.originalText, "5 peti biscuit chhota");

    assert.equal(detergent.candidate?.sku, "SKU-DT-1KG");
    assert.equal(detergent.quantity, 2);
    assert.equal(detergent.unitKind, "CASE");
    assert.equal(detergent.proposedCaseQuantity, 2);
    assert.equal(detergent.packSizeHint, "1 kg");
    assert.equal(detergent.status, "READY");

    assert.equal(tea.candidate?.sku, "SKU-TE-250");
    assert.equal(tea.quantity, 1);
    assert.equal(tea.unitKind, "CASE");
    assert.equal(tea.proposedCaseQuantity, 1);
    assert.equal(tea.status, "OUT_OF_STOCK");
    assert.equal(tea.outOfStock, true);
  });

  it("never guesses cases when the retailer omits a unit", () => {
    const [line] = parse("5 biscuit").lines;

    assert.equal(line.candidate?.sku, "SKU-BS-075");
    assert.equal(line.unitKind, "UNKNOWN");
    assert.equal(line.proposedCaseQuantity, null);
    assert.equal(line.status, "NEEDS_UNIT_CLARIFICATION");
    assert.equal(line.clarificationCode, "UNIT_MISSING");
  });

  it("does not round a piece quantity up to a case", () => {
    const [line] = parse("5 packet biscuit").lines;

    assert.equal(line.unitKind, "PIECE");
    assert.equal(line.casePackSize, 96);
    assert.equal(line.proposedCaseQuantity, null);
    assert.equal(line.status, "NEEDS_UNIT_CLARIFICATION");
    assert.equal(line.clarificationCode, "PIECE_NOT_CASE_MULTIPLE");
  });

  it("converts an exact piece multiple only as an explicit case proposal", () => {
    const [line] = parse("96 packet biscuit").lines;

    assert.equal(line.unitKind, "PIECE");
    assert.equal(line.casePackSize, 96);
    assert.equal(line.proposedCaseQuantity, 1);
    assert.equal(line.status, "READY");
    assert.match(line.conversionNote ?? "", /96 pieces = 1 case/i);
  });

  it("asks before treating a weight as a case quantity", () => {
    const [line] = parse("1 kilo detergent").lines;

    assert.equal(line.candidate?.sku, "SKU-DT-1KG");
    assert.equal(line.unitKind, "WEIGHT");
    assert.equal(line.proposedCaseQuantity, null);
    assert.equal(line.status, "NEEDS_UNIT_CLARIFICATION");
    assert.equal(line.clarificationCode, "WEIGHT_NOT_CASE");
  });

  it("rejects fractional case quantities", () => {
    const [line] = parse("dedh peti biscuit").lines;

    assert.equal(line.quantity, 1.5);
    assert.equal(line.status, "NEEDS_UNIT_CLARIFICATION");
    assert.equal(line.clarificationCode, "WHOLE_CASES_ONLY");
  });

  it("marks an unknown product as unmatched without inventing a SKU", () => {
    const [line] = parse("2 peti unknown soap").lines;

    assert.equal(line.candidate, null);
    assert.deepEqual(line.alternatives, []);
    assert.equal(line.status, "UNMATCHED");
  });

  it("uses a retailer alias to resolve shorthand", () => {
    const [line] = parse("5 peti chhota biscuit", {
      aliases: [
        {
          normalizedPhrase: "chhota biscuit",
          productSku: "SKU-BS-075",
          confirmationCount: 4,
        },
      ],
    }).lines;

    assert.equal(line.candidate?.sku, "SKU-BS-075");
    assert.ok(line.productConfidence >= 0.95);
    assert.equal(line.status, "READY");
  });

  it("uses retailer order history to break a close match", () => {
    const products: MatchProduct[] = [
      ...PRODUCTS,
      {
        sku: "SKU-SOAP-1",
        name: "Washing Soap 1kg",
        description: "Household washing soap.",
        brand: "CleanWave",
        category: "Home Care",
        unitLabel: "Case of 24",
        availableCases: 40,
        hasRetailerPrice: true,
      },
    ];

    const [line] = parse("2 peti washing", {
      products,
      history: [
        {
          productSku: "SKU-SOAP-1",
          orderCount: 8,
          totalQuantity: 20,
        },
      ],
    }).lines;

    assert.equal(line.candidate?.sku, "SKU-SOAP-1");
  });

  it("exposes up to two alternatives only when they are relevant", () => {
    const products: MatchProduct[] = [
      PRODUCTS[0],
      {
        ...PRODUCTS[0],
        sku: "SKU-BS-300",
        name: "Glucose Biscuit 300g",
        unitLabel: "Case of 24",
      },
    ];

    const [line] = parse("5 peti glucose biscuit", { products }).lines;

    assert.ok(line.candidate);
    assert.ok(line.alternatives.length <= 2);
    assert.ok(line.alternatives.some((item) => item.sku === "SKU-BS-300"));
  });

  it("prefers the matching pack size", () => {
    const products: MatchProduct[] = [
      PRODUCTS[2],
      {
        ...PRODUCTS[2],
        sku: "SKU-TE-500",
        name: "Tea Leaf 500g",
        unitLabel: "Case of 20",
        availableCases: 12,
      },
    ];

    const [line] = parse("1 peti chai patti 250", { products }).lines;

    assert.equal(line.candidate?.sku, "SKU-TE-250");
  });

  it("records a missing retailer price without showing money", () => {
    const products: MatchProduct[] = [
      { ...PRODUCTS[0], hasRetailerPrice: false },
    ];

    const [line] = parse("5 peti biscuit", { products }).lines;

    assert.equal(line.status, "PRICE_UNAVAILABLE");
    assert.equal("pricePaise" in (line.candidate ?? {}), false);
  });
});
