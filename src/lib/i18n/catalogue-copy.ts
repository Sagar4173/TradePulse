import type {
  AvailabilityFilter,
  CatalogueSort,
} from "../catalogue/types";
import type { StockStatus } from "../inventory/stock";

export type CatalogueCopy = {
  eyebrow: string;
  title: string;
  description: string;
  filters: {
    heading: string;
    searchLabel: string;
    searchPlaceholder: string;
    categoryLabel: string;
    allCategories: string;
    availabilityLabel: string;
    availability: Record<AvailabilityFilter, string>;
    sortLabel: string;
    sort: Record<CatalogueSort, string>;
    apply: string;
    clear: string;
  };
  resultCount: (count: number) => string;
  empty: {
    title: string;
    description: string;
    action: string;
  };
  card: {
    imageAlt: (name: string) => string;
    priceUnavailable: string;
    gstUnavailable: string;
    gst: (percent: string) => string;
    perUnit: (unit: string) => string;
    stock: Record<StockStatus, string>;
    available: (count: number) => string;
    schemesHeading: string;
    addToCart: string;
    quantityLabel: (name: string) => string;
    decrease: string;
    increase: string;
    added: (quantity: number) => string;
    viewCart: string;
  };
  pagination: {
    previous: string;
    next: string;
    pageOf: (page: number, pageCount: number) => string;
  };
  retailerRequired: {
    title: string;
    description: string;
  };
  cartLink: string;
};

export const catalogueCopy: CatalogueCopy = {
  eyebrow: "Retailer catalogue",
  title: "Product Catalogue",
  description:
    "Your store-specific prices, live stock visibility, and current schemes.",
  filters: {
    heading: "Search and filter",
    searchLabel: "Search products",
    searchPlaceholder: "Product name, SKU, or brand",
    categoryLabel: "Category",
    allCategories: "All categories",
    availabilityLabel: "Availability",
    availability: {
      all: "All products",
      "in-stock": "In stock",
      "low-stock": "Low stock",
      "out-of-stock": "Out of stock",
    },
    sortLabel: "Sort by",
    sort: {
      "name-asc": "Name A–Z",
      "name-desc": "Name Z–A",
      "price-asc": "Price low to high",
      "price-desc": "Price high to low",
    },
    apply: "Apply filters",
    clear: "Clear filters",
  },
  resultCount: (count) =>
    `${count} ${count === 1 ? "product" : "products"} found`,
  empty: {
    title: "No products match",
    description:
      "Try a different search term, category, or availability filter.",
    action: "Clear filters",
  },
  card: {
    imageAlt: (name) => `${name} product image`,
    priceUnavailable: "Price not available",
    gstUnavailable: "GST information unavailable",
    gst: (percent) => `+ ${percent}% GST`,
    perUnit: (unit) => `Per ${unit}`,
    stock: {
      IN_STOCK: "In stock",
      LOW_STOCK: "Low stock",
      OUT_OF_STOCK: "Out of stock",
      UNAVAILABLE: "Stock unavailable",
    },
    available: (count) =>
      `${count} ${count === 1 ? "case" : "cases"} available`,
    schemesHeading: "Available schemes",
    addToCart: "Add to cart",
    quantityLabel: (name) => `Quantity for ${name}`,
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    added: (quantity) =>
      `Added ${quantity} ${quantity === 1 ? "case" : "cases"} to your cart.`,
    viewCart: "View cart",
  },
  pagination: {
    previous: "Previous",
    next: "Next",
    pageOf: (page, pageCount) => `Page ${page} of ${pageCount}`,
  },
  retailerRequired: {
    title: "Retailer access required",
    description:
      "This catalogue is available to retailer accounts linked to a store. Contact your administrator if you need access.",
  },
  cartLink: "Cart",
};
