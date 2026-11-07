-- Milestone 3 catalogue metadata (additive, not applied).
--
-- Product already carries the commercial fields needed for pricing, tax and
-- stock. The retailer catalogue additionally needs presentation/search
-- dimensions. These columns are nullable so existing rows remain valid without
-- a backfill or invented data. The demonstration seed supplies values for the
-- three demo products.
--
-- Review and apply this SQL separately. It is intentionally not applied as part
-- of this milestone.

ALTER TABLE "Product"
  ADD COLUMN "brand" VARCHAR(120),
  ADD COLUMN "category" VARCHAR(80),
  ADD COLUMN "imageUrl" VARCHAR(500);

CREATE INDEX "Product_isActive_category_idx"
  ON "Product"("isActive", "category");
