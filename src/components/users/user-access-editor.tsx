"use client";

import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/auth/navigation";
import { ROLES, USER_STATUSES } from "@/lib/auth/types";
import { formatPhoneForDisplay } from "@/lib/auth/phone";
import { titleCase } from "@/lib/format";
import { INITIAL_USER_ACCESS_STATE } from "@/lib/users/action-types";
import { updateUserAccessAction } from "@/lib/users/actions";

export type UserAccessRow = {
  id: string;
  name: string;
  phone: string;
  role: (typeof ROLES)[number];
  status: (typeof USER_STATUSES)[number];
  retailerId: string | null;
  retailerShopName: string | null;
  assignedRetailerIds: string[];
  createdAt: string;
};

export type RetailerOption = {
  id: string;
  shopName: string;
  ownerName: string;
};

function AccessForm({
  user,
  retailers,
}: {
  user: UserAccessRow;
  retailers: RetailerOption[];
}) {
  const [state, action, pending] = useActionState(
    updateUserAccessAction,
    INITIAL_USER_ACCESS_STATE,
  );
  const [role, setRole] = useState<UserAccessRow["role"]>(user.role);
  const roleFieldId = `role-${user.id}`;
  const statusFieldId = `status-${user.id}`;
  const retailerFieldId = `retailer-${user.id}`;
  const messageId = `access-message-${user.id}`;

  return (
    <form action={action} className="space-y-4" aria-describedby={messageId}>
      <input type="hidden" name="userId" value={user.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={roleFieldId}>Role</Label>
          <Select
            id={roleFieldId}
            name="role"
            value={role}
            onChange={(event) =>
              setRole(event.target.value as UserAccessRow["role"])
            }
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={statusFieldId}>Account status</Label>
          <Select
            id={statusFieldId}
            name="status"
            defaultValue={user.status}
          >
            {USER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {role === "RETAILER" ? (
        <div className="space-y-2">
          <Label htmlFor={retailerFieldId}>Linked retailer</Label>
          <Select
            id={retailerFieldId}
            name="retailerId"
            defaultValue={user.retailerId ?? ""}
            required
          >
            <option value="">Select a retailer record</option>
            {retailers.map((retailer) => (
              <option key={retailer.id} value={retailer.id}>
                {retailer.shopName} — {retailer.ownerName}
              </option>
            ))}
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            Retailer accounts must be linked to exactly one retailer record.
          </p>
        </div>
      ) : null}

      {role === "SALESMAN" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Assigned retailers</legend>
          {retailers.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              No retailer records exist yet. A salesman can be saved without
              assignments and updated later.
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-1">
              {retailers.map((retailer) => (
                <label
                  key={retailer.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    name="assignedRetailerIds"
                    value={retailer.id}
                    defaultChecked={user.assignedRetailerIds.includes(
                      retailer.id,
                    )}
                    className="size-4 shrink-0 rounded border-input accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {retailer.shopName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {retailer.ownerName}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Salesmen can access only the orders and retailer records in this
            list.
          </p>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          id={messageId}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : state.status === "success"
                ? "text-sm text-primary"
                : "text-xs leading-5 text-muted-foreground"
          }
        >
          {state.status === "idle"
            ? "Changes are audited and take effect on the user's next request."
            : state.message}
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="h-11 sm:w-auto"
        >
          {pending ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
              Saving…
            </>
          ) : (
            <>
              <Save aria-hidden="true" data-icon="inline-start" />
              Save access
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export function UserAccessEditor({
  users,
  retailers,
  currentUserId,
}: {
  users: UserAccessRow[];
  retailers: RetailerOption[];
  currentUserId: string;
}) {
  return (
    <ul className="divide-y divide-border">
      {users.map((user) => {
        const isSelf = user.id === currentUserId;

        return (
          <li key={user.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{user.name}</p>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {ROLE_LABELS[user.role]}
                  </span>
                  <span
                    className={
                      user.status === "ACTIVE"
                        ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                        : "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    }
                  >
                    {titleCase(user.status)}
                  </span>
                  {isSelf ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      <ShieldCheck aria-hidden="true" className="size-3" />
                      You
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPhoneForDisplay(user.phone)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user.retailerShopName
                    ? `Linked to ${user.retailerShopName}`
                    : user.assignedRetailerIds.length > 0
                      ? `${user.assignedRetailerIds.length} assigned retailer${
                          user.assignedRetailerIds.length === 1 ? "" : "s"
                        }`
                      : "No retailer scope"}
                </p>
              </div>
              <div className="text-xs text-muted-foreground sm:text-right">
                <p className="font-mono">{user.id}</p>
                <p className="mt-1">
                  Created {new Date(user.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>

            {isSelf ? (
              <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                You cannot change your own role or account status. Another active
                administrator must make changes to your access.
              </p>
            ) : (
              <details className="group mt-3">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  Manage access
                </summary>
                <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4">
                  <AccessForm user={user} retailers={retailers} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
