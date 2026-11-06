export const MAX_BOOTSTRAP_ADMIN_NAME_LENGTH = 120;

export type BootstrapUser = {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: string;
};

export type BootstrapAdminResult = {
  user: BootstrapUser;
  promotedExistingUser: boolean;
  revokedSessions: number;
};

export type BootstrapAdminStore = {
  countActiveAdmins(): Promise<number>;
  findExistingUserByPhone(
    phone: string,
  ): Promise<{ id: string; name: string } | null>;
  promoteToAdmin(input: {
    id: string;
    name: string;
    phone: string;
    verifiedAt: Date;
  }): Promise<BootstrapUser>;
  createAdmin(input: {
    name: string;
    phone: string;
    verifiedAt: Date;
  }): Promise<BootstrapUser>;
  revokeSessionsForUser(userId: string, revokedAt: Date): Promise<number>;
  recordAuditEvent(input: {
    entityId: string;
    mode: "elevated-existing-user" | "created";
    phoneLast4: string;
  }): Promise<void>;
};

/**
 * First-administrator bootstrap rules. The caller must run this inside a
 * serializable transaction and must not expose it over HTTP. Existing users
 * have their sessions revoked because a role change must not inherit a session
 * that was issued before the promotion.
 */
export async function bootstrapAdministrator(
  store: BootstrapAdminStore,
  input: { phone: string; requestedName?: string | null; now: Date },
): Promise<BootstrapAdminResult> {
  const activeAdmins = await store.countActiveAdmins();

  if (activeAdmins > 0) {
    throw new Error(
      "An active administrator already exists. Use the administrator UI or the normal provisioning workflow instead.",
    );
  }

  const existing = await store.findExistingUserByPhone(input.phone);
  const requestedName = input.requestedName?.trim();
  const name = requestedName || existing?.name || "TradePulse Administrator";

  if (name.length > MAX_BOOTSTRAP_ADMIN_NAME_LENGTH) {
    throw new Error(
      `--name must be ${MAX_BOOTSTRAP_ADMIN_NAME_LENGTH} characters or fewer.`,
    );
  }

  const user = existing
    ? await store.promoteToAdmin({
        id: existing.id,
        name,
        phone: input.phone,
        verifiedAt: input.now,
      })
    : await store.createAdmin({
        name,
        phone: input.phone,
        verifiedAt: input.now,
      });

  const revokedSessions = existing
    ? await store.revokeSessionsForUser(existing.id, input.now)
    : 0;

  await store.recordAuditEvent({
    entityId: user.id,
    mode: existing ? "elevated-existing-user" : "created",
    phoneLast4: input.phone.slice(-4),
  });

  return {
    user,
    promotedExistingUser: Boolean(existing),
    revokedSessions,
  };
}

/**
 * Terminal-safe summary. Only the last four phone digits are shown so the
 * bootstrap command does not print a full phone number into logs.
 */
export function formatBootstrapAdminResult(
  result: BootstrapAdminResult,
): string {
  const revocation =
    result.revokedSessions > 0
      ? ` Revoked ${result.revokedSessions} existing session${
          result.revokedSessions === 1 ? "" : "s"
        }.`
      : "";

  return `Bootstrapped ${result.user.role} user ${result.user.name} (phone ending ${result.user.phone.slice(-4)}).${revocation}`;
}
