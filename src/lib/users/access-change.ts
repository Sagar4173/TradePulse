import type { AccessAssignment } from "@/lib/auth/user-access";

export type PendingRetailerLinkRequestRef = {
  id: string;
  retailerId: string;
};

export type PendingRetailerLinkResolution = {
  requestId: string;
  status: "APPROVED" | "REJECTED";
};

export type UserAccessAuditMetadata = {
  role: string;
  status: string;
  previousRetailerId: string | null;
  retailerId: string | null;
  assignedRetailerCount: number;
  revokedSessions: number;
};

/**
 * Builds the audit payload for a direct user-access change. The previous and
 * new retailer IDs are both recorded so an access change cannot erase the
 * history of which retailer a user was linked to before the update.
 */
export function buildUserAccessAuditMetadata(input: {
  previousRetailerId: string | null;
  assignment: AccessAssignment;
  revokedSessions: number;
}): UserAccessAuditMetadata {
  return {
    role: input.assignment.role,
    status: input.assignment.status,
    previousRetailerId: input.previousRetailerId,
    retailerId: input.assignment.retailerId,
    assignedRetailerCount: input.assignment.assignedRetailerIds.length,
    revokedSessions: input.revokedSessions,
  };
}

/**
 * Direct administrator linking bypasses the link-request review UI. Resolve
 * the user's pending requests in the same transaction so the review queue
 * cannot keep stale entries:
 *
 *   - the pending request for the newly linked retailer is approved;
 *   - every other pending request is rejected, because the administrator chose
 *     a different retailer;
 *   - when the assignment does not link a retailer (`null`), pending requests
 *     are left untouched. Removing retailer scope is not a link review.
 *
 * The caller must re-check each request's PENDING status when applying the
 * decision so a concurrent review cannot be overwritten.
 */
export function resolvePendingRetailerLinkRequests(input: {
  pendingRequests: readonly PendingRetailerLinkRequestRef[];
  linkedRetailerId: string | null;
}): PendingRetailerLinkResolution[] {
  if (input.linkedRetailerId === null) {
    return [];
  }

  return input.pendingRequests.map((request) => ({
    requestId: request.id,
    status:
      request.retailerId === input.linkedRetailerId ? "APPROVED" : "REJECTED",
  }));
}
