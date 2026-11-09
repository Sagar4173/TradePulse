"use client";

import { AlertTriangle, LoaderCircle, ShieldCheck } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  INITIAL_CHECKOUT_ACTION_STATE,
  type CheckoutShortage,
} from "@/lib/orders/action-types";
import { submitCheckoutAction } from "@/lib/orders/actions";
import { CHECKOUT_CHANGE_LABELS } from "@/lib/orders/presentation";

function ShortageList({ shortages }: { shortages: CheckoutShortage[] }) {
  return (
    <ul className="space-y-1">
      {shortages.map((shortage) => (
        <li key={shortage.sku}>
          {shortage.sku}: requested {shortage.requestedCases}, available{" "}
          {shortage.availableCases}
        </li>
      ))}
    </ul>
  );
}

export function CheckoutForm({
  reviewToken,
  idempotencyKey,
  disabled,
  disabledReason,
}: {
  reviewToken: string;
  idempotencyKey: string;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitCheckoutAction,
    INITIAL_CHECKOUT_ACTION_STATE,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Place order</CardTitle>
        <CardDescription>
          The server recalculates price, scheme, stock, tax, and credit before an
          order is created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="review" value={reviewToken} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Button
            type="submit"
            size="lg"
            className="min-h-11 w-full"
            disabled={pending || disabled}
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <ShieldCheck aria-hidden="true" data-icon="inline-start" />
            )}
            {pending ? "Placing order…" : "Place order"}
          </Button>
        </form>

        {disabled && disabledReason ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {disabledReason}
          </p>
        ) : null}

        <p className="text-xs leading-5 text-muted-foreground">
          Submitting twice with the same review returns the same order instead
          of creating a duplicate. Your cart is cleared only after the order is
          accepted.
        </p>

        {state.status === "error" ? (
          <div
            role="alert"
            aria-live="polite"
            className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{state.message ?? "The order could not be placed."}</span>
            </p>

            {state.changes && state.changes.length > 0 ? (
              <ul className="space-y-1 text-xs leading-5">
                {state.changes.map((change) => (
                  <li key={change.sku}>
                    <span className="font-medium">{change.sku}</span>:{" "}
                    {change.reasons
                      .map((reason) => CHECKOUT_CHANGE_LABELS[reason] ?? reason)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            ) : null}

            {state.shortages && state.shortages.length > 0 ? (
              <div className="text-xs leading-5">
                <p className="font-medium">Current availability</p>
                <ShortageList shortages={state.shortages} />
              </div>
            ) : null}

            {state.code === "CART_CHANGED" ||
            state.code === "INSUFFICIENT_STOCK" ? (
              <a href="/cart" className="inline-block text-xs font-medium underline">
                Review the updated cart
              </a>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
