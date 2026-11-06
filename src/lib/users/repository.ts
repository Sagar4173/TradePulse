import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { RetailerLinkRequestStatus, UserRole, UserStatus } from "@/generated/prisma/enums";
import { getPrismaClient } from "@/lib/db";
import type { AccessAssignment } from "@/lib/auth/user-access";
import {
  isLastActiveAdminChange,
  shouldRevokeSessionsOnAccessChange,
} from "@/lib/auth/user-access";
import {
  buildUserAccessAuditMetadata,
  resolvePendingRetailerLinkRequests,
} from "./access-change";
import {
  reviewRetailerLinkRequest,
  type RetailerLinkDecision,
  type ReviewRetailerLinkResult,
  type RetailerLinkReviewStore,
} from "./retailer-linking";

export type AdminUserRow = {
  id: string;
  name: string;
  phone: string;
  role: AccessAssignment["role"];
  status: AccessAssignment["status"];
  retailerId: string | null;
  retailerShopName: string | null;
  assignedRetailerIds: string[];
  createdAt: Date;
};

export type RetailerOption = {
  id: string;
  shopName: string;
  ownerName: string;
};

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      status: true,
      retailerId: true,
      createdAt: true,
      retailer: { select: { shopName: true } },
      assignedRetailers: { select: { retailerId: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as AccessAssignment["role"],
    status: user.status as AccessAssignment["status"],
    retailerId: user.retailerId,
    retailerShopName: user.retailer?.shopName ?? null,
    assignedRetailerIds: user.assignedRetailers.map(
      (assignment) => assignment.retailerId,
    ),
    createdAt: user.createdAt,
  }));
}

export async function listRetailerOptions(): Promise<RetailerOption[]> {
  const prisma = getPrismaClient();
  return prisma.retailer.findMany({
    select: { id: true, shopName: true, ownerName: true },
    orderBy: { shopName: "asc" },
  });
}

export async function updateUserAccess(input: {
  actorId: string;
  targetUserId: string;
  assignment: AccessAssignment;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = getPrismaClient();

  // Serializable isolation prevents two concurrent demotions from both
  // observing another active admin and leaving the system without one.
  return prisma.$transaction(
    async (tx) => {
      // Re-check the actor inside the transaction. The request's session may be
      // stale if an administrator was demoted or disabled after it was read.
      const actor = await tx.user.findUnique({
        where: { id: input.actorId },
        select: { role: true, status: true },
      });

      if (actor?.role !== UserRole.ADMIN || actor.status !== UserStatus.ACTIVE) {
        return {
          ok: false as const,
          error: "You do not have permission to manage users.",
        };
      }

      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, role: true, status: true, retailerId: true },
      });

      if (!target) {
        return { ok: false as const, error: "That user no longer exists." };
      }

      if (
        input.assignment.retailerId &&
        !(await tx.retailer.findUnique({
          where: { id: input.assignment.retailerId },
          select: { id: true },
        }))
      ) {
        return {
          ok: false as const,
          error: "The selected retailer no longer exists.",
        };
      }

      if (input.assignment.assignedRetailerIds.length > 0) {
        const existingRetailers = await tx.retailer.findMany({
          where: { id: { in: input.assignment.assignedRetailerIds } },
          select: { id: true },
        });

        if (
          existingRetailers.length !==
          input.assignment.assignedRetailerIds.length
        ) {
          return {
            ok: false as const,
            error: "One or more selected retailers no longer exist.",
          };
        }
      }

      const otherActiveAdminCount = await tx.user.count({
        where: {
          id: { not: target.id },
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });

      if (
        isLastActiveAdminChange({
          currentRole: target.role as AccessAssignment["role"],
          currentStatus: target.status as AccessAssignment["status"],
          nextRole: input.assignment.role,
          nextStatus: input.assignment.status,
          otherActiveAdminCount,
        })
      ) {
        return {
          ok: false as const,
          error: "At least one active administrator must remain.",
        };
      }

      const assignmentUpdate =
        input.assignment.role === "SALESMAN"
          ? {
              deleteMany: {},
              create: input.assignment.assignedRetailerIds.map((retailerId) => ({
                retailerId,
                assignedById: input.actorId,
              })),
            }
          : { deleteMany: {} };

      const now = new Date();
      const accessChanged = shouldRevokeSessionsOnAccessChange({
        currentRole: target.role as AccessAssignment["role"],
        currentStatus: target.status as AccessAssignment["status"],
        nextRole: input.assignment.role,
        nextStatus: input.assignment.status,
      });

      await tx.user.update({
        where: { id: target.id },
        data: {
          role: input.assignment.role,
          status: input.assignment.status,
          retailerId: input.assignment.retailerId,
          assignedRetailers: assignmentUpdate,
        },
      });

      // A direct administrator link is also a review decision. Resolve pending
      // requests in this transaction so the queue does not retain stale
      // entries. The PENDING predicate re-check prevents overwriting a
      // concurrent review.
      const pendingLinkRequests = await tx.retailerLinkRequest.findMany({
        where: {
          userId: target.id,
          status: RetailerLinkRequestStatus.PENDING,
        },
        select: { id: true, retailerId: true },
      });
      const linkResolutions = resolvePendingRetailerLinkRequests({
        pendingRequests: pendingLinkRequests,
        linkedRetailerId: input.assignment.retailerId,
      });

      for (const resolution of linkResolutions) {
        await tx.retailerLinkRequest.updateMany({
          where: {
            id: resolution.requestId,
            status: RetailerLinkRequestStatus.PENDING,
          },
          data: {
            status:
              resolution.status === "APPROVED"
                ? RetailerLinkRequestStatus.APPROVED
                : RetailerLinkRequestStatus.REJECTED,
            reviewedAt: now,
            reviewedById: input.actorId,
          },
        });
      }

      // A session issued before a role or status change must not inherit the
      // new access. Promotion, demotion, disable, and re-enable all force a
      // fresh sign-in.
      const revokedSessions = accessChanged
        ? (
            await tx.session.updateMany({
              where: { userId: target.id, revokedAt: null },
              data: { revokedAt: now },
            })
          ).count
        : 0;

      await tx.auditEvent.create({
        data: {
          eventType: "USER_ACCESS_UPDATED",
          entityType: "User",
          entityId: target.id,
          actorId: input.actorId,
          metadata: buildUserAccessAuditMetadata({
            previousRetailerId: target.retailerId,
            assignment: input.assignment,
            revokedSessions,
          }),
        },
      });

      return { ok: true as const };
    },
    { isolationLevel: "Serializable" },
  );
}

export type PendingRetailerLinkRequestRow = {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  retailerId: string;
  retailerShopName: string;
  retailerOwnerName: string;
  createdAt: Date;
};

/**
 * Pending retailer link requests awaiting explicit administrator review. These
 * accounts exist but have no retailer scope until a request is approved.
 */
export async function listPendingRetailerLinkRequests(): Promise<
  PendingRetailerLinkRequestRow[]
> {
  const prisma = getPrismaClient();
  const requests = await prisma.retailerLinkRequest.findMany({
    where: { status: RetailerLinkRequestStatus.PENDING },
    select: {
      id: true,
      userId: true,
      retailerId: true,
      createdAt: true,
      user: { select: { name: true, phone: true } },
      retailer: { select: { shopName: true, ownerName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return requests.map((request) => ({
    id: request.id,
    userId: request.userId,
    userName: request.user.name,
    userPhone: request.user.phone,
    retailerId: request.retailerId,
    retailerShopName: request.retailer.shopName,
    retailerOwnerName: request.retailer.ownerName,
    createdAt: request.createdAt,
  }));
}

/**
 * Explicit administrator review of a retailer link request.
 *
 * The decision runs in one serializable transaction. The administrator is
 * re-read inside it, so a demoted or disabled admin cannot approve a link with
 * a stale session. The retailer is taken from the stored request, never from
 * the submitted form, and the account can only move from unlinked to linked.
 */
export async function reviewRetailerLink(input: {
  actorId: string;
  requestId: string;
  decision: RetailerLinkDecision;
}): Promise<ReviewRetailerLinkResult> {
  const prisma = getPrismaClient();

  return prisma.$transaction(
    async (tx) => {
      const store: RetailerLinkReviewStore = {
        async findActor(actorId) {
          return tx.user.findUnique({
            where: { id: actorId },
            select: { id: true, role: true, status: true },
          });
        },

        async findRequest(requestId) {
          return tx.retailerLinkRequest.findUnique({
            where: { id: requestId },
            select: {
              id: true,
              status: true,
              userId: true,
              retailerId: true,
              user: {
                select: {
                  id: true,
                  role: true,
                  status: true,
                  retailerId: true,
                },
              },
              retailer: { select: { id: true } },
            },
          });
        },

        async approve(approval) {
          const linked = await tx.user.updateMany({
            where: {
              id: approval.userId,
              role: UserRole.RETAILER,
              status: UserStatus.ACTIVE,
              retailerId: null,
            },
            data: { retailerId: approval.retailerId },
          });

          if (linked.count !== 1) {
            return false;
          }

          const reviewed = await tx.retailerLinkRequest.updateMany({
            where: {
              id: approval.requestId,
              status: RetailerLinkRequestStatus.PENDING,
            },
            data: {
              status: RetailerLinkRequestStatus.APPROVED,
              reviewedAt: approval.reviewedAt,
              reviewedById: approval.reviewedById,
            },
          });

          if (reviewed.count !== 1) {
            // Roll back the user link rather than leaving an approved-looking
            // account without a matching request decision.
            throw new Error("Retailer link request changed during review.");
          }

          return true;
        },

        async reject(rejection) {
          const reviewed = await tx.retailerLinkRequest.updateMany({
            where: {
              id: rejection.requestId,
              status: RetailerLinkRequestStatus.PENDING,
            },
            data: {
              status: RetailerLinkRequestStatus.REJECTED,
              reviewedAt: rejection.reviewedAt,
              reviewedById: rejection.reviewedById,
            },
          });

          return reviewed.count === 1;
        },

        async recordAuditEvent(event) {
          await tx.auditEvent.create({
            data: {
              eventType: event.eventType,
              entityType: event.entityType,
              entityId: event.entityId,
              actorId: event.actorId,
              metadata: event.metadata as Prisma.InputJsonValue,
              createdAt: event.createdAt,
            },
          });
        },
      };

      return reviewRetailerLinkRequest(store, {
        actorId: input.actorId,
        requestId: input.requestId,
        decision: input.decision,
        now: new Date(),
      });
    },
    { isolationLevel: "Serializable" },
  );
}
