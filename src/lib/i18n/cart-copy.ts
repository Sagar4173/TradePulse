import type { CartActionState } from "../cart/action-types";
import type { CartLineNotice } from "../cart/types";

export type CartCopy = {
  eyebrow: string;
  title: string;
  description: string;
  continueShopping: string;
  clearCart: string;
  confirmClear: string;
  cancel: string;
  empty: {
    title: string;
    description: string;
    action: string;
  };
  unavailable: (count: number) => string;
  itemsHeading: string;
  line: {
    unitPrice: string;
    lineTotal: string;
    gstRate: (percent: string) => string;
    quantity: string;
    quantityLabel: (name: string) => string;
    update: string;
    remove: string;
    removeLabel: (name: string) => string;
    freeUnits: (count: number) => string;
    schemeDiscount: string;
    stockLeft: (count: number) => string;
  };
  summary: {
    title: string;
    items: (count: number) => string;
    subtotal: string;
    discount: string;
    taxable: string;
    gst: string;
    total: string;
    gstLine: (percent: string) => string;
    priceNote: string;
    checkoutNote: string;
  };
  notices: Record<CartLineNotice, string>;
};

export const cartCopy: CartCopy = {
  eyebrow: "Retailer cart",
  title: "Shopping Cart",
  description:
    "Quantities and prices are checked again on the server before totals are shown.",
  continueShopping: "Continue shopping",
  clearCart: "Clear cart",
  confirmClear: "Confirm clear",
  cancel: "Cancel",
  empty: {
    title: "Your cart is empty",
    description:
      "Add products from your catalogue to see live pricing, schemes, and estimated totals.",
    action: "Browse catalogue",
  },
  unavailable: (count) =>
    `${count} ${count === 1 ? "item is" : "items are"} no longer available and was removed from this cart view.`,
  itemsHeading: "Cart items",
  line: {
    unitPrice: "Unit price",
    lineTotal: "Line total",
    gstRate: (percent) => `${percent}% GST`,
    quantity: "Quantity",
    quantityLabel: (name) => `Quantity for ${name}`,
    update: "Update",
    remove: "Remove",
    removeLabel: (name) => `Remove ${name} from cart`,
    freeUnits: (count) =>
      `Includes ${count} free ${count === 1 ? "case" : "cases"} from the applied scheme.`,
    schemeDiscount: "Scheme discount",
    stockLeft: (count) => `${count} available`,
  },
  summary: {
    title: "Order summary",
    items: (count) => `${count} ${count === 1 ? "case" : "cases"}`,
    subtotal: "Subtotal",
    discount: "Scheme discounts",
    taxable: "Taxable value",
    gst: "GST",
    total: "Estimated total",
    gstLine: (percent) => `GST at ${percent}%`,
    priceNote:
      "Prices are shown exclusive of GST. Final totals are recalculated on the server.",
    checkoutNote:
      "Order placement is not enabled in this milestone. Your cart stays available in this browser.",
  },
  notices: {
    PRICE_UNAVAILABLE:
      "A retailer price is not available for this product, so it cannot be ordered.",
    TAX_UNAVAILABLE:
      "A valid GST rate is not available for this product, so it cannot be ordered.",
    STOCK_UNAVAILABLE:
      "Stock information is unavailable for this product, so it cannot be ordered.",
    OUT_OF_STOCK: "This product is out of stock.",
    STOCK_REDUCED:
      "Available stock is lower than requested. The quantity has been reduced.",
    FREE_UNITS_REDUCED:
      "Not enough stock is available for all free units under this scheme. Free units have been reduced or removed.",
  },
};

const ACTION_MESSAGES: Record<
  Exclude<CartActionState["status"], "idle">,
  Partial<Record<NonNullable<CartActionState["code"]>, string>>
> = {
  success: {
    ADDED: "Cart updated.",
    UPDATED: "Quantity updated.",
    REMOVED: "Item removed from your cart.",
    CLEARED: "Your cart has been cleared.",
  },
  error: {
    INVALID_SKU: "That product reference is not valid.",
    INVALID_QUANTITY: "Enter a quantity between 1 and 999 cases.",
    QUANTITY_LIMIT: "The maximum quantity per product is 999 cases.",
    CART_FULL: "Your cart is full. Remove an item before adding another.",
    PRODUCT_UNAVAILABLE: "This product is no longer available.",
    PRICE_UNAVAILABLE:
      "A retailer price is not available for this product, so it cannot be added.",
    STOCK_UNAVAILABLE:
      "Stock information is unavailable for this product, so it cannot be added.",
    OUT_OF_STOCK: "This product is out of stock.",
    INSUFFICIENT_STOCK: "Only the available stock can be added to your cart.",
    LINE_NOT_FOUND: "That item is no longer in your cart.",
    COOKIE_TOO_LARGE:
      "Your cart is too large for this browser. Remove an item and try again.",
    UNAUTHORIZED: "Your session has expired. Sign in again.",
    FORBIDDEN: "Retailer cart access is required.",
    UNKNOWN: "We could not update your cart. Please try again.",
  },
};

export function cartActionMessage(state: CartActionState): string | null {
  if (state.status === "idle" || !state.code) {
    return null;
  }

  if (state.code === "INSUFFICIENT_STOCK" && state.availableCases != null) {
    return `Only ${state.availableCases} ${
      state.availableCases === 1 ? "case is" : "cases are"
    } available.`;
  }

  return ACTION_MESSAGES[state.status][state.code] ?? null;
}

export function addedToCartMessage(quantity: number): string {
  return `Added ${quantity} ${quantity === 1 ? "case" : "cases"} to your cart.`;
}
