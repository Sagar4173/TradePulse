"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/action-types";
import {
  removeCartLineAction,
  updateCartLineAction,
} from "@/lib/cart/actions";
import { cartCopy, cartActionMessage } from "@/lib/i18n/cart-copy";

export function CartLineControls({
  sku,
  name,
  quantity,
  maxQuantity,
  canUpdate,
}: {
  sku: string;
  name: string;
  quantity: number;
  maxQuantity: number;
  canUpdate: boolean;
}) {
  const [value, setValue] = useState(quantity);
  const [updateState, updateAction, updatePending] = useActionState(
    updateCartLineAction,
    INITIAL_CART_ACTION_STATE,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeCartLineAction,
    INITIAL_CART_ACTION_STATE,
  );
  const message =
    cartActionMessage(updateState) ?? cartActionMessage(removeState);
  const hasError =
    updateState.status === "error" || removeState.status === "error";
  const upperBound = Math.max(1, Math.min(maxQuantity, 999));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canUpdate ? (
          <form action={updateAction} className="flex items-center gap-2">
            <input type="hidden" name="sku" value={sku} />
            <label htmlFor={`cart-quantity-${sku}`} className="sr-only">
              {cartCopy.line.quantityLabel(name)}
            </label>
            <Input
              id={`cart-quantity-${sku}`}
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={upperBound}
              value={value}
              onChange={(event) => {
                const next = Number(event.target.value);
                setValue(
                  Number.isFinite(next)
                    ? Math.max(1, Math.min(upperBound, Math.round(next)))
                    : 1,
                );
              }}
              className="h-11 w-24 text-center"
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={updatePending}
            >
              {updatePending ? (
                <LoaderCircle
                  aria-hidden="true"
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              {cartCopy.line.update}
            </Button>
          </form>
        ) : null}

        <form action={removeAction}>
          <input type="hidden" name="sku" value={sku} />
          <Button
            type="submit"
            variant="destructive"
            className="min-h-11"
            aria-label={cartCopy.line.removeLabel(name)}
            disabled={removePending}
          >
            {removePending ? (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <Trash2 aria-hidden="true" data-icon="inline-start" />
            )}
            {cartCopy.line.remove}
          </Button>
        </form>
      </div>

      <p
        aria-live="polite"
        className={
          message
            ? hasError
              ? "text-xs font-medium text-destructive"
              : "text-xs font-medium text-primary"
            : "sr-only"
        }
      >
        {message}
      </p>
    </div>
  );
}
