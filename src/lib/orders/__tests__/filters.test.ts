import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_PAGE_SIZE,
  buildOrdersHref,
  orderDateRange,
  parseOrderFilters,
} from "../filters";

describe("order filters", () => {
  it("normalizes valid filters", () => {
    assert.deepEqual(
      parseOrderFilters({
        q: "  TP-2026  ",
        status: "ON_CREDIT_HOLD",
        from: "2026-11-01",
        to: "2026-11-07",
        sort: "total-desc",
        page: "3",
      }),
      {
        query: "TP-2026",
        status: "ON_CREDIT_HOLD",
        from: "2026-11-01",
        to: "2026-11-07",
        sort: "total-desc",
        page: 3,
      },
    );
  });

  it("falls back to safe defaults for unknown status, sort, and page values", () => {
    assert.deepEqual(
      parseOrderFilters({
        status: "NOT_A_STATUS",
        sort: "sideways",
        page: "-2",
      }),
      {
        query: "",
        status: "all",
        from: null,
        to: null,
        sort: "newest",
        page: 1,
      },
    );
  });

  it("bounds the search text and page number", () => {
    const filters = parseOrderFilters({
      q: "x".repeat(200),
      page: "999999999",
    });

    assert.equal(filters.query.length, 80);
    assert.equal(filters.page, 100_000);
  });

  it("validates real calendar dates and swaps an inverted range", () => {
    assert.deepEqual(
      parseOrderFilters({
        from: "2026-11-07",
        to: "2026-11-01",
      }),
      {
        query: "",
        status: "all",
        from: "2026-11-01",
        to: "2026-11-07",
        sort: "newest",
        page: 1,
      },
    );

    const invalid = parseOrderFilters({
      from: "2026-02-30",
      to: "not-a-date",
    });

    assert.equal(invalid.from, null);
    assert.equal(invalid.to, null);
  });

  it("builds an inclusive Asia/Kolkata date range", () => {
    const range = orderDateRange({
      from: "2026-11-01",
      to: "2026-11-01",
    });

    assert.equal(range.gte?.toISOString(), "2026-10-31T18:30:00.000Z");
    assert.equal(range.lt?.toISOString(), "2026-11-01T18:30:00.000Z");
  });

  it("omits default query parameters from generated links", () => {
    assert.equal(
      buildOrdersHref("/orders", {
        query: "",
        status: "all",
        from: null,
        to: null,
        sort: "newest",
        page: 1,
      }),
      "/orders",
    );

    assert.equal(
      buildOrdersHref(
        "/orders",
        {
          query: "TP-1",
          status: "PENDING_REVIEW",
          from: "2026-11-01",
          to: null,
          sort: "oldest",
          page: 1,
        },
        2,
      ),
      "/orders?q=TP-1&status=PENDING_REVIEW&from=2026-11-01&sort=oldest&page=2",
    );
  });

  it("uses a bounded page size", () => {
    assert.equal(ORDER_PAGE_SIZE, 20);
  });
});
