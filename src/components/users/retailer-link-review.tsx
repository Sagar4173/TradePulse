"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
import { INITIAL_REVIEW_RETAILER_LINK_STATE } from "@/lib/users/action-types";
import { reviewRetailerLinkAction } from "@/lib/users/actions";

export type PendingRetailerLinkRow = {
  id: string;
  userName: string;
  userPhone: string;
  retailerShopName: string;
  retailerOwnerName: string;
  createdAt: string;
};

function LinkReviewRow({ request }: { request: PendingRetailerLinkRow }) {
  const [state, action, pending] = useActionState(
    reviewRetailerLinkAction,
    INITIAL_REVIEW_RETAILER_LINK_STATE,
  );
  const messageId = `link-review-message-${request.id}`;

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">
            {request.userName}{" "}
            <span className="font-normal text-muted-foreground">
              ({formatPhoneForDisplay(request.userPhone)})
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Verified phone matches{" "}
            <span className="font-medium text-foreground">
              {request.retailerShopName}
            </span>{" "}
            — {request.retailerOwnerName}.
          </p>
          <p className="text-xs text-muted-foreground">
            Requested{" "}
            {new Date(request.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            . The account has no retailer access until you approve.
          </p>
        </div>

        <form
          action={action}
          className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col"
          aria-describedby={messageId}
        >
          <input type="hidden" name="requestId" value={request.id} />
          <Button
            type="submit"
            name="decision"
            value="APPROVE"
            size="lg"
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Check aria-hidden="true" data-icon="inline-start" />
            )}
            Approve link
          </Button>
          <Button
            type="submit"
            name="decision"
            value="REJECT"
            variant="destructive"
            size="lg"
            disabled={pending}
          >
            <X aria-hidden="true" data-icon="inline-start" />
            Reject
          </Button>
        </form>
      </div>

      <p
        id={messageId}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        className={
          state.status === "error"
            ? "mt-2 text-sm text-destructive"
            : state.status === "success"
              ? "mt-2 text-sm text-primary"
              : "mt-2 text-xs leading-5 text-muted-foreground"
        }
      >
        {state.status === "idle"
          ? "Approval links this account to the retailer stored on the request."
          : state.message}
      </p>
    </li>
  );
}

export function RetailerLinkReview({
  requests,
}: {
  requests: PendingRetailerLinkRow[];
}) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pending retailer link requests. Verified phones that match an
        existing retailer appear here for review instead of being linked
        automatically.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {requests.map((request) => (
        <LinkReviewRow key={request.id} request={request} />
      ))}
    </ul>
  );
}
