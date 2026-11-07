"use client";

import { Check, LoaderCircle, Minus, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { INITIAL_CART_ACTION_STATE } from "@/lib/cart/action-types";
import { addToCartAction } from "@/lib/cart/actions";
import { MAX_LINE_QUANTITY } from "@/lib/cart/cookie";
import { catalogueCopy } from "@/lib/i18n/catalogue-copy";
import {
  addedToCartMessage,
  cartActionMessage,
} from "@/lib/i18n/cart-copy";

export function AddToCart({
  sku,
  name,
  maxQuantity,
  disabledReason,
}: {
  sku: string;
  name: string;
  maxQuantity: number;
  disabledReason: string | null;
}) {
  const [quantity, setQuantity] = useState(1);
  const [state, action, pending] = useActionState(
    addToCartAction,
    INITIAL_CART_ACTION_STATE,
  );
  const copy = catalogueCopy.card;

  if (disabledReason) {
    return (
      <div className="space-y-2">
        <Button type="button" disabled className="min-h-11 w-full">
          <ShoppingCart aria-hidden="true" data-icon="inline-start" />
          {copy.addToCart}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          {disabledReason}
        </p>
      </div>
    );
  }

  const message =
    state.status === "success"
      ? addedToCartMessage(state.quantity ?? quantity)
      : cartActionMessage(state);
  const messageIsSuccess = state.status === "success";
  const upperBound = Math.max(1, Math.min(maxQuantity, MAX_LINE_QUANTITY));

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="sku" value={sku} />
      <div className="flex items-stretch gap-2">
        <div className="flex items-center rounded-lg border border-input bg-background">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="h-11 w-11 rounded-r-none"
            aria-label={`${copy.decrease} — ${name}`}
            disabled={quantity <= 1}
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}
          >
            <Minus aria-hidden="true" />
          </Button>
          <label className="sr-only" htmlFor={`quantity-${sku}`}>
            {copy.quantityLabel(name)}
          </label>
          <input
            id={`quantity-${sku}`}
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={upperBound}
            value={quantity}
            onChange={(event) => {
              const next = Number(event.target.value);
              setQuantity(
                Number.isFinite(next)
                  ? Math.max(1, Math.min(upperBound, Math.round(next)))
                  : 1,
              );
            }}
            className="h-11 w-14 border-x border-input bg-transparent text-center text-base outline-none focus-visible:bg-muted/50"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="h-11 w-11 rounded-l-none"
            aria-label={`${copy.increase} — ${name}`}
            disabled={quantity >= upperBound}
            onClick={() =>
              setQuantity((current) => Math.min(upperBound, current + 1))
            }
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <Button
          type="submit"
          className="min-h-11 flex-1"
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin"
            />
          ) : (
            <ShoppingCart aria-hidden="true" data-icon="inline-start" />
          )}
          {copy.addToCart}
        </Button>
      </div>
      <p
        aria-live="polite"
        className={
          message
            ? messageIsSuccess
              ? "flex flex-wrap items-center gap-1.5 text-xs font-medium text-primary"
              : "text-xs font-medium text-destructive"
            : "sr-only"
        }
      >
        {messageIsSuccess ? (
          <Check aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        {message}
        {messageIsSuccess ? (
          <Link
            href="/cart"
            className="underline underline-offset-4 hover:text-primary/80"
          >
            {copy.viewCart}
          </Link>
        ) : null}
      </p>
    </form>
  );
}
