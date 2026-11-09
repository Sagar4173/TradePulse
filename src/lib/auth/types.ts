export const ROLES = ["RETAILER", "SALESMAN", "ORDER_DESK", "ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export type AuthUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
  status: UserStatus;
  retailerId: string | null;
};

export type OtpChallengeRecord = {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type OtpReservationStatus =
  | "PENDING"
  | "CONSUMED"
  | "FAILED"
  | "ABANDONED";

export type OtpReservationRecord = {
  id: string;
  phone: string;
  requestIpHash: string | null;
  status: OtpReservationStatus;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

export type CreateOtpReservationInput = {
  phone: string;
  requestIpHash: string | null;
  expiresAt: Date;
  createdAt: Date;
};

export type CompleteOtpReservationInput = {
  reservationId: string;
  phone: string;
  codeHash: string;
  maxAttempts: number;
  expiresAt: Date;
  createdAt: Date;
  requestIpHash: string | null;
  completedAt: Date;
};

export type SessionRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type AuthSession = {
  sessionId: string;
  user: AuthUser;
  expiresAt: Date;
};

export type OtpRateLimitScope = {
  phone: string;
  requestIpHash: string | null;
};

export type CreateSessionInput = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  ipHash: string | null;
};

/**
 * Narrow persistence contract for authentication. Keeping it independent of
 * Prisma lets the OTP and session rules run against an in-memory store in tests.
 */
export interface AuthStore {
  findUserByPhone(phone: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  /**
   * Creates or updates the account for a verified phone. A phone that matches
   * an existing retailer creates a PENDING link request but never links the
   * account automatically.
   */
  ensureUserForVerifiedPhone(
    phone: string,
    verifiedAt: Date,
  ): Promise<AuthUser>;
  recordSuccessfulLogin(userId: string, at: Date): Promise<void>;

  /**
   * Runs the callback while holding an atomic lock for the OTP admission keys.
   * The supplied store must be bound to the same transaction so the
   * cooldown/count checks and reservation insert are one serialized operation.
   * Expensive OTP hashing must happen after this callback returns.
   */
  withOtpAdmissionLock<T>(
    scope: OtpRateLimitScope,
    operation: (store: AuthStore) => Promise<T>,
  ): Promise<T>;

  /**
   * Marks expired pending reservations as ABANDONED. The update is scoped to
   * the admission keys being evaluated so one request does not rewrite every
   * tenant's reservation history.
   */
  expireStaleOtpReservations(
    scope: OtpRateLimitScope,
    now: Date,
  ): Promise<void>;
  /** Latest completed or in-flight request used for resend cooldown. */
  latestActiveOtpRequestForPhone(
    phone: string,
    now: Date,
  ): Promise<Date | null>;
  /** All admitted requests for the phone in the window, including failures. */
  countOtpRequestsSince(phone: string, since: Date): Promise<number>;
  countOtpRequestsByIpSince(
    requestIpHash: string,
    since: Date,
  ): Promise<number>;
  createOtpReservation(
    input: CreateOtpReservationInput,
  ): Promise<OtpReservationRecord>;
  /**
   * Atomically converts a live PENDING reservation into a persisted challenge.
   * Returns null when the reservation expired or was already completed.
   */
  completeOtpReservation(
    input: CompleteOtpReservationInput,
  ): Promise<OtpChallengeRecord | null>;
  /**
   * Records a provider failure. The reservation stays counted for the rate
   * window but no longer holds the resend cooldown.
   */
  failOtpReservation(
    reservationId: string,
    challengeId: string,
    failedAt: Date,
  ): Promise<void>;

  findOtpChallengeById(id: string): Promise<OtpChallengeRecord | null>;
  incrementOtpAttempts(id: string): Promise<number>;
  consumeOtpChallenge(id: string, consumedAt: Date): Promise<boolean>;
  consumeOutstandingOtpChallenges(phone: string, consumedAt: Date): Promise<void>;

  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findSessionByTokenHash(
    tokenHash: string,
  ): Promise<{ session: SessionRecord; user: AuthUser } | null>;
  touchSession(id: string, at: Date): Promise<void>;
  revokeSession(id: string, at: Date): Promise<void>;
  revokeSessionByTokenHash(tokenHash: string, at: Date): Promise<void>;
}

export type AuthConfig = {
  otpLength: 6;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpReservationLeaseSeconds: number;
  otpRateWindowSeconds: number;
  otpMaxRequestsPerWindow: number;
  otpMaxRequestsPerIpWindow: number;
  sessionTtlSeconds: number;
  devOtpEnabled: boolean;
  isProduction: boolean;
};

export type OtpProviderKind = "development" | "sms";

export type OtpProvider = {
  id: string;
  /**
   * Only the explicit local development provider may expose the generated code
   * to the UI. Delivery providers send the code and return nothing.
   */
  kind: OtpProviderKind;
  send(input: {
    phone: string;
    code: string;
    /** Provider-side validity hint, derived from the challenge TTL. */
    ttlSeconds: number;
  }): Promise<void>;
};

export type OtpServiceDeps = {
  store: AuthStore;
  provider: OtpProvider;
  config: AuthConfig;
  now: () => Date;
  generateCode: () => string;
  generateSessionToken: () => string;
  hashOtp: (code: string) => Promise<string>;
  verifyOtpHash: (code: string, hash: string) => Promise<boolean>;
  hashToken: (token: string) => string;
};

export type SessionServiceDeps = {
  store: AuthStore;
  now: () => Date;
  hashToken: (token: string) => string;
};
