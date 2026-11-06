import { ROLES, USER_STATUSES } from "./types";
import type { Role, UserStatus } from "./types";

export const PUBLIC_REGISTRATION_ROLE: Role = "RETAILER";

export type AccessAssignment = {
  role: Role;
  status: UserStatus;
  retailerId: string | null;
  assignedRetailerIds: string[];
};

export type AccessAssignmentResult =
  | { ok: true; value: AccessAssignment }
  | { ok: false; error: string };

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
}

/**
 * Validates an administrator-provisioned access change. Public registration
 * never calls this with an elevated role: it always uses PUBLIC_REGISTRATION_ROLE.
 */
export function validateAccessAssignment(input: {
  role: string;
  status: string;
  retailerId: string | null;
  assignedRetailerIds: string[];
}): AccessAssignmentResult {
  if (!isRole(input.role)) {
    return { ok: false, error: "Select a valid role." };
  }

  if (!isUserStatus(input.status)) {
    return { ok: false, error: "Select a valid account status." };
  }

  const retailerId = input.retailerId?.trim() || null;

  if (input.role === "RETAILER" && !retailerId) {
    return {
      ok: false,
      error: "Retailer users must be linked to a retailer record.",
    };
  }

  const assignedRetailerIds =
    input.role === "SALESMAN"
      ? [...new Set(input.assignedRetailerIds.map((id) => id.trim()))]
          .filter(Boolean)
          .sort()
      : [];

  return {
    ok: true,
    value: {
      role: input.role,
      status: input.status,
      retailerId: input.role === "RETAILER" ? retailerId : null,
      assignedRetailerIds,
    },
  };
}

export function isSelfAccessChange(
  actorId: string,
  targetUserId: string,
): boolean {
  return actorId === targetUserId;
}

/**
 * A pre-existing session must not inherit a role or status change. Revoking on
 * any such change also forces a disabled account to re-authenticate if enabled
 * again later.
 */
export function shouldRevokeSessionsOnAccessChange(input: {
  currentRole: Role;
  currentStatus: UserStatus;
  nextRole: Role;
  nextStatus: UserStatus;
}): boolean {
  return (
    input.currentRole !== input.nextRole ||
    input.currentStatus !== input.nextStatus
  );
}

export function isLastActiveAdminChange(input: {
  currentRole: Role;
  currentStatus: UserStatus;
  nextRole: Role;
  nextStatus: UserStatus;
  otherActiveAdminCount: number;
}): boolean {
  const isCurrentlyActiveAdmin =
    input.currentRole === "ADMIN" && input.currentStatus === "ACTIVE";
  const remainsActiveAdmin =
    input.nextRole === "ADMIN" && input.nextStatus === "ACTIVE";

  return (
    isCurrentlyActiveAdmin &&
    !remainsActiveAdmin &&
    input.otherActiveAdminCount === 0
  );
}
