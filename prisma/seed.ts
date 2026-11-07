import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  SchemeType,
} from "../src/generated/prisma/client";

// Seed and other administrative writes prefer the direct, non-pooled
// connection. DATABASE_URL remains a fallback for single-endpoint setups.
const connectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DIRECT_URL (preferred) or DATABASE_URL must be set. Copy .env.example to .env and configure Neon PostgreSQL.",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const retailerSeed = {
  id: "retailer_demo_001",
  shopName: "Demo Kirana Store",
  ownerName: "Demo Retailer",
  phone: "+91-90000-00001",
  creditLimit: "150000.00",
};

// GST rates and retailer prices are illustrative seed values, not tax advice.
const productSeeds = [
  {
    sku: "SKU-BS-075",
    name: "Glucose Biscuit 75g",
    description: "Everyday glucose biscuit for retail counters.",
    brand: "Sunrise Foods",
    category: "Biscuits & Snacks",
    imageUrl: "/products/glucose-biscuit.svg",
    unitLabel: "Case of 96",
    dealerPrice: "8.10",
    gstRate: "18.00",
    stockCases: 340,
    sellingPrice: "9.50",
  },
  {
    sku: "SKU-DT-1KG",
    name: "Detergent Powder 1kg",
    description: "Household detergent powder in a one-kilogram pack.",
    brand: "CleanWave",
    category: "Home Care",
    imageUrl: "/products/detergent-powder.svg",
    unitLabel: "Case of 20",
    dealerPrice: "101.50",
    gstRate: "18.00",
    stockCases: 85,
    sellingPrice: "112.00",
  },
  {
    sku: "SKU-TE-250",
    name: "Tea Leaf 250g",
    description: "Packaged tea leaf for kirana retail.",
    brand: "Hilltop Tea",
    category: "Beverages",
    imageUrl: "/products/tea-leaf.svg",
    unitLabel: "Case of 40",
    dealerPrice: "118.00",
    gstRate: "5.00",
    stockCases: 0,
    sellingPrice: "130.00",
  },
] as const;

const schemeSeeds = [
  {
    id: "scheme_bs_075_buy_10_get_1",
    name: "Buy 10 cases, get 1 free",
    type: SchemeType.BUY_X_GET_Y,
    isActive: true,
    startsAt: null,
    endsAt: null,
    minimumQuantity: 10,
    freeQuantity: 1,
    discountPercent: null,
    productSku: "SKU-BS-075",
  },
  {
    id: "scheme_dt_1kg_3pct_5plus",
    name: "3% discount on 5 or more cases",
    type: SchemeType.PERCENTAGE_DISCOUNT,
    isActive: true,
    startsAt: null,
    endsAt: null,
    minimumQuantity: 5,
    freeQuantity: null,
    discountPercent: "3.00",
    productSku: "SKU-DT-1KG",
  },
] as const;

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEMO_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to run the demo seed with NODE_ENV=production. " +
        "Set ALLOW_DEMO_SEED=true only for a disposable environment.",
    );
  }

  const effectiveFrom = new Date("2026-01-01T00:00:00.000Z");

  await prisma.$transaction(async (tx) => {
    const retailer = await tx.retailer.upsert({
      where: { id: retailerSeed.id },
      update: {
        shopName: retailerSeed.shopName,
        ownerName: retailerSeed.ownerName,
        phone: retailerSeed.phone,
        creditLimit: retailerSeed.creditLimit,
      },
      create: retailerSeed,
    });

    for (const product of productSeeds) {
      await tx.product.upsert({
        where: { sku: product.sku },
        update: {
          name: product.name,
          description: product.description,
          brand: product.brand,
          category: product.category,
          imageUrl: product.imageUrl,
          unitLabel: product.unitLabel,
          dealerPrice: product.dealerPrice,
          gstRate: product.gstRate,
          isActive: true,
        },
        create: {
          sku: product.sku,
          name: product.name,
          description: product.description,
          brand: product.brand,
          category: product.category,
          imageUrl: product.imageUrl,
          unitLabel: product.unitLabel,
          dealerPrice: product.dealerPrice,
          gstRate: product.gstRate,
          isActive: true,
        },
      });

      await tx.inventory.upsert({
        where: { productSku: product.sku },
        update: {
          stockCases: product.stockCases,
          reservedCases: 0,
        },
        create: {
          productSku: product.sku,
          stockCases: product.stockCases,
          reservedCases: 0,
        },
      });

      await tx.retailerProductPrice.upsert({
        where: {
          retailerId_productSku: {
            retailerId: retailer.id,
            productSku: product.sku,
          },
        },
        update: {
          sellingPrice: product.sellingPrice,
          effectiveFrom,
        },
        create: {
          retailerId: retailer.id,
          productSku: product.sku,
          sellingPrice: product.sellingPrice,
          effectiveFrom,
        },
      });
    }

    for (const scheme of schemeSeeds) {
      await tx.scheme.upsert({
        where: { id: scheme.id },
        update: scheme,
        create: scheme,
      });
    }
  });

  console.log(
    "Seed complete: 3 products, 3 inventory records, 1 retailer, 3 retailer prices, and 2 schemes.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      "Seed failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
