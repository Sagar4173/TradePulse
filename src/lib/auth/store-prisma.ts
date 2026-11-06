import "server-only";

import {
  OtpReservationStatus,
  Prisma,
  RetailerLinkRequestStatus,
  UserRole,
  UserStatus,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db";
import { buildNormalizedPhoneLookupWhere } from "@/lib/users/phone-lookup";

import {
  findUniqueNormalizedPhoneMatch,
  normalizeIndianPhone,
} from "./phone";
import type {
  AuthStore,
  AuthUser,
  CreateSessionInput,
  OtpChallengeRecord,
  OtpRateLimitScope,
  OtpReservationRecord,
  SessionRecord,
} from "./types";

type UserRow = {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: string;
  retailerId: string | null;
};

type ChallengeRow = {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

type ReservationRow = {
  id: string;
  phone: string;
  requestIpHash: string | null;
  status: string;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

type AuthDbClient = Prisma.TransactionClient;

type AuthStoreQueries = Omit<
  AuthStore,
  "withOtpAdmissionLock" | "completeOtpReservation" | "failOtpReservation"
>;

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as AuthUser["role"],
    status: user.status as AuthUser["status"],
    retailerId: user.retailerId,
  };
}

function toChallenge(row: ChallengeRow): OtpChallengeRecord {
  return {
    id: row.id,
    phone: row.phone,
    codeHash: row.codeHash,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

function toReservation(row: ReservationRow): OtpReservationRecord {
  return {
    id: row.id,
    phone: row.phone,
    requestIpHash: row.requestIpHash,
    status: row.status as OtpReservationRecord["status"],
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    userId: row.userId,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * Deterministic lock ordering prevents deadlocks when two requests share both
 * a phone and an IP key. PostgreSQL advisory locks are scoped to the
 * transaction, so they are released on commit, rollback, or connection loss.
 */
function otpLockKeys(scope: OtpRateLimitScope): string[] {
  const keys = [`otp:phone:${scope.phone}`];

  if (scope.requestIpHash) {
    keys.push(`otp:ip:${scope.requestIpHash}`);
  }

  return keys.sort();
}

const USER_SELECT = {
  id: true,
  name: true,
  phone: true,
  role: true,
  status: true,
  retailerId: true,
} as const;

function createAuthStoreQueries(client: AuthDbClient): AuthStoreQueries {
  async function findUserByPhone(phone: string): Promise<AuthUser | null> {
    const normalized = normalizeIndianPhone(phone);

    if (!normalized) {
      return null;
    }

    const user = await client.user.findUnique({
      where: { phoneNormalized: normalized },
      select: USER_SELECT,
    });

    return user ? toAuthUser(user) : null;
  }

  return {
    findUserByPhone,

    async findUserById(id) {
      const user = await client.user.findUnique({
        where: { id },
        select: USER_SELECT,
      });

      return user ? toAuthUser(user) : null;
    },

    async ensureUserForVerifiedPhone(phone, verifiedAt) {
      const normalized = normalizeIndianPhone(phone);

      if (!normalized) {
        throw new Error("Cannot provision a user with an invalid phone.");
      }

      const existing = await findUserByPhone(normalized);

      if (existing) {
        // Existing unlinked retailer accounts need the same review workflow as
        // newly created accounts. Link creation is nested in the verification
        // update so the timestamp and pending request commit atomically.
        if (
          existing.role === UserRole.RETAILER &&
          existing.retailerId === null
        ) {
          const pendingRequest = await client.retailerLinkRequest.findFirst({
            where: {
              userId: existing.id,
              status: RetailerLinkRequestStatus.PENDING,
            },
            select: { id: true },
          });

          if (!pendingRequest) {
            const retailerCandidates = await client.retailer.findMany({
              where: buildNormalizedPhoneLookupWhere(normalized),
              select: { id: true, phone: true },
            });
            const retailer = findUniqueNormalizedPhoneMatch(
              retailerCandidates,
              normalized,
            );

            if (retailer) {
              try {
                await client.user.update({
                  where: { id: existing.id },
                  data: {
                    phoneVerifiedAt: verifiedAt,
                    retailerLinkRequests: {
                      create: {
                        retailerId: retailer.id,
                        status: RetailerLinkRequestStatus.PENDING,
                        createdAt: verifiedAt,
                      },
                    },
                  },
                });
              } catch (error) {
                if (!isUniqueConstraintError(error)) {
                  throw error;
                }

                // A concurrent verification created the single allowed pending
                // request first. The account is still verified.
                await client.user.update({
                  where: { id: existing.id },
                  data: { phoneVerifiedAt: verifiedAt },
                });
              }

              return existing;
            }
          }
        }

        await client.user.update({
          where: { id: existing.id },
          data: { phoneVerifiedAt: verifiedAt },
        });
        return existing;
      }

      const retailerCandidates = await client.retailer.findMany({
        where: buildNormalizedPhoneLookupWhere(normalized),
        select: { id: true, phone: true },
      });
      const retailer = findUniqueNormalizedPhoneMatch(
        retailerCandidates,
        normalized,
      );
      const name = `Retailer ${normalized.slice(-4)}`;

      try {
        const created = await client.user.create({
          data: {
            name,
            phone: normalized,
            phoneNormalized: normalized,
            role: UserRole.RETAILER,
            status: UserStatus.ACTIVE,
            // A phone match is never enough to grant retailer scope. The
            // request is recorded atomically with account creation.
            retailerId: null,
            phoneVerifiedAt: verifiedAt,
            ...(retailer
              ? {
                  retailerLinkRequests: {
                    create: {
                      retailerId: retailer.id,
                      status: RetailerLinkRequestStatus.PENDING,
                      createdAt: verifiedAt,
                    },
                  },
                }
              : {}),
          },
          select: USER_SELECT,
        });

        return toAuthUser(created);
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        // A concurrent verification created the account first. The unique
        // phoneNormalized index makes this an exact follow-up lookup. The
        // winning request owns any pending retailer link request.
        const concurrent = await findUserByPhone(normalized);

        if (!concurrent) {
          throw error;
        }

        await client.user.update({
          where: { id: concurrent.id },
          data: { phoneVerifiedAt: verifiedAt },
        });
        return concurrent;
      }
    },

    async recordSuccessfulLogin(userId, at) {
      await client.user.update({
        where: { id: userId },
        data: { lastLoginAt: at, phoneVerifiedAt: at },
      });
    },

    async expireStaleOtpReservations(scope, now) {
      // Only the admission keys being evaluated are rewritten. An unrelated
      // phone's abandoned lease is not this request's responsibility.
      const scopeFilters: Prisma.OtpRequestReservationWhereInput[] = [
        { phone: scope.phone },
      ];

      if (scope.requestIpHash) {
        scopeFilters.push({ requestIpHash: scope.requestIpHash });
      }

      await client.otpRequestReservation.updateMany({
        where: {
          status: OtpReservationStatus.PENDING,
          expiresAt: { lte: now },
          OR: scopeFilters,
        },
        data: {
          status: OtpReservationStatus.ABANDONED,
          completedAt: now,
        },
      });
    },

    async latestActiveOtpRequestForPhone(phone, now) {
      // Only a delivered/consumed request or a live admission lease holds the
      // resend cooldown. FAILED and ABANDONED rows still count for the rate
      // window, but the user may retry immediately because no code arrived.
      const [reservation, legacyChallenge] = await Promise.all([
        client.otpRequestReservation.findFirst({
          where: {
            phone,
            OR: [
              { status: OtpReservationStatus.CONSUMED },
              {
                status: OtpReservationStatus.PENDING,
                expiresAt: { gt: now },
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        client.otpChallenge.findFirst({
          // Challenges created before the reservation ledger existed have no
          // reservationId and remain authoritative while unconsumed.
          where: { phone, reservationId: null, consumedAt: null },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

      const candidates = [reservation?.createdAt, legacyChallenge?.createdAt].filter(
        (date): date is Date => date instanceof Date,
      );

      if (candidates.length === 0) {
        return null;
      }

      return new Date(Math.max(...candidates.map((date) => date.getTime())));
    },

    async countOtpRequestsSince(phone, since) {
      const [reservations, legacyChallenges] = await Promise.all([
        client.otpRequestReservation.count({
          where: { phone, createdAt: { gte: since } },
        }),
        client.otpChallenge.count({
          where: {
            phone,
            reservationId: null,
            createdAt: { gte: since },
          },
        }),
      ]);

      return reservations + legacyChallenges;
    },

    async countOtpRequestsByIpSince(requestIpHash, since) {
      const [reservations, legacyChallenges] = await Promise.all([
        client.otpRequestReservation.count({
          where: { requestIpHash, createdAt: { gte: since } },
        }),
        client.otpChallenge.count({
          where: {
            requestIpHash,
            reservationId: null,
            createdAt: { gte: since },
          },
        }),
      ]);

      return reservations + legacyChallenges;
    },

    async createOtpReservation(input) {
      const reservation = await client.otpRequestReservation.create({
        data: {
          phone: input.phone,
          requestIpHash: input.requestIpHash,
          status: OtpReservationStatus.PENDING,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
        },
      });

      return toReservation(reservation);
    },

    async findOtpChallengeById(id) {
      const challenge = await client.otpChallenge.findUnique({ where: { id } });
      return challenge ? toChallenge(challenge) : null;
    },

    async incrementOtpAttempts(id) {
      const challenge = await client.otpChallenge.update({
        where: { id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      return challenge.attempts;
    },

    async consumeOtpChallenge(id, consumedAt) {
      const result = await client.otpChallenge.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt },
      });
      return result.count === 1;
    },

    async consumeOutstandingOtpChallenges(phone, consumedAt) {
      await client.otpChallenge.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt },
      });
    },

    async createSession(input: CreateSessionInput) {
      const session = await client.session.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
          lastSeenAt: input.createdAt,
          requestIpHash: input.ipHash,
        },
      });

      return toSession(session);
    },

    async findSessionByTokenHash(tokenHash) {
      const session = await client.session.findUnique({
        where: { tokenHash },
        include: { user: { select: USER_SELECT } },
      });

      if (!session) {
        return null;
      }

      return {
        session: toSession(session),
        user: toAuthUser(session.user),
      };
    },

    async touchSession(id, at) {
      await client.session.updateMany({
        where: { id, revokedAt: null },
        data: { lastSeenAt: at },
      });
    },

    async revokeSession(id, at) {
      await client.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: at },
      });
    },

    async revokeSessionByTokenHash(tokenHash, at) {
      await client.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: at },
      });
    },
  };
}

/**
 * Store bound to the admission-lock transaction. Completing or failing a
 * reservation opens its own transaction, so it must never run while admission
 * locks are held (a nested or long-held transaction would defeat the split
 * between cheap admission and expensive hashing).
 */
function createLockedAuthStore(tx: Prisma.TransactionClient): AuthStore {
  return {
    ...createAuthStoreQueries(tx),
    async withOtpAdmissionLock() {
      throw new Error("Nested OTP admission locks are not supported.");
    },
    async completeOtpReservation() {
      throw new Error(
        "OTP reservations cannot be completed inside the admission lock.",
      );
    },
    async failOtpReservation() {
      throw new Error(
        "OTP reservations cannot be failed inside the admission lock.",
      );
    },
  };
}

export function createPrismaAuthStore(): AuthStore {
  const prisma = getPrismaClient();

  return {
    ...createAuthStoreQueries(prisma),

    async withOtpAdmissionLock(scope, operation) {
      return prisma.$transaction(async (tx) => {
        for (const key of otpLockKeys(scope)) {
          // hashtextextended maps a namespaced key to the bigint advisory-lock
          // space. The SELECT wrapper keeps the void-returning lock call
          // compatible with Prisma's raw-query result mapping.
          await tx.$queryRaw`
            SELECT 1
            FROM (
              SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
            ) AS otp_rate_limit_lock
          `;
        }

        return operation(createLockedAuthStore(tx));
      });
    },

    async completeOtpReservation(input) {
      return prisma.$transaction(async (tx) => {
        // Claim the live lease with a conditional update. Under READ COMMITTED
        // a concurrent claim waits and then re-evaluates the predicate, so a
        // reservation can produce at most one challenge.
        const claimed = await tx.otpRequestReservation.updateMany({
          where: {
            id: input.reservationId,
            status: OtpReservationStatus.PENDING,
            expiresAt: { gt: input.completedAt },
          },
          data: {
            status: OtpReservationStatus.CONSUMED,
            completedAt: input.completedAt,
          },
        });

        if (claimed.count !== 1) {
          return null;
        }

        const challenge = await tx.otpChallenge.create({
          data: {
            phone: input.phone,
            codeHash: input.codeHash,
            maxAttempts: input.maxAttempts,
            expiresAt: input.expiresAt,
            createdAt: input.createdAt,
            requestIpHash: input.requestIpHash,
            reservationId: input.reservationId,
          },
        });

        return toChallenge(challenge);
      });
    },

    async failOtpReservation(reservationId, challengeId, failedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.otpRequestReservation.updateMany({
          where: {
            id: reservationId,
            status: OtpReservationStatus.CONSUMED,
          },
          data: {
            status: OtpReservationStatus.FAILED,
            completedAt: failedAt,
          },
        });

        await tx.otpChallenge.updateMany({
          where: {
            id: challengeId,
            reservationId,
            consumedAt: null,
          },
          data: { consumedAt: failedAt },
        });
      });
    },
  };
}
