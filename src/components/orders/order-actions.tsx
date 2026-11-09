"use client";

import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { INITIAL_ORDER_ACTION_STATE } from "@/lib/orders/action-types";
import { updateOrderStatusAction } from "@/lib/orders/actions";
import {
  ORDER_ACTION_HELP,
  ORDER_ACTION_LABELS,
} from "@/lib/orders/presentation";
import type { OrderAction } from "@/lib/orders/transitions";

export function OrderActions({
  orderId,
  orderNumber,
  actions,
}: {
  orderId: string;
  orderNumber: string;
  actions: OrderAction[];
}) {
  const [state, formAction, pending] = useActionState(
    updateOrderStatusAction,
    INITIAL_ORDER_ACTION_STATE,
  );

  if (actions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order actions</CardTitle>
        <CardDescription>
          Actions apply to order {orderNumber}. Rejection and cancellation
          require a reason and are recorded in the audit trail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="orderId" value={orderId} />
          <div className="space-y-1.5">
            <Label htmlFor="order-action-reason">
              Reason (required to reject or cancel)
            </Label>
            <textarea
              id="order-action-reason"
              name="reason"
              rows={3}
              maxLength={500}
              className="flex min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Explain the decision for the audit record."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const destructive =
                action === "REJECT" || action === "CANCEL";

              return (
                <Button
                  key={action}
                  type="submit"
                  name="action"
                  value={action}
                  variant={
                    destructive
                      ? "destructive"
                      : action === "APPROVE"
                        ? "default"
                        : "outline"
                  }
                  className="min-h-11"
                  disabled={pending}
                  title={ORDER_ACTION_HELP[action]}
                >
                  {pending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  {ORDER_ACTION_LABELS[action]}
                </Button>
              );
            })}
          </div>
        </form>

        {state.status !== "idle" && state.message ? (
          <div
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              state.status === "error"
                ? "space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                : "space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary"
            }
          >
            <p className="flex items-start gap-2 font-medium">
              {state.status === "error" ? (
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
              ) : null}
              <span>{state.message}</span>
            </p>

            {state.shortages && state.shortages.length > 0 ? (
              <ul className="space-y-1 text-xs leading-5">
                {state.shortages.map((shortage) => (
                  <li key={shortage.sku}>
                    {shortage.sku}: requested {shortage.requestedCases},
                    available {shortage.availableCases}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
