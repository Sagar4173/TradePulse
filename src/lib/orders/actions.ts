"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PERMISSIONS,
  hasAnyPermission,
  hasPermission,
} from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { resolveRetailerCartOwner } from "@/lib/cart/owner";
import { clearCartCookie, readCartCookieLines } from "@/lib/cart/store";

import type {
  CheckoutActionState,
  OrderTransitionActionState,
} from "./action-types";
import { parseCheckoutReview } from "./checkout";
import { transitionOrder } from "./lifecycle";
import { submitOrder } from "./submission";
import { isOrderAction } from "./transitions";

function checkoutFailure(
  code: CheckoutActionState["code"],
  message: string,
  extra: Partial<CheckoutActionState> = {},
): CheckoutActionState {
  return { status: "error", code, message, ...extra };
}

function transitionFailure(
  code: OrderTransitionActionState["code"],
  message: string,
  extra: Partial<OrderTransitionActionState> = {},
): OrderTransitionActionState {
  return { status: "error", code, message, ...extra };
}

/**
 * Submits the authenticated retailer's cart. The browser supplies only the
 * cart cookie, an idempotency key, and the display-only review token; every
 * commercial value is recalculated by `submitOrder` from database data.
 */
export async function submitCheckoutAction(
  _previousState: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const session = await getSession();

  if (!session) {
    return checkoutFailure(
      "UNAUTHORIZED",
      "Your session has expired. Sign in again to place this order.",
    );
  }

  if (
    !hasPermission(session.user.role, PERMISSIONS.ORDERS_SUBMIT_OWN) ||
    !resolveRetailerCartOwner(session.user)
  ) {
    return checkoutFailure(
      "FORBIDDEN",
      "This account cannot place orders for a retailer.",
    );
  }

  const owner = resolveRetailerCartOwner(session.user)!;
  const lines = await readCartCookieLines(owner);
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const reviewToken = String(formData.get("review") ?? "");
  const review = parseCheckoutReview(reviewToken);

  const result = await submitOrder({
    actor: {
      userId: session.user.id,
      role: session.user.role,
      retailerId: session.user.retailerId,
    },
    lines,
    idempotencyKey,
    review,
  });

  if (!result.ok) {
    if (result.code === "CART_CHANGED" || result.code === "INSUFFICIENT_STOCK") {
      revalidatePath("/cart");
    }

    return checkoutFailure(result.code ?? "UNKNOWN", result.message ?? "The order could not be placed.", {
      changes: result.changes,
      shortages: result.shortages,
    });
  }

  // The cart is cleared only after the order transaction has committed. A
  // failed or re-reviewed submission therefore leaves the cart intact.
  await clearCartCookie();
  revalidatePath("/", "layout");
  redirect(`/orders/${result.orderId}?placed=1`);
}

/**
 * Applies one lifecycle action. Role and ownership are checked again inside
 * `transitionOrder` while the order row is locked, so a forged form post cannot
 * approve a retailer order or cancel another retailer's order.
 */
export async function updateOrderStatusAction(
  _previousState: OrderTransitionActionState,
  formData: FormData,
): Promise<OrderTransitionActionState> {
  const session = await getSession();

  if (!session) {
    return transitionFailure(
      "UNAUTHORIZED",
      "Your session has expired. Sign in again.",
    );
  }

  if (
    !hasAnyPermission(session.user.role, [
      PERMISSIONS.ORDERS_MANAGE,
      PERMISSIONS.ORDERS_CANCEL_OWN,
    ])
  ) {
    return transitionFailure(
      "FORBIDDEN",
      "Your role cannot update orders.",
    );
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const actionValue = String(formData.get("action") ?? "").trim();
  const reason = String(formData.get("reason") ?? "");

  if (!isOrderAction(actionValue)) {
    return transitionFailure(
      "INVALID_TRANSITION",
      "That order action is not recognized.",
    );
  }

  const result = await transitionOrder({
    actor: {
      userId: session.user.id,
      role: session.user.role,
      retailerId: session.user.retailerId,
    },
    orderId,
    action: actionValue,
    reason,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/dashboard");

  if (!result.ok) {
    return transitionFailure(
      result.code ?? "UNKNOWN",
      result.message ?? "The order could not be updated.",
      { shortages: result.shortages },
    );
  }

  return {
    status: "success",
    code: result.code,
    message:
      result.code === "ALREADY_APPLIED"
        ? "This action was already applied. No further changes were made."
        : `Order ${result.orderNumber} is now ${result.status.toLowerCase().replaceAll("_", " ")}.`,
  };
}
