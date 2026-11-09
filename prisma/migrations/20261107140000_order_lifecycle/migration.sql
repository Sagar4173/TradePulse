-- Milestone 4: order lifecycle, credit exposure, and stock reservation.
--
-- Additive only. Existing order and order-item rows are preserved. The
-- order-number backfill uses the Asia/Kolkata calendar date and the existing
-- creation order; the sequence is advanced past every backfilled row.

-- 1. Order statuses and lifecycle enums.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_DISPATCH';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPATCHED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

CREATE TYPE "CreditCheckStatus" AS ENUM ('NOT_CHECKED', 'PASSED', 'FAILED');
CREATE TYPE "StockState" AS ENUM ('NONE', 'RESERVED', 'RELEASED', 'DEDUCTED');

-- 2. Order number sequence and columns.
CREATE SEQUENCE "order_number_seq" START WITH 1 INCREMENT BY 1;

ALTER TABLE "Order"
  ADD COLUMN "orderNumber" VARCHAR(32),
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "creditCheckStatus" "CreditCheckStatus" NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN "creditLimitSnapshot" DECIMAL(14,2),
  ADD COLUMN "creditOutstandingSnapshot" DECIMAL(14,2),
  ADD COLUMN "creditHoldReason" VARCHAR(500),
  ADD COLUMN "creditCheckedAt" TIMESTAMPTZ(3),
  ADD COLUMN "stockState" "StockState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "statusReason" VARCHAR(500);

-- Backfill every pre-M4 order with a unique, human-readable number.
WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "Order"
)
UPDATE "Order" AS o
SET "orderNumber" =
  'TP-' ||
  to_char(o."createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') ||
  '-' ||
  lpad(numbered.rn::text, 6, '0')
FROM numbered
WHERE numbered."id" = o."id";

SELECT setval(
  'order_number_seq',
  GREATEST((SELECT COUNT(*) FROM "Order"), 1),
  (SELECT COUNT(*) FROM "Order") > 0
);

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;

ALTER TABLE "OrderItem"
  ADD COLUMN "freeQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "schemeId" VARCHAR(100),
  ADD COLUMN "schemeName" VARCHAR(160),
  ADD COLUMN "schemeType" "SchemeType",
  ADD COLUMN "schemeDiscountPercent" DECIMAL(5,2);

-- 3. Indexes.
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE UNIQUE INDEX "Order_retailerId_idempotencyKey_key" ON "Order"("retailerId", "idempotencyKey");
CREATE INDEX "Order_status_stockState_idx" ON "Order"("status", "stockState");
CREATE INDEX "Order_retailerId_status_createdAt_idx" ON "Order"("retailerId", "status", "createdAt");

-- 4. Lifecycle invariants.
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderNumber_format"
  CHECK ("orderNumber" ~ '^TP-[0-9]{8}-[0-9]{6}$');

ALTER TABLE "Order" ADD CONSTRAINT "Order_credit_snapshots_nonnegative"
  CHECK (
    ("creditLimitSnapshot" IS NULL OR "creditLimitSnapshot" >= 0) AND
    ("creditOutstandingSnapshot" IS NULL OR "creditOutstandingSnapshot" >= 0)
  );

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_freeQuantity_nonnegative"
  CHECK ("freeQuantity" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_schemeDiscountPercent_range"
  CHECK (
    "schemeDiscountPercent" IS NULL OR
    ("schemeDiscountPercent" >= 0 AND "schemeDiscountPercent" <= 100)
  );

-- Existing M3 rows may contain historical rounding differences. NOT VALID
-- still enforces each constraint for every new insert and update without
-- rewriting or rejecting preserved history.
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_consistent"
  CHECK ("total" = "subtotal" - "discount" + "gstAmount") NOT VALID;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_lineTotal_consistent"
  CHECK (
    "lineTotal" =
      ("quantity" + "freeQuantity") * "unitPrice" -
      "discount" +
      "gstAmount"
  ) NOT VALID;

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_reservedCases_within_stock"
  CHECK ("reservedCases" <= "stockCases") NOT VALID;
