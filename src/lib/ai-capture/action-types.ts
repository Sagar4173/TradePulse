import type { CaptureLine } from "./types";

export const MAX_CAPTURE_TEXT_LENGTH = 2_000;
export const MAX_CONFIRMATION_PAYLOAD_LENGTH = 20_000;

export const CAPTURE_ACTION_CODES = [
  "PARSED",
  "TEXT_REQUIRED",
  "TEXT_TOO_LONG",
  "NO_LINES",
  "INVALID_CONFIRMATION",
  "NO_CONFIRMED_LINES",
  "PRODUCT_UNAVAILABLE",
  "PRICE_UNAVAILABLE",
  "STOCK_UNAVAILABLE",
  "OUT_OF_STOCK",
  "INSUFFICIENT_STOCK",
  "QUANTITY_LIMIT",
  "CART_FULL",
  "ALIAS_SAVE_FAILED",
  "COOKIE_TOO_LARGE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN",
] as const;

export type CaptureActionCode = (typeof CAPTURE_ACTION_CODES)[number];

export type CaptureLineIssue = {
  sku: string;
  code:
    | "PRODUCT_UNAVAILABLE"
    | "PRICE_UNAVAILABLE"
    | "STOCK_UNAVAILABLE"
    | "OUT_OF_STOCK"
    | "INSUFFICIENT_STOCK"
    | "QUANTITY_LIMIT"
    | "CART_FULL";
  availableCases?: number;
};

export type CaptureActionState = {
  status: "idle" | "success" | "error";
  code: CaptureActionCode | null;
  message?: string;
  text?: string;
  /** Fresh for every successful parse so review state is never reused. */
  captureId?: string;
  lines?: CaptureLine[];
  issues?: CaptureLineIssue[];
};

export const INITIAL_CAPTURE_ACTION_STATE: CaptureActionState = {
  status: "idle",
  code: null,
};

export type CaptureSearchResult =
  | {
      ok: true;
      products: Array<{
        sku: string;
        name: string;
        brand: string | null;
        unitLabel: string;
        availableCases: number | null;
        hasRetailerPrice: boolean;
      }>;
    }
  | { ok: false; message: string };
