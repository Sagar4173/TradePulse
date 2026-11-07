import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CATALOGUE_PAGE_SIZE,
  collectCategories,
  filterAndPaginateCatalogue,
  parseCatalogueFilters,
} from "../filters";
import type { CatalogueCandidate } from "../types";

function candidate(
  overrides: Partial<CatalogueCandidate> & { sku: string; name: string },
): CatalogueCandidate {
  return {
    brand: null,
    category: null,
    pricePaise: 1_000n,
    stock: { status: "IN_STOCK", availableCases: 100 },
    schemes: [],
    ...overrides,
  };
}

const PRODUCTS: CatalogueCandidate[] = [
  candidate({
    sku: "SKU-BS-075",
    name: "Glucose Biscuit 75g",
    brand: "Sunrise Foods",
    category: "Biscuits & Snacks",
    pricePaise: 950n,
    stock: { status: "IN_STOCK", availableCases: 340 },
  }),
  candidate({
    sku: "SKU-DT-1KG",
    name: "Detergent Powder 1kg",
    brand: "CleanWave",
    category: "Home Care",
    pricePaise: 11_200n,
    stock: { status: "LOW_STOCK", availableCases: 6 },
  }),
  candidate({
    sku: "SKU-TE-250",
    name: "Tea Leaf 250g",
    brand: "Hilltop Tea",
    category: "Beverages",
    pricePaise: 13_000n,
    stock: { status: "OUT_OF_STOCK", availableCases: 0 },
  }),
  candidate({
    sku: "SKU-MP-001",
    name: "No Price Item",
    brand: "Unpriced",
    category: "Beverages",
    pricePaise: null,
    stock: { status: "UNAVAILABLE", availableCases: null },
  }),
];

describe("parseCatalogueFilters", () => {
  it("returns safe defaults for missing or invalid input", () => {
    assert.deepEqual(parseCatalogueFilters({}), {
      query: "",
      category: null,
      availability: "all",
      sort: "name-asc",
      page: 1,
    });

    assert.deepEqual(
      parseCatalogueFilters({
        q: "  ",
        category: "all",
        availability: "bogus",
        sort: "bogus",
        page: "-2",
      }),
      {
        query: "",
        category: null,
        availability: "all",
        sort: "name-asc",
        page: 1,
      },
    );
  });

  it("normalizes arrays, trims text and clamps the query length", () => {
    const filters = parseCatalogueFilters({
      q: ["  tea  ", "ignored"],
      category: ["Home Care", "ignored"],
      availability: "low-stock",
      sort: "price-desc",
      page: "3",
    });

    assert.equal(filters.query, "tea");
    assert.equal(filters.category, "Home Care");
    assert.equal(filters.availability, "low-stock");
    assert.equal(filters.sort, "price-desc");
    assert.equal(filters.page, 3);

    const long = parseCatalogueFilters({ q: "x".repeat(200) });
    assert.equal(long.query.length, 80);
  });
});

describe("filterAndPaginateCatalogue", () => {
  const filters = parseCatalogueFilters({});

  it("searches case-insensitively by name, SKU and brand", () => {
    for (const query of ["glucose", "sku-dt", "cleanwave"]) {
      const result = filterAndPaginateCatalogue(
        PRODUCTS,
        parseCatalogueFilters({ q: query }),
      );

      assert.equal(result.items.length, 1, query);
    }

    assert.equal(
      filterAndPaginateCatalogue(
        PRODUCTS,
        parseCatalogueFilters({ q: "nothing-matches" }),
      ).items.length,
      0,
    );
  });

  it("filters by category case-insensitively", () => {
    const result = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ category: "home care" }),
    );

    assert.deepEqual(
      result.items.map((item) => item.sku),
      ["SKU-DT-1KG"],
    );
  });

  it("filters by availability", () => {
    const inStock = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ availability: "in-stock" }),
    );
    const lowStock = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ availability: "low-stock" }),
    );
    const outOfStock = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ availability: "out-of-stock" }),
    );

    assert.deepEqual(
      inStock.items.map((item) => item.sku),
      ["SKU-DT-1KG", "SKU-BS-075"],
    );
    assert.deepEqual(
      lowStock.items.map((item) => item.sku),
      ["SKU-DT-1KG"],
    );
    assert.deepEqual(
      outOfStock.items.map((item) => item.sku),
      ["SKU-MP-001", "SKU-TE-250"],
    );
  });

  it("sorts by name and by price with missing prices last", () => {
    const byName = filterAndPaginateCatalogue(PRODUCTS, filters);
    assert.deepEqual(
      byName.items.map((item) => item.name),
      [
        "Detergent Powder 1kg",
        "Glucose Biscuit 75g",
        "No Price Item",
        "Tea Leaf 250g",
      ],
    );

    const priceAscending = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ sort: "price-asc" }),
    );
    assert.deepEqual(
      priceAscending.items.map((item) => item.sku),
      ["SKU-BS-075", "SKU-DT-1KG", "SKU-TE-250", "SKU-MP-001"],
    );

    const priceDescending = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ sort: "price-desc" }),
    );
    assert.deepEqual(
      priceDescending.items.map((item) => item.sku),
      ["SKU-TE-250", "SKU-DT-1KG", "SKU-BS-075", "SKU-MP-001"],
    );
  });

  it("paginates twelve items per page and clamps out-of-range pages", () => {
    const many = Array.from({ length: CATALOGUE_PAGE_SIZE + 3 }, (_, index) =>
      candidate({
        sku: `SKU-${String(index).padStart(3, "0")}`,
        name: `Product ${String(index).padStart(3, "0")}`,
      }),
    );

    const first = filterAndPaginateCatalogue(
      many,
      parseCatalogueFilters({ page: "1" }),
    );
    assert.equal(first.items.length, CATALOGUE_PAGE_SIZE);
    assert.equal(first.total, CATALOGUE_PAGE_SIZE + 3);
    assert.equal(first.pageCount, 2);

    const second = filterAndPaginateCatalogue(
      many,
      parseCatalogueFilters({ page: "2" }),
    );
    assert.equal(second.items.length, 3);
    assert.equal(second.page, 2);

    const clamped = filterAndPaginateCatalogue(
      many,
      parseCatalogueFilters({ page: "99" }),
    );
    assert.equal(clamped.page, 2);
    assert.equal(clamped.items.length, 3);
  });

  it("returns an empty first page when nothing matches", () => {
    const result = filterAndPaginateCatalogue(
      PRODUCTS,
      parseCatalogueFilters({ q: "missing" }),
    );

    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
    assert.equal(result.page, 1);
    assert.equal(result.pageCount, 1);
  });
});

describe("collectCategories", () => {
  it("returns unique, sorted, non-empty categories", () => {
    assert.deepEqual(collectCategories(PRODUCTS), [
      "Beverages",
      "Biscuits & Snacks",
      "Home Care",
    ]);
  });
});
