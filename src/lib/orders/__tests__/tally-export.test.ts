import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, hasPermission } from "../../auth/permissions";
import { ORDER_STATUSES } from "../status";
import {
  TALLY_EXPORT_AUDIT_ENTITY,
  TALLY_EXPORT_AUDIT_EVENT,
  TALLY_EXPORT_EXCLUDED_STATUSES,
  TALLY_EXPORT_HEADERS,
  TALLY_EXPORT_MAX_LINES,
  TALLY_EXPORT_MAX_ORDERS,
  TALLY_EXPORT_STATUSES,
  buildTallyExportCsv,
  buildTallyExportRows,
  buildTallyExportWhere,
  createTallyExport,
  escapeCsvCell,
  isTallyExportStatus,
  normalizeTallyMoney,
  parseTallyExportFilters,
  summarizeTallyExportCounts,
  summarizeTallyExportOrders,
  tallyExportAuditMetadata,
  tallyExportFilename,
  tallyExportLimitProblem,
  type TallyExportItem,
  type TallyExportOrder,
} from "../tally-export";

function makeItem(overrides: Partial<TallyExportItem> = {}): TallyExportItem {
  return {
    productSku: "SKU-BS-075",
    productName: "Glucose Biscuit 75g",
    unitLabel: "Case of 96",
    quantity: 2,
    freeQuantity: 1,
    schemeName: "Buy 2 get 1",
    schemeType: "BUY_X_GET_Y",
    schemeDiscountPercent: null,
    unitPrice: "100.00",
    discount: "100.00",
    gstRate: "18.00",
    gstAmount: "36.00",
    lineTotal: "236.00",
    ...overrides,
  };
}

function makeOrder(
  overrides: Partial<TallyExportOrder> = {},
): TallyExportOrder {
  return {
    orderNumber: "TP-20261101-000001",
    status: "APPROVED",
    createdAt: new Date("2026-11-01T05:00:00.000Z"),
    retailerName: "Sharma Kirana Store",
    total: "236.00",
    items: [makeItem()],
    ...overrides,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current);
  return cells;
}

describe("tally export eligibility", () => {
  it("exports approved and post-approval statuses only", () => {
    assert.deepEqual(
      [...TALLY_EXPORT_STATUSES],
      [
        "APPROVED",
        "PROCESSING",
        "READY_FOR_DISPATCH",
        "DISPATCHED",
        "DELIVERED",
        "FULFILLED",
      ],
    );
  });

  it("excludes draft, pending, credit-held, rejected, and cancelled orders", () => {
    assert.deepEqual(
      [...TALLY_EXPORT_EXCLUDED_STATUSES],
      ["DRAFT", "PENDING_REVIEW", "ON_CREDIT_HOLD", "REJECTED", "CANCELLED"],
    );
  });

  it("classifies every order status exactly once", () => {
    const combined = [
      ...TALLY_EXPORT_STATUSES,
      ...TALLY_EXPORT_EXCLUDED_STATUSES,
    ].sort();

    assert.deepEqual(combined, [...ORDER_STATUSES].sort());
    assert.equal(new Set(combined).size, ORDER_STATUSES.length);
  });

  it("re-asserts eligibility in the pure builder", () => {
    for (const status of TALLY_EXPORT_STATUSES) {
      assert.equal(isTallyExportStatus(status), true, status);
    }

    for (const status of TALLY_EXPORT_EXCLUDED_STATUSES) {
      assert.equal(isTallyExportStatus(status), false, status);
    }

    assert.throws(
      () =>
        buildTallyExportRows([
          makeOrder({ status: "CANCELLED" }),
        ]),
      /not eligible/,
    );

    const result = createTallyExport(
      [makeOrder({ status: "REJECTED" })],
      { from: null, to: null },
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "INELIGIBLE_ORDER");
    }
  });

  it("builds a query that filters by the eligible status set", () => {
    const where = buildTallyExportWhere({ from: null, to: null });

    assert.deepEqual(where.status, { in: [...TALLY_EXPORT_STATUSES] });
    assert.deepEqual(where.items, { some: {} });

    const statuses = (where.status as { in: readonly string[] }).in;

    for (const forbidden of [
      "DRAFT",
      "PENDING_REVIEW",
      "ON_CREDIT_HOLD",
      "REJECTED",
      "CANCELLED",
    ]) {
      assert.equal(statuses.includes(forbidden), false, forbidden);
    }
  });

  it("restricts export permission to Order Desk and administrators", () => {
    assert.equal(hasPermission("ORDER_DESK", PERMISSIONS.ORDERS_EXPORT), true);
    assert.equal(hasPermission("ADMIN", PERMISSIONS.ORDERS_EXPORT), true);
    assert.equal(hasPermission("RETAILER", PERMISSIONS.ORDERS_EXPORT), false);
    assert.equal(hasPermission("SALESMAN", PERMISSIONS.ORDERS_EXPORT), false);
  });
});

describe("tally export date filters", () => {
  it("normalizes valid date filters and swaps reversed ranges", () => {
    assert.deepEqual(
      parseTallyExportFilters({
        from: " 2026-11-01 ",
        to: "2026-11-09",
      }),
      { from: "2026-11-01", to: "2026-11-09" },
    );

    assert.deepEqual(
      parseTallyExportFilters({ from: "2026-11-09", to: "2026-11-01" }),
      { from: "2026-11-01", to: "2026-11-09" },
    );
  });

  it("drops malformed and impossible dates", () => {
    assert.deepEqual(
      parseTallyExportFilters({
        from: "not-a-date",
        to: "2026-02-30",
      }),
      { from: null, to: null },
    );
  });

  it("applies inclusive Asia/Kolkata date boundaries", () => {
    const where = buildTallyExportWhere({
      from: "2026-11-01",
      to: "2026-11-01",
    });

    assert.deepEqual(where.createdAt, {
      gte: new Date("2026-10-31T18:30:00.000Z"),
      lt: new Date("2026-11-01T18:30:00.000Z"),
    });
  });

  it("omits the date condition when no filters are supplied", () => {
    const where = buildTallyExportWhere({ from: null, to: null });

    assert.equal("createdAt" in where, false);
  });
});

describe("tally export rows", () => {
  it("emits one row per order item with order context repeated", () => {
    const rows = buildTallyExportRows([
      makeOrder({
        items: [
          makeItem({ productSku: "SKU-A", productName: "Product A" }),
          makeItem({ productSku: "SKU-B", productName: "Product B" }),
        ],
      }),
    ]);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.orderNumber, "TP-20261101-000001");
    assert.equal(rows[0]?.orderDate, "2026-11-01");
    assert.equal(rows[0]?.retailerName, "Sharma Kirana Store");
    assert.equal(rows[1]?.orderNumber, "TP-20261101-000001");
    assert.equal(rows[1]?.retailerName, "Sharma Kirana Store");
    assert.equal(rows[0]?.sku, "SKU-A");
    assert.equal(rows[1]?.sku, "SKU-B");
  });

  it("preserves free quantities and scheme snapshots", () => {
    const [row] = buildTallyExportRows([
      makeOrder({
        items: [
          makeItem({
            quantity: 3,
            freeQuantity: 2,
            schemeName: "Festive Buy 3 Get 2",
            schemeType: "BUY_X_GET_Y",
            schemeDiscountPercent: null,
          }),
        ],
      }),
    ]);

    assert.ok(row);
    assert.equal(row.paidQuantity, "3");
    assert.equal(row.freeQuantity, "2");
    assert.equal(row.schemeName, "Festive Buy 3 Get 2");
    assert.equal(row.schemeType, "BUY_X_GET_Y");
    assert.equal(row.schemeDiscountPercent, "");
  });

  it("preserves percentage scheme discounts", () => {
    const [row] = buildTallyExportRows([
      makeOrder({
        total: "318.60",
        items: [
          makeItem({
            quantity: 3,
            freeQuantity: 0,
            schemeName: "10% off carton",
            schemeType: "PERCENTAGE_DISCOUNT",
            schemeDiscountPercent: "10.00",
            discount: "30.00",
            gstAmount: "48.60",
            lineTotal: "318.60",
          }),
        ],
      }),
    ]);

    assert.ok(row);
    assert.equal(row.schemeType, "PERCENTAGE_DISCOUNT");
    assert.equal(row.schemeDiscountPercent, "10");
    assert.equal(row.discount, "30.00");
  });

  it("keeps GST and line totals consistent with stored snapshots", () => {
    const [row] = buildTallyExportRows([
      makeOrder({
        total: "236.00",
        items: [
          makeItem({
            quantity: 2,
            freeQuantity: 1,
            unitPrice: "100.00",
            discount: "100.00",
            gstRate: "18.00",
            gstAmount: "36.00",
            lineTotal: "236.00",
          }),
        ],
      }),
    ]);

    assert.ok(row);
    const subtotal =
      Number(row.unitPrice) *
      (Number(row.paidQuantity) + Number(row.freeQuantity));

    assert.equal(subtotal, 300);
    assert.equal(
      subtotal - Number(row.discount) + Number(row.gstAmount),
      Number(row.lineTotal),
    );
    assert.equal(row.gstRate, "18");
    assert.equal(row.lineTotal, row.orderTotal);
  });

  it("keeps the order total equal to the sum of exported line totals", () => {
    const rows = buildTallyExportRows([
      makeOrder({
        total: "1062.00",
        items: [
          makeItem({
            productSku: "SKU-A",
            quantity: 2,
            freeQuantity: 1,
            unitPrice: "100.00",
            discount: "100.00",
            gstAmount: "36.00",
            lineTotal: "236.00",
          }),
          makeItem({
            productSku: "SKU-B",
            quantity: 4,
            freeQuantity: 0,
            unitPrice: "200.00",
            discount: "100.00",
            schemeName: "12.5% off carton",
            schemeType: "PERCENTAGE_DISCOUNT",
            schemeDiscountPercent: "12.50",
            gstAmount: "126.00",
            lineTotal: "826.00",
          }),
        ],
      }),
    ]);

    assert.equal(rows.length, 2);
    const summed = rows.reduce((total, row) => total + Number(row.lineTotal), 0);

    assert.equal(summed, Number(rows[0]?.orderTotal));
    assert.equal(rows[0]?.orderTotal, "1062.00");
  });

  it("exports historical snapshots instead of recalculating prices", () => {
    const [row] = buildTallyExportRows([
      makeOrder({
        total: "103.25",
        items: [
          makeItem({
            productName: "Discontinued Soap 90g (old pack)",
            unitPrice: "87.50",
            discount: "87.50",
            gstAmount: "15.75",
            lineTotal: "103.25",
          }),
        ],
      }),
    ]);

    assert.ok(row);
    assert.equal(row.productName, "Discontinued Soap 90g (old pack)");
    assert.equal(row.unitPrice, "87.50");
    assert.equal(row.gstAmount, "15.75");
    assert.equal(row.lineTotal, "103.25");
  });

  it("uses the Asia/Kolkata calendar date for order dates", () => {
    const [row] = buildTallyExportRows([
      makeOrder({ createdAt: new Date("2026-10-31T20:00:00.000Z") }),
    ]);

    assert.ok(row);
    assert.equal(row.orderDate, "2026-11-01");
  });

  it("normalizes stored decimal money and percentage values", () => {
    assert.equal(normalizeTallyMoney("100"), "100.00");
    assert.equal(normalizeTallyMoney("100.5"), "100.50");
    assert.equal(normalizeTallyMoney({ toString: () => "0" }), "0.00");
  });
});

describe("tally export CSV", () => {
  it("starts with a UTF-8 BOM and uses CRLF with a stable header", () => {
    const csv = buildTallyExportCsv([]);

    assert.equal(csv.charCodeAt(0), 0xfeff);

    const rows = csv.slice(1).split("\r\n");
    assert.equal(rows.at(-1), "");
    assert.equal(rows.length, 2);

    const header = parseCsvLine(rows[0] ?? "");
    assert.equal(header.length, TALLY_EXPORT_HEADERS.length);
    assert.deepEqual(header, [...TALLY_EXPORT_HEADERS]);
    assert.ok(rows[0]?.startsWith('"Order Number","Order Date","Customer Name"'));
  });

  it("writes row values in the documented column order", () => {
    const csv = buildTallyExportCsv(buildTallyExportRows([makeOrder()]));
    const lines = csv.slice(1).split("\r\n");
    const values = parseCsvLine(lines[1] ?? "");

    assert.equal(values.length, TALLY_EXPORT_HEADERS.length);
    assert.deepEqual(values, [
      "TP-20261101-000001",
      "2026-11-01",
      "Sharma Kirana Store",
      "SKU-BS-075",
      "Glucose Biscuit 75g",
      "Case of 96",
      "2",
      "1",
      "100.00",
      "100.00",
      "Buy 2 get 1",
      "BUY_X_GET_Y",
      "",
      "18",
      "36.00",
      "236.00",
      "236.00",
    ]);
  });

  it("escapes commas, quotes, and line breaks", () => {
    const csv = buildTallyExportCsv(
      buildTallyExportRows([
        makeOrder({
          retailerName: 'Sharma, "Kirana"\nStore',
          items: [makeItem({ productName: "Biscuit, 75g" })],
        }),
      ]),
    );

    assert.ok(csv.includes('"Sharma, ""Kirana""\nStore"'));
    assert.ok(csv.includes('"Biscuit, 75g"'));
  });

  it("neutralizes spreadsheet formula injection", () => {
    const csv = buildTallyExportCsv(
      buildTallyExportRows([
        makeOrder({
          retailerName: ' \n=HYPERLINK("http://evil")',
          items: [
            makeItem({ productName: "=cmd|' /C calc'!A0" }),
            makeItem({ productSku: "+91", productName: "-danger" }),
            makeItem({ productSku: "@import", productName: "\t=cmd" }),
            makeItem({ productSku: "SKU-LF", productName: "\n@SUM(1+1)" }),
            makeItem({ productSku: "SKU-SPACE", productName: " =1+1" }),
          ],
        }),
      ]),
    );

    assert.ok(csv.includes(`"' \n=HYPERLINK(""http://evil"")"`));
    assert.ok(csv.includes(`"'=cmd|' /C calc'!A0"`));
    assert.ok(csv.includes(`"'+91"`));
    assert.ok(csv.includes(`"'-danger"`));
    assert.ok(csv.includes(`"'@import"`));
    assert.ok(csv.includes(`"'\t=cmd"`));
    assert.ok(csv.includes(`"'\n@SUM(1+1)"`));
    assert.ok(csv.includes(`"' =1+1"`));
  });

  it("preserves UTF-8 text such as Devanagari names", () => {
    const csv = buildTallyExportCsv(
      buildTallyExportRows([
        makeOrder({
          retailerName: "शर्मा किराना स्टोर",
          items: [makeItem({ productName: "ग्लूकोज बिस्किट" })],
        }),
      ]),
    );

    assert.ok(csv.includes("शर्मा किराना स्टोर"));
    assert.ok(csv.includes("ग्लूकोज बिस्किट"));
  });

  it("escapes cells consistently when called directly", () => {
    assert.equal(escapeCsvCell("plain"), '"plain"');
    assert.equal(escapeCsvCell('a"b'), '"a""b"');
    assert.equal(escapeCsvCell("=1+1"), `"'=1+1"`);
    assert.equal(escapeCsvCell("\r=1+1"), `"'\r=1+1"`);
    assert.equal(escapeCsvCell("\n=1+1"), `"'\n=1+1"`);
    assert.equal(escapeCsvCell(" =1+1"), `"' =1+1"`);
    assert.equal(escapeCsvCell("\u00A0@SUM(1)"), `"'\u00A0@SUM(1)"`);
    // A leading tab is harmless when it is not followed by a formula trigger.
    assert.equal(escapeCsvCell("\tcmd"), `"\tcmd"`);
  });
});

describe("tally export limits and empty states", () => {
  it("uses a bounded order and line limit", () => {
    assert.equal(TALLY_EXPORT_MAX_ORDERS, 500);
    assert.equal(TALLY_EXPORT_MAX_LINES, 5_000);
  });

  it("evaluates boundaries deterministically", () => {
    assert.equal(
      tallyExportLimitProblem({
        orderCount: TALLY_EXPORT_MAX_ORDERS,
        lineCount: TALLY_EXPORT_MAX_LINES,
        total: "0.00",
      }),
      null,
    );
    assert.equal(
      tallyExportLimitProblem({
        orderCount: TALLY_EXPORT_MAX_ORDERS + 1,
        lineCount: 1,
        total: "0.00",
      }),
      "ORDER_LIMIT",
    );
    assert.equal(
      tallyExportLimitProblem({
        orderCount: 1,
        lineCount: TALLY_EXPORT_MAX_LINES + 1,
        total: "0.00",
      }),
      "LINE_LIMIT",
    );
  });

  it("reports an empty export when no orders match", () => {
    const result = createTallyExport([], { from: null, to: null });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "EMPTY");
      assert.equal(result.summary.orderCount, 0);
    }

    const itemless = createTallyExport(
      [makeOrder({ items: [], total: "999.00" })],
      { from: null, to: null },
    );

    assert.equal(itemless.ok, false);
    if (!itemless.ok) {
      assert.equal(itemless.reason, "EMPTY");
    }
  });

  it("ignores orders without lines in counts and totals", () => {
    const summary = summarizeTallyExportOrders([
      makeOrder({ orderNumber: "TP-20261101-000000", items: [], total: "999.00" }),
      makeOrder(),
    ]);

    assert.deepEqual(summary, {
      orderCount: 1,
      lineCount: 1,
      total: "236.00",
    });
  });

  it("summarizes bounded counts without loading order items", () => {
    const summary = summarizeTallyExportCounts([
      { total: "100.00", itemCount: 2 },
      { total: "50.00", itemCount: 0 },
      { total: "25.50", itemCount: 1 },
    ]);

    assert.deepEqual(summary, {
      orderCount: 2,
      lineCount: 3,
      total: "125.50",
    });
  });

  it("refuses an order count above the bounded limit", () => {
    const orders = Array.from({ length: TALLY_EXPORT_MAX_ORDERS + 1 }, (_, index) =>
      makeOrder({
        orderNumber: `TP-20261101-${String(index + 1).padStart(6, "0")}`,
      }),
    );
    const result = createTallyExport(orders, { from: null, to: null });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "ORDER_LIMIT");
      assert.equal(result.summary.orderCount, TALLY_EXPORT_MAX_ORDERS + 1);
    }
  });

  it("allows an export exactly at the order limit", () => {
    const orders = Array.from({ length: TALLY_EXPORT_MAX_ORDERS }, (_, index) =>
      makeOrder({
        orderNumber: `TP-20261101-${String(index + 1).padStart(6, "0")}`,
      }),
    );
    const result = createTallyExport(orders, { from: null, to: null });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.summary.orderCount, TALLY_EXPORT_MAX_ORDERS);
      assert.equal(result.summary.lineCount, TALLY_EXPORT_MAX_ORDERS);
    }
  });

  it("refuses a line count above the bounded limit", () => {
    const items = Array.from({ length: TALLY_EXPORT_MAX_LINES + 1 }, (_, index) =>
      makeItem({ productSku: `SKU-${index}` }),
    );
    const result = createTallyExport([makeOrder({ items })], {
      from: null,
      to: null,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "LINE_LIMIT");
      assert.equal(result.summary.lineCount, TALLY_EXPORT_MAX_LINES + 1);
    }
  });

  it("allows an export exactly at the line limit", () => {
    const items = Array.from({ length: TALLY_EXPORT_MAX_LINES }, (_, index) =>
      makeItem({ productSku: `SKU-${index}` }),
    );
    const result = createTallyExport([makeOrder({ items })], {
      from: null,
      to: null,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.summary.lineCount, TALLY_EXPORT_MAX_LINES);
    }
  });
});

describe("tally export audit and filenames", () => {
  it("records a bounded audit payload without customer data", () => {
    const filters = { from: "2026-11-01", to: "2026-11-09" };
    const summary = summarizeTallyExportOrders([makeOrder()]);
    const audit = tallyExportAuditMetadata(summary, filters);
    const serialized = JSON.stringify(audit);

    assert.equal(audit.eventType, TALLY_EXPORT_AUDIT_EVENT);
    assert.equal(audit.eventType, "ORDER_TALLY_EXPORTED");
    assert.equal(audit.entityType, TALLY_EXPORT_AUDIT_ENTITY);
    assert.equal(audit.entityType, "OrderExport");
    assert.equal(audit.metadata.format, "CSV");
    assert.equal(audit.metadata.unitPriceBasis, "GST_EXCLUSIVE");
    assert.equal(audit.metadata.lineTotalBasis, "GST_INCLUSIVE");
    assert.equal(audit.metadata.orderTotalBasis, "GST_INCLUSIVE");
    assert.equal(audit.metadata.from, "2026-11-01");
    assert.equal(audit.metadata.to, "2026-11-09");
    assert.equal(audit.metadata.orderCount, 1);
    assert.equal(audit.metadata.lineCount, 1);
    assert.equal(audit.metadata.total, "236.00");
    assert.equal(serialized.includes("Sharma Kirana Store"), false);
    assert.equal(serialized.includes("Glucose Biscuit"), false);
    assert.equal(serialized.includes("SKU-BS-075"), false);
  });

  it("generates safe, deterministic filenames", () => {
    assert.equal(
      tallyExportFilename({ from: null, to: null }),
      "tradepulse-tally-orders-all.csv",
    );
    assert.equal(
      tallyExportFilename({ from: "2026-11-01", to: "2026-11-09" }),
      "tradepulse-tally-orders-2026-11-01-to-2026-11-09.csv",
    );
    assert.equal(
      tallyExportFilename({ from: "2026-11-01", to: null }),
      "tradepulse-tally-orders-from-2026-11-01.csv",
    );
    assert.equal(
      tallyExportFilename({ from: null, to: "2026-11-09" }),
      "tradepulse-tally-orders-to-2026-11-09.csv",
    );
    assert.equal(
      tallyExportFilename({ from: "../../etc/passwd", to: null }),
      "tradepulse-tally-orders-all.csv",
    );
  });

  it("produces identical output on repeated exports without mutating input", () => {
    const order = makeOrder();
    const filters = { from: "2026-11-01", to: "2026-11-09" };
    const first = createTallyExport([order], filters);
    const second = createTallyExport([order], filters);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    if (first.ok && second.ok) {
      assert.equal(first.csv, second.csv);
      assert.equal(first.filename, second.filename);
      assert.deepEqual(first.summary, second.summary);
    }

    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.quantity, 2);
    assert.equal(order.items[0]?.freeQuantity, 1);
  });
});
