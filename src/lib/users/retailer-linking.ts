export const RETAILER_LINK_DECISIONS = ["APPROVE", "REJECT"] as const;

export type RetailerLinkDecision = (typeof RETAILER_LINK_DECISIONS)[number];

export type RetailerLinkReviewActor = {
  id: string;
  role: string;
  status: string;
};

export type RetailerLinkReviewRequest = {
  id: string;
  status: string;
  userId: string;
  retailerId: string;
  user: {
    id: string;
    role: string;
    status: string;
    retailerId: string | null;
  };
  retailer: { id: string } | null;
};

export type RetailerLinkAuditInput = {
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

/**
 * Persistence boundary for retailer link reviews. The caller must bind this
 * store to a single serializable transaction so the actor re-check, request
 * state, user link, and audit event cannot race or be split apart.
 */
export type RetailerLinkReviewStore = {
  findActor(actorId: string): Promise<RetailerLinkReviewActor | null>;
  findRequest(
    requestId: string,
  ): Promise<RetailerLinkReviewRequest | null>;
  approve(input: {
    requestId: string;
    userId: string;
    retailerId: string;
    reviewedById: string;
    reviewedAt: Date;
  }): Promise<boolean>;
  reject(input: {
    requestId: string;
    reviewedById: string;
    reviewedAt: Date;
  }): Promise<boolean>;
  recordAuditEvent(input: RetailerLinkAuditInput): Promise<void>;
};

export type ReviewRetailerLinkResult =
  | { ok: true; decision: RetailerLinkDecision }
  | { ok: false; error: string };

/**
 * An administrator explicitly approves or rejects the retailer recorded on the
 * pending request. The caller cannot supply a different retailer ID, so a form
 * field cannot redirect the link to an arbitrary retailer.
 */
export async function reviewRetailerLinkRequest(
  store: RetailerLinkReviewStore,
  input: {
    actorId: string;
    requestId: string;
    decision: RetailerLinkDecision;
    now: Date;
  },
): Promise<ReviewRetailerLinkResult> {
  const actor = await store.findActor(input.actorId);

  if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE") {
    return {
      ok: false,
      error: "You do not have permission to review retailer link requests.",
    };
  }

  const request = await store.findRequest(input.requestId);

  if (!request) {
    return {
      ok: false,
      error: "That retailer link request no longer exists.",
    };
  }

  if (request.status !== "PENDING") {
    return {
      ok: false,
      error: "That retailer link request has already been reviewed.",
    };
  }

  if (input.decision === "REJECT") {
    const rejected = await store.reject({
      requestId: request.id,
      reviewedById: actor.id,
      reviewedAt: input.now,
    });

    if (!rejected) {
      return {
        ok: false,
        error: "That retailer link request has already been reviewed.",
      };
    }

    await store.recordAuditEvent({
      eventType: "RETAILER_LINK_REJECTED",
      entityType: "RetailerLinkRequest",
      entityId: request.id,
      actorId: actor.id,
      metadata: {
        userId: request.userId,
        retailerId: request.retailerId,
      },
      createdAt: input.now,
    });

    return { ok: true, decision: "REJECT" };
  }

  if (!request.retailer) {
    return {
      ok: false,
      error: "The matched retailer no longer exists.",
    };
  }

  if (request.retailer.id !== request.retailerId) {
    return {
      ok: false,
      error: "The retailer link request is inconsistent.",
    };
  }

  if (request.user.role !== "RETAILER") {
    return {
      ok: false,
      error: "Only retailer accounts can be linked to a retailer.",
    };
  }

  if (request.user.retailerId !== null) {
    return {
      ok: false,
      error: "That user is already linked to a retailer.",
    };
  }

  const approved = await store.approve({
    requestId: request.id,
    userId: request.userId,
    retailerId: request.retailerId,
    reviewedById: actor.id,
    reviewedAt: input.now,
  });

  if (!approved) {
    return {
      ok: false,
      error: "That user or retailer link request changed. Refresh and try again.",
    };
  }

  await store.recordAuditEvent({
    eventType: "RETAILER_LINK_APPROVED",
    entityType: "RetailerLinkRequest",
    entityId: request.id,
    actorId: actor.id,
    metadata: {
      userId: request.userId,
      retailerId: request.retailerId,
    },
    createdAt: input.now,
  });

  return { ok: true, decision: "APPROVE" };
}
