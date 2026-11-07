"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/action-types";
import { clearCartAction } from "@/lib/cart/actions";
import { cartCopy, cartActionMessage } from "@/lib/i18n/cart-copy";

export function ClearCartButton() {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    clearCartAction,
    INITIAL_CART_ACTION_STATE,
  );
  const message = cartActionMessage(state);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        {cartCopy.clearCart}
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        variant="destructive"
        className="min-h-11"
        disabled={pending}
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            data-icon="inline-start"
            className="animate-spin"
          />
        ) : (
          <Trash2 aria-hidden="true" data-icon="inline-start" />
        )}
        {cartCopy.confirmClear}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        {cartCopy.cancel}
      </Button>
      <p
        aria-live="polite"
        className={
          message ? "text-xs font-medium text-destructive" : "sr-only"
        }
      >
        {message}
      </p>
    </form>
  );
}
