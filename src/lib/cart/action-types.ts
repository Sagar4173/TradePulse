export const CART_ACTION_CODES = [
  "ADDED",
  "UPDATED",
  "REMOVED",
  "CLEARED",
  "INVALID_SKU",
  "INVALID_QUANTITY",
  "QUANTITY_LIMIT",
  "CART_FULL",
  "PRODUCT_UNAVAILABLE",
  "PRICE_UNAVAILABLE",
  "STOCK_UNAVAILABLE",
  "OUT_OF_STOCK",
  "INSUFFICIENT_STOCK",
  "LINE_NOT_FOUND",
  "COOKIE_TOO_LARGE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN",
] as const;

export type CartActionCode = (typeof CART_ACTION_CODES)[number];

export type CartActionState = {
  status: "idle" | "success" | "error";
  code: CartActionCode | null;
  sku?: string;
  quantity?: number;
  availableCases?: number;
  itemCount?: number;
};

export const INITIAL_CART_ACTION_STATE: CartActionState = {
  status: "idle",
  code: null,
};
