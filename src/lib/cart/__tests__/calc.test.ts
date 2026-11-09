import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateCart } from "../calc";
import type { CartPriceInput } from "../types";
import type { SchemeCandidate } from "../../schemes/engine";

const NOW = new Date("2026-11-07T12:00:00.000Z");

const BUY_10_GET_1: SchemeCandidate = {
  id: "scheme_bs_075_buy_10_get_1",
  name: "Buy 10 Get 1",
  type: "BUY_X_GET_Y",
  isActive: true,
  startsAt: null,
  endsAt: null,
  minimumQuantity: 10,
  freeQuantity: 1,
  discountPercent: null,
};

const THREE_PERCENT_5_PLUS: SchemeCandidate = {
  id: "scheme_dt_1kg_3pct_5plus",
  name: "3% off 5+ cases",
  type: "PERCENTAGE_DISCOUNT",
  isActive: true,
  startsAt: null,
  endsAt: null,
  minimumQuantity: 5,
  freeQuantity: null,
  discountPercent: "3.00",
};

function product(
  overrides: Partial<CartPriceInput> & { sku: string },
): CartPriceInput {
  return {
    name: "Product",
    brand: null,
    imageUrl: null,
    unitLabel: "Case",
    gstRate: "18.00",
    unitPricePaise: 950n,
    stock: { status: "IN_STOCK", availableCases: 340 },
    schemes: [],
    ...overrides,
  };
}

function mapOf(...products: CartPriceInput[]): Map<string, CartPriceInput> {
  return new Map(products.map((item) => [item.sku, item]));
}

const BISCUIT = product({
  sku: "SKU-BS-075",
  name: "Glucose Biscuit 75g",
  unitPricePaise: 950n,
  schemes: [BUY_10_GET_1],
});

const DETERGENT = product({
  sku: "SKU-DT-1KG",
  name: "Detergent Powder 1kg",
  unitPricePaise: 11_200n,
  schemes: [THREE_PERCENT_5_PLUS],
});

describe("calculateCart: empty and stale carts", () => {
  it("returns exact zero totals for an empty cart", () => {
    const summary = calculateCart([], new Map(), NOW);

    assert.deepEqual(summary.lines, []);
    assert.equal(summary.itemCount, 0);
    assert.equal(summary.subtotalPaise, 0n);
    assert.equal(summary.discountPaise, 0n);
    assert.equal(summary.taxablePaise, 0n);
    assert.equal(summary.gstPaise, 0n);
    assert.equal(summary.totalPaise, 0n);
    assert.deepEqual(summary.gstBreakdown, []);
    assert.equal(summary.hasIssues, false);
  });

  it("drops products that are no longer available", () => {
    const summary = calculateCart(
      [
        { sku: "SKU-OLD", quantity: 2 },
        { sku: "SKU-BS-075", quantity: 10 },
      ],
      mapOf(BISCUIT),
      NOW,
    );

    assert.deepEqual(summary.unavailableSkus, ["SKU-OLD"]);
    assert.equal(summary.lines.length, 1);
    assert.equal(summary.totalPaise, 11_210n);
    assert.equal(summary.hasIssues, true);
  });
});

describe("calculateCart: approved scheme examples", () => {
  it("calculates Buy 10 Get 1 on biscuits", () => {
    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(BISCUIT),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.paidQuantity, 10);
    assert.equal(line.freeQuantity, 1);
    assert.equal(line.fulfilledQuantity, 11);
    assert.equal(line.scheme?.schemeId, "scheme_bs_075_buy_10_get_1");
    assert.equal(line.schemeName, "Buy 10 Get 1");
    assert.equal(line.schemeDiscountPercentBasisPoints, null);
    assert.equal(line.subtotalPaise, 10_450n);
    assert.equal(line.discountPaise, 950n);
    assert.equal(line.taxablePaise, 9_500n);
    assert.equal(line.gstPaise, 1_710n);
    assert.equal(line.totalPaise, 11_210n);

    assert.equal(summary.itemCount, 10);
    assert.equal(summary.subtotalPaise, 10_450n);
    assert.equal(summary.discountPaise, 950n);
    assert.equal(summary.taxablePaise, 9_500n);
    assert.equal(summary.gstPaise, 1_710n);
    assert.equal(summary.totalPaise, 11_210n);
    assert.equal(summary.hasIssues, false);
  });

  it("calculates 20 paid biscuit cases as two free", () => {
    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 20 }],
      mapOf(BISCUIT),
      NOW,
    );

    assert.equal(summary.lines[0].freeQuantity, 2);
    assert.equal(summary.subtotalPaise, 20_900n);
    assert.equal(summary.discountPaise, 1_900n);
    assert.equal(summary.totalPaise, 22_420n);
  });

  it("calculates the 3% detergent slab from five cases", () => {
    const summary = calculateCart(
      [{ sku: "SKU-DT-1KG", quantity: 5 }],
      mapOf(DETERGENT),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.paidQuantity, 5);
    assert.equal(line.freeQuantity, 0);
    assert.equal(line.schemeName, "3% off 5+ cases");
    assert.equal(line.schemeDiscountPercentBasisPoints, 300n);
    assert.equal(line.subtotalPaise, 56_000n);
    assert.equal(line.discountPaise, 1_680n);
    assert.equal(line.taxablePaise, 54_320n);
    assert.equal(line.gstPaise, 9_778n);
    assert.equal(line.totalPaise, 64_098n);
  });

  it("does not apply a scheme below its minimum", () => {
    const summary = calculateCart(
      [{ sku: "SKU-DT-1KG", quantity: 4 }],
      mapOf(DETERGENT),
      NOW,
    );

    assert.equal(summary.lines[0].scheme, null);
    assert.equal(summary.discountPaise, 0n);
    assert.equal(summary.subtotalPaise, 44_800n);
    assert.equal(summary.totalPaise, 52_864n);
  });

  it("applies only one scheme per line", () => {
    const competing = product({
      sku: "SKU-BS-075",
      unitPricePaise: 950n,
      schemes: [
        BUY_10_GET_1,
        {
          ...THREE_PERCENT_5_PLUS,
          id: "scheme_bs_3pct",
          minimumQuantity: 5,
        },
      ],
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(competing),
      NOW,
    );

    assert.equal(summary.lines[0].scheme?.schemeId, BUY_10_GET_1.id);
    assert.equal(summary.discountPaise, 950n);
  });
});

describe("calculateCart: stock and price validation", () => {
  it("rejects add-to-cart quantities for out-of-stock products", () => {
    const tea = product({
      sku: "SKU-TE-250",
      name: "Tea Leaf 250g",
      unitPricePaise: 13_000n,
      gstRate: "5.00",
      stock: { status: "OUT_OF_STOCK", availableCases: 0 },
    });

    const summary = calculateCart(
      [{ sku: "SKU-TE-250", quantity: 2 }],
      mapOf(tea),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.paidQuantity, 0);
    assert.equal(line.isOrderable, false);
    assert.ok(line.notices.includes("OUT_OF_STOCK"));
    assert.equal(summary.totalPaise, 0n);
    assert.ok(summary.itemCount === 0);
  });

  it("marks products without a retailer price and never invents one", () => {
    const unpriced = product({
      sku: "SKU-MP-001",
      unitPricePaise: null,
      stock: { status: "IN_STOCK", availableCases: 20 },
    });

    const summary = calculateCart(
      [{ sku: "SKU-MP-001", quantity: 3 }],
      mapOf(unpriced),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.unitPricePaise, null);
    assert.ok(line.notices.includes("PRICE_UNAVAILABLE"));
    assert.equal(line.isOrderable, false);
    assert.equal(line.subtotalPaise, 0n);
    assert.equal(line.totalPaise, 0n);
    assert.equal(summary.totalPaise, 0n);
  });

  it("clamps requests to available stock and explains the reduction", () => {
    const limited = product({
      sku: "SKU-BS-075",
      unitPricePaise: 950n,
      stock: { status: "LOW_STOCK", availableCases: 6 },
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(limited),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.requestedQuantity, 10);
    assert.equal(line.paidQuantity, 6);
    assert.ok(line.notices.includes("STOCK_REDUCED"));
    assert.equal(line.subtotalPaise, 5_700n);
    assert.equal(line.gstPaise, 1_026n);
    assert.equal(line.totalPaise, 6_726n);
    assert.equal(line.isOrderable, true);
  });

  it("does not apply free units that stock cannot cover", () => {
    const limited = product({
      sku: "SKU-BS-075",
      unitPricePaise: 950n,
      stock: { status: "LOW_STOCK", availableCases: 10 },
      schemes: [BUY_10_GET_1],
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(limited),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.paidQuantity, 10);
    assert.equal(line.freeQuantity, 0);
    assert.equal(line.scheme, null);
    assert.ok(line.notices.includes("FREE_UNITS_REDUCED"));
    assert.equal(line.subtotalPaise, 9_500n);
    assert.equal(line.discountPaise, 0n);
    assert.equal(line.totalPaise, 11_210n);
    assert.equal(line.isOrderable, true);
  });

  it("caps partial free units when only some are in stock", () => {
    const limited = product({
      sku: "SKU-BS-075",
      unitPricePaise: 950n,
      stock: { status: "IN_STOCK", availableCases: 11 },
      schemes: [{ ...BUY_10_GET_1, freeQuantity: 2 }],
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(limited),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.requestedQuantity, 10);
    assert.equal(line.paidQuantity, 10);
    assert.equal(line.freeQuantity, 1);
    assert.equal(line.scheme?.freeQuantity, 1);
    assert.ok(line.notices.includes("FREE_UNITS_REDUCED"));
    assert.equal(line.discountPaise, 950n);
    assert.equal(line.taxablePaise, 9_500n);
    assert.equal(line.totalPaise, 11_210n);
  });

  it("clamps an over-stock request before evaluating free units", () => {
    const limited = product({
      sku: "SKU-BS-075",
      unitPricePaise: 950n,
      stock: { status: "IN_STOCK", availableCases: 11 },
      schemes: [BUY_10_GET_1],
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 20 }],
      mapOf(limited),
      NOW,
    );
    const line = summary.lines[0];

    assert.equal(line.requestedQuantity, 20);
    assert.equal(line.paidQuantity, 11);
    assert.equal(line.freeQuantity, 0);
    assert.ok(line.notices.includes("STOCK_REDUCED"));
    assert.ok(line.notices.includes("FREE_UNITS_REDUCED"));
  });

  it("marks stock-unavailable products as not orderable", () => {
    const untracked = product({
      sku: "SKU-UNTRACKED",
      stock: { status: "UNAVAILABLE", availableCases: null },
    });

    const summary = calculateCart(
      [{ sku: "SKU-UNTRACKED", quantity: 1 }],
      mapOf(untracked),
      NOW,
    );

    assert.equal(summary.lines[0].paidQuantity, 0);
    assert.ok(summary.lines[0].notices.includes("STOCK_UNAVAILABLE"));
    assert.equal(summary.lines[0].isOrderable, false);
  });

  it("does not order a line with an invalid GST rate", () => {
    const brokenTax = product({
      sku: "SKU-BS-075",
      gstRate: "not-a-rate",
      schemes: [BUY_10_GET_1],
    });

    const summary = calculateCart(
      [{ sku: "SKU-BS-075", quantity: 10 }],
      mapOf(brokenTax),
      NOW,
    );

    assert.ok(summary.lines[0].notices.includes("TAX_UNAVAILABLE"));
    assert.equal(summary.lines[0].isOrderable, false);
    assert.equal(summary.totalPaise, 0n);
  });
});

describe("calculateCart: totals and GST breakdown", () => {
  it("sums multiple lines exactly and breaks GST down by rate", () => {
    const tea = product({
      sku: "SKU-TE-250",
      name: "Tea Leaf 250g",
      unitPricePaise: 13_000n,
      gstRate: "5.00",
      stock: { status: "IN_STOCK", availableCases: 20 },
    });

    const summary = calculateCart(
      [
        { sku: "SKU-BS-075", quantity: 10 },
        { sku: "SKU-TE-250", quantity: 2 },
      ],
      mapOf(BISCUIT, tea),
      NOW,
    );

    assert.equal(summary.itemCount, 12);
    assert.equal(summary.subtotalPaise, 36_450n);
    assert.equal(summary.discountPaise, 950n);
    assert.equal(summary.taxablePaise, 35_500n);
    assert.equal(summary.gstPaise, 3_010n);
    assert.equal(summary.totalPaise, 38_510n);

    assert.deepEqual(summary.gstBreakdown, [
      { rateBasisPoints: 1_800n, taxablePaise: 9_500n, gstPaise: 1_710n },
      { rateBasisPoints: 500n, taxablePaise: 26_000n, gstPaise: 1_300n },
    ]);
  });

  it("produces decimal-safe refund-style values without floating drift", () => {
    const cheap = product({
      sku: "SKU-CHEAP",
      unitPricePaise: 1n,
      gstRate: "18.00",
      stock: { status: "IN_STOCK", availableCases: 3 },
    });

    const summary = calculateCart(
      [{ sku: "SKU-CHEAP", quantity: 3 }],
      mapOf(cheap),
      NOW,
    );

    assert.equal(summary.subtotalPaise, 3n);
    assert.equal(summary.gstPaise, 1n);
    assert.equal(summary.totalPaise, 4n);
  });
});
