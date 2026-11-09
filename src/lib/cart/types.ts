import type { AppliedScheme, SchemeCandidate } from "../schemes/engine";
import type { StockSnapshot, StockStatus } from "../inventory/stock";
import type { CartLineInput } from "./cookie";

type DecimalLike = { toString(): string } | string;

/** Commercial data reloaded from the database for one cart SKU. */
export type CartPriceInput = {
  sku: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  unitLabel: string;
  gstRate: DecimalLike;
  /** The authenticated retailer's price only. */
  unitPricePaise: bigint | null;
  stock: StockSnapshot;
  schemes: SchemeCandidate[];
};

export type CartLineNotice =
  | "PRICE_UNAVAILABLE"
  | "TAX_UNAVAILABLE"
  | "STOCK_UNAVAILABLE"
  | "OUT_OF_STOCK"
  | "STOCK_REDUCED"
  | "FREE_UNITS_REDUCED";

export type CartLineResult = {
  sku: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  unitLabel: string;
  unitPricePaise: bigint | null;
  gstRateBasisPoints: bigint | null;
  requestedQuantity: number;
  paidQuantity: number;
  freeQuantity: number;
  fulfilledQuantity: number;
  stockStatus: StockStatus;
  availableCases: number | null;
  scheme: AppliedScheme | null;
  schemeName: string | null;
  schemeDiscountPercentBasisPoints: bigint | null;
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
  notices: CartLineNotice[];
  isOrderable: boolean;
};

export type CartGstBreakdown = {
  rateBasisPoints: bigint;
  taxablePaise: bigint;
  gstPaise: bigint;
};

export type CartSummary = {
  lines: CartLineResult[];
  unavailableSkus: string[];
  itemCount: number;
  lineCount: number;
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
  gstBreakdown: CartGstBreakdown[];
  hasIssues: boolean;
};

export type CartCalculationInput = {
  lines: readonly CartLineInput[];
  products: ReadonlyMap<string, CartPriceInput>;
};
