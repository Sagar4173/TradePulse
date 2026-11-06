import { normalizeIndianPhone } from "../phone";
import type {
  AuthStore,
  AuthUser,
  CompleteOtpReservationInput,
  CreateOtpReservationInput,
  OtpChallengeRecord,
  OtpReservationRecord,
  SessionRecord,
} from "../types";

type StoredUser = AuthUser & { phoneVerifiedAt: Date | null };

type StoredOtpChallenge = OtpChallengeRecord & {
  requestIpHash: string | null;
  reservationId: string | null;
};

type StoredOtpReservation = OtpReservationRecord;

type StoredRetailerLinkRequest = {
  id: string;
  userId: string;
  retailerId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
};

type StoredSession = SessionRecord & { ipHash: string | null };

export type MemoryUserSeed = {
  id: string;
  name: string;
  phone: string;
  role: AuthUser["role"];
  status?: AuthUser["status"];
  retailerId?: string | null;
};

/**
 * In-memory AuthStore used by unit tests. It intentionally mirrors the
 * production repository contract so the OTP/session rules are tested without
 * requiring a database.
 */
export function createMemoryAuthStore(options?: {
  users?: MemoryUserSeed[];
  retailerPhones?: Record<string, { id: string; ownerName: string }>;
  linkRequests?: Array<{
    id?: string;
    userId: string;
    retailerId: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    createdAt?: Date;
  }>;
}) {
  let sequence = 0;
  const usersByPhone = new Map<string, StoredUser>();
  const usersById = new Map<string, StoredUser>();
  const challenges = new Map<string, StoredOtpChallenge>();
  const reservations = new Map<string, StoredOtpReservation>();
  const retailerLinkRequests = new Map<string, StoredRetailerLinkRequest>();
  const sessions = new Map<string, StoredSession>();
  const retailerPhones = new Map(
    Object.entries(options?.retailerPhones ?? {}).map(([phone, retailer]) => [
      normalizeIndianPhone(phone) ?? phone,
      retailer,
    ]),
  );
  let admissionQueue: Promise<void> = Promise.resolve();

  for (const seed of options?.linkRequests ?? []) {
    const request: StoredRetailerLinkRequest = {
      id: seed.id ?? `link_request_${++sequence}`,
      userId: seed.userId,
      retailerId: seed.retailerId,
      status: seed.status,
      createdAt: seed.createdAt ?? new Date(0),
    };
    retailerLinkRequests.set(request.id, request);
  }

  for (const seed of options?.users ?? []) {
    const normalized = normalizeIndianPhone(seed.phone);

    if (!normalized) {
      throw new Error(`Memory store seed has an invalid phone: ${seed.id}`);
    }

    if (usersByPhone.has(normalized)) {
      throw new Error(
        `Memory store seed has a duplicate normalized phone: ${seed.id}`,
      );
    }

    const user: StoredUser = {
      id: seed.id,
      name: seed.name,
      phone: seed.phone,
      role: seed.role,
      status: seed.status ?? "ACTIVE",
      retailerId: seed.retailerId ?? null,
      phoneVerifiedAt: null,
    };
    usersByPhone.set(normalized, user);
    usersById.set(user.id, user);
  }

  function createChallenge(
    input: CompleteOtpReservationInput,
  ): StoredOtpChallenge {
    const challenge: StoredOtpChallenge = {
      id: `challenge_${++sequence}`,
      phone: input.phone,
      codeHash: input.codeHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: input.createdAt,
      requestIpHash: input.requestIpHash,
      reservationId: input.reservationId,
    };
    challenges.set(challenge.id, challenge);
    return challenge;
  }

  function hasPendingRetailerLinkRequest(userId: string): boolean {
    for (const request of retailerLinkRequests.values()) {
      if (request.userId === userId && request.status === "PENDING") {
        return true;
      }
    }

    return false;
  }

  function createPendingRetailerLinkRequest(
    userId: string,
    retailerId: string,
    createdAt: Date,
  ): void {
    const request: StoredRetailerLinkRequest = {
      id: `link_request_${++sequence}`,
      userId,
      retailerId,
      status: "PENDING",
      createdAt,
    };
    retailerLinkRequests.set(request.id, request);
  }

  const store: AuthStore & {
    getChallenges(): StoredOtpChallenge[];
    getReservations(): StoredOtpReservation[];
    getRetailerLinkRequests(): StoredRetailerLinkRequest[];
    getSessions(): StoredSession[];
    getUsers(): StoredUser[];
    seedChallenge(challenge: StoredOtpChallenge): void;
    seedSession(session: StoredSession): void;
  } = {
    async findUserByPhone(phone) {
      const normalized = normalizeIndianPhone(phone);
      return normalized ? usersByPhone.get(normalized) ?? null : null;
    },

    async findUserById(id) {
      return usersById.get(id) ?? null;
    },

    async ensureUserForVerifiedPhone(phone, now) {
      const normalized = normalizeIndianPhone(phone);

      if (!normalized) {
        throw new Error("Cannot provision a user with an invalid phone.");
      }

      const existing = usersByPhone.get(normalized);

      if (existing) {
        existing.phoneVerifiedAt = now;

        // A phone match never links automatically. For an existing, unlinked
        // retailer account, record one pending request so an administrator can
        // review the match. Never create a second pending request.
        if (
          existing.role === "RETAILER" &&
          existing.retailerId === null &&
          !hasPendingRetailerLinkRequest(existing.id)
        ) {
          const retailer = retailerPhones.get(normalized);

          if (retailer) {
            createPendingRetailerLinkRequest(existing.id, retailer.id, now);
          }
        }

        return existing;
      }

      const retailer = retailerPhones.get(normalized) ?? null;
      const lastFour = normalized.slice(-4);
      const user: StoredUser = {
        id: `user_${++sequence}`,
        name: `Retailer ${lastFour}`,
        phone: normalized,
        role: "RETAILER",
        status: "ACTIVE",
        // A phone match is never enough to grant retailer scope.
        retailerId: null,
        phoneVerifiedAt: now,
      };

      usersByPhone.set(normalized, user);
      usersById.set(user.id, user);

      if (retailer) {
        createPendingRetailerLinkRequest(user.id, retailer.id, now);
      }

      return user;
    },

    async recordSuccessfulLogin(userId) {
      const user = usersById.get(userId);
      if (user) {
        user.phoneVerifiedAt = user.phoneVerifiedAt ?? new Date();
      }
    },

    /**
     * Test double for the database advisory lock. A single queue serializes all
     * OTP admission critical sections, which is stricter than the per-phone and
     * per-IP locks used in production while still exercising the same atomic
     * call shape. Hashing happens after this callback returns.
     */
    async withOtpAdmissionLock(_scope, operation) {
      const previous = admissionQueue;
      let release!: () => void;
      admissionQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      try {
        return await operation(store);
      } finally {
        release();
      }
    },

    async expireStaleOtpReservations(scope, now) {
      for (const reservation of reservations.values()) {
        const matchesScope =
          reservation.phone === scope.phone ||
          (scope.requestIpHash !== null &&
            reservation.requestIpHash === scope.requestIpHash);

        if (
          matchesScope &&
          reservation.status === "PENDING" &&
          reservation.expiresAt <= now
        ) {
          reservation.status = "ABANDONED";
          reservation.completedAt = now;
        }
      }
    },

    async latestActiveOtpRequestForPhone(phone, now) {
      const candidates: Date[] = [];

      for (const reservation of reservations.values()) {
        if (reservation.phone !== phone) {
          continue;
        }

        const active =
          reservation.status === "CONSUMED" ||
          (reservation.status === "PENDING" &&
            reservation.expiresAt > now);

        if (active) {
          candidates.push(reservation.createdAt);
        }
      }

      for (const challenge of challenges.values()) {
        if (
          challenge.phone === phone &&
          challenge.reservationId === null &&
          !challenge.consumedAt
        ) {
          candidates.push(challenge.createdAt);
        }
      }

      if (candidates.length === 0) {
        return null;
      }

      return new Date(Math.max(...candidates.map((date) => date.getTime())));
    },

    async countOtpRequestsSince(phone, since) {
      let count = 0;

      for (const reservation of reservations.values()) {
        if (reservation.phone === phone && reservation.createdAt >= since) {
          count += 1;
        }
      }

      for (const challenge of challenges.values()) {
        if (
          challenge.phone === phone &&
          challenge.reservationId === null &&
          challenge.createdAt >= since
        ) {
          count += 1;
        }
      }

      return count;
    },

    async countOtpRequestsByIpSince(requestIpHash, since) {
      let count = 0;

      for (const reservation of reservations.values()) {
        if (
          reservation.requestIpHash === requestIpHash &&
          reservation.createdAt >= since
        ) {
          count += 1;
        }
      }

      for (const challenge of challenges.values()) {
        if (
          challenge.requestIpHash === requestIpHash &&
          challenge.reservationId === null &&
          challenge.createdAt >= since
        ) {
          count += 1;
        }
      }

      return count;
    },

    async createOtpReservation(input: CreateOtpReservationInput) {
      const reservation: StoredOtpReservation = {
        id: `reservation_${++sequence}`,
        phone: input.phone,
        requestIpHash: input.requestIpHash,
        status: "PENDING",
        expiresAt: input.expiresAt,
        completedAt: null,
        createdAt: input.createdAt,
      };
      reservations.set(reservation.id, reservation);
      return reservation;
    },

    async completeOtpReservation(input) {
      const reservation = reservations.get(input.reservationId);

      if (
        !reservation ||
        reservation.status !== "PENDING" ||
        reservation.expiresAt <= input.completedAt
      ) {
        return null;
      }

      reservation.status = "CONSUMED";
      reservation.completedAt = input.completedAt;
      return createChallenge(input);
    },

    async failOtpReservation(reservationId, challengeId, failedAt) {
      const reservation = reservations.get(reservationId);

      if (reservation && reservation.status === "CONSUMED") {
        reservation.status = "FAILED";
        reservation.completedAt = failedAt;
      }

      const challenge = challenges.get(challengeId);

      if (challenge && !challenge.consumedAt) {
        challenge.consumedAt = failedAt;
      }
    },

    async findOtpChallengeById(id) {
      return challenges.get(id) ?? null;
    },

    async incrementOtpAttempts(id) {
      const challenge = challenges.get(id);
      if (!challenge) {
        return 0;
      }

      challenge.attempts += 1;
      return challenge.attempts;
    },

    async consumeOtpChallenge(id, consumedAt) {
      const challenge = challenges.get(id);
      if (!challenge || challenge.consumedAt) {
        return false;
      }

      challenge.consumedAt = consumedAt;
      return true;
    },

    async consumeOutstandingOtpChallenges(phone, consumedAt) {
      for (const challenge of challenges.values()) {
        if (challenge.phone === phone && !challenge.consumedAt) {
          challenge.consumedAt = consumedAt;
        }
      }
    },

    async createSession(input) {
      const session: StoredSession = {
        id: `session_${++sequence}`,
        tokenHash: input.tokenHash,
        userId: input.userId,
        expiresAt: input.expiresAt,
        lastSeenAt: input.createdAt,
        revokedAt: null,
        ipHash: input.ipHash,
      };
      sessions.set(session.id, session);
      return session;
    },

    async findSessionByTokenHash(tokenHash) {
      const session = [...sessions.values()].find(
        (candidate) => candidate.tokenHash === tokenHash,
      );

      if (!session) {
        return null;
      }

      const user = usersById.get(session.userId);
      return user ? { session, user } : null;
    },

    async touchSession(id, at) {
      const session = sessions.get(id);
      if (session) {
        session.lastSeenAt = at;
      }
    },

    async revokeSession(id, at) {
      const session = sessions.get(id);
      if (session && !session.revokedAt) {
        session.revokedAt = at;
      }
    },

    async revokeSessionByTokenHash(tokenHash, at) {
      for (const session of sessions.values()) {
        if (session.tokenHash === tokenHash && !session.revokedAt) {
          session.revokedAt = at;
        }
      }
    },

    seedChallenge(challenge) {
      challenges.set(challenge.id, challenge);
    },

    seedSession(session) {
      sessions.set(session.id, session);
    },

    getChallenges() {
      return [...challenges.values()];
    },

    getReservations() {
      return [...reservations.values()];
    },

    getRetailerLinkRequests() {
      return [...retailerLinkRequests.values()];
    },

    getSessions() {
      return [...sessions.values()];
    },

    getUsers() {
      return [...usersByPhone.values()];
    },
  };

  return store;
}
