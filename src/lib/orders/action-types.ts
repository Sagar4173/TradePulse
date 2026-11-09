import type { CheckoutLineChange } from "./checkout";

export const CHECKOUT_ACTION_CODES = [
  "CART_EMPTY",
  "CART_CHANGED",
  "CART_HAS_ISSUES",
  "INVALID_REVIEW",
  "INVALID_REQUEST",
  "INSUFFICIENT_STOCK",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN",
] as const;

export type CheckoutActionCode = (typeof CHECKOUT_ACTION_CODES)[number];

export type CheckoutShortage = {
  sku: string;
  requestedCases: number;
  availableCases: number;
};

export type CheckoutActionState = {
  status: "idle" | "error";
  code: CheckoutActionCode | null;
  message?: string;
  changes?: CheckoutLineChange[];
  shortages?: CheckoutShortage[];
};

export const INITIAL_CHECKOUT_ACTION_STATE: CheckoutActionState = {
  status: "idle",
  code: null,
};

export const ORDER_ACTION_CODES = [
  "UPDATED",
  "ALREADY_APPLIED",
  "INVALID_TRANSITION",
  "REASON_REQUIRED",
  "CREDIT_LIMIT_EXCEEDED",
  "INSUFFICIENT_STOCK",
  "INVALID_STOCK_STATE",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "UNKNOWN",
] as const;

export type OrderActionCode = (typeof ORDER_ACTION_CODES)[number];

export type OrderTransitionActionState = {
  status: "idle" | "success" | "error";
  code: OrderActionCode | null;
  message?: string;
  shortages?: CheckoutShortage[];
};

export const INITIAL_ORDER_ACTION_STATE: OrderTransitionActionState = {
  status: "idle",
  code: null,
};
