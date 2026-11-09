-- Milestone 5: retailer-scoped product aliases for deterministic order capture.
--
-- Additive only and intentionally not applied by this repository's M5 work.
-- The alias table is keyed by retailer and normalised phrase so one retailer
-- cannot silently change the meaning of another retailer's shorthand.

CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "phrase" VARCHAR(200) NOT NULL,
    "normalizedPhrase" VARCHAR(200) NOT NULL,
    "confirmationCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductAlias_retailerId_normalizedPhrase_key"
  ON "ProductAlias"("retailerId", "normalizedPhrase");
CREATE INDEX "ProductAlias_retailerId_isActive_idx"
  ON "ProductAlias"("retailerId", "isActive");
CREATE INDEX "ProductAlias_productSku_idx"
  ON "ProductAlias"("productSku");

ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_retailerId_fkey"
  FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_productSku_fkey"
  FOREIGN KEY ("productSku") REFERENCES "Product"("sku")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductAlias"
  ADD CONSTRAINT "ProductAlias_phrase_not_blank"
  CHECK (length(btrim("phrase")) > 0),
  ADD CONSTRAINT "ProductAlias_normalizedPhrase_not_blank"
  CHECK (length(btrim("normalizedPhrase")) > 0),
  ADD CONSTRAINT "ProductAlias_confirmationCount_positive"
  CHECK ("confirmationCount" > 0);
