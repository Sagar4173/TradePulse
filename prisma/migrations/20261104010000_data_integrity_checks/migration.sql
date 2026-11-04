-- Data integrity checks that are not expressible in the Prisma schema.
-- Added as a separate migration so the initial migration stays immutable.

ALTER TABLE "Retailer" ADD CONSTRAINT "Retailer_creditLimit_nonnegative" CHECK ("creditLimit" >= 0);

ALTER TABLE "Product" ADD CONSTRAINT "Product_dealerPrice_nonnegative" CHECK ("dealerPrice" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_gstRate_range" CHECK ("gstRate" >= 0 AND "gstRate" <= 100);

ALTER TABLE "RetailerProductPrice" ADD CONSTRAINT "RetailerProductPrice_sellingPrice_nonnegative" CHECK ("sellingPrice" >= 0);

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_stockCases_nonnegative" CHECK ("stockCases" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_reservedCases_nonnegative" CHECK ("reservedCases" >= 0);

ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_minimumQuantity_positive" CHECK ("minimumQuantity" IS NULL OR "minimumQuantity" > 0);
ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_freeQuantity_positive" CHECK ("freeQuantity" IS NULL OR "freeQuantity" > 0);
ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_discountPercent_range" CHECK ("discountPercent" IS NULL OR ("discountPercent" >= 0 AND "discountPercent" <= 100));

ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_nonnegative" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "gstAmount" >= 0 AND "total" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_nonnegative" CHECK ("unitPrice" >= 0 AND "discount" >= 0 AND "gstAmount" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_gstRate_range" CHECK ("gstRate" >= 0 AND "gstRate" <= 100);
