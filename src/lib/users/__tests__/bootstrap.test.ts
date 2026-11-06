import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bootstrapAdministrator,
  formatBootstrapAdminResult,
  MAX_BOOTSTRAP_ADMIN_NAME_LENGTH,
  type BootstrapAdminStore,
  type BootstrapUser,
} from "../bootstrap";

const PHONE = "+919876543210";
const NOW = new Date("2026-01-01T10:00:00.000Z");

function createStore(options?: {
  activeAdmins?: number;
  existing?: { id: string; name: string } | null;
  revokedSessions?: number;
}) {
  const calls = {
    activeAdminChecks: 0,
    lookup: null as string | null,
    promote: null as {
      id: string;
      name: string;
      phone: string;
      verifiedAt: Date;
    } | null,
    create: null as {
      name: string;
      phone: string;
      verifiedAt: Date;
    } | null,
    revoke: null as { userId: string; revokedAt: Date } | null,
    audit: null as {
      entityId: string;
      mode: string;
      phoneLast4: string;
    } | null,
  };

  const admin: BootstrapUser = {
    id: "user_admin",
    name: "Operations Admin",
    phone: PHONE,
    role: "ADMIN",
    status: "ACTIVE",
  };

  const store: BootstrapAdminStore = {
    async countActiveAdmins() {
      calls.activeAdminChecks += 1;
      return options?.activeAdmins ?? 0;
    },
    async findExistingUserByPhone(phone) {
      calls.lookup = phone;
      return options?.existing ?? null;
    },
    async promoteToAdmin(input) {
      calls.promote = input;
      return { ...admin, name: input.name };
    },
    async createAdmin(input) {
      calls.create = input;
      return { ...admin, name: input.name };
    },
    async revokeSessionsForUser(userId, revokedAt) {
      calls.revoke = { userId, revokedAt };
      return options?.revokedSessions ?? 0;
    },
    async recordAuditEvent(input) {
      calls.audit = input;
    },
  };

  return { store, calls };
}

describe("bootstrapAdministrator", () => {
  it("refuses when an active administrator already exists", async () => {
    const { store, calls } = createStore({ activeAdmins: 1 });

    await assert.rejects(
      bootstrapAdministrator(store, { phone: PHONE, now: NOW }),
      /active administrator already exists/i,
    );

    assert.equal(calls.lookup, null);
    assert.equal(calls.promote, null);
    assert.equal(calls.create, null);
  });

  it("creates the first administrator without creating or revoking a session", async () => {
    const { store, calls } = createStore();

    const result = await bootstrapAdministrator(store, {
      phone: PHONE,
      requestedName: "Operations Admin",
      now: NOW,
    });

    assert.equal(result.promotedExistingUser, false);
    assert.equal(result.revokedSessions, 0);
    assert.deepEqual(calls.create, {
      name: "Operations Admin",
      phone: PHONE,
      verifiedAt: NOW,
    });
    assert.equal(calls.revoke, null);
    assert.deepEqual(calls.audit, {
      entityId: "user_admin",
      mode: "created",
      phoneLast4: "3210",
    });
  });

  it("revokes every existing session when promoting an existing user", async () => {
    const { store, calls } = createStore({
      existing: { id: "user_existing", name: "Existing User" },
      revokedSessions: 3,
    });

    const result = await bootstrapAdministrator(store, {
      phone: PHONE,
      now: NOW,
    });

    assert.equal(result.promotedExistingUser, true);
    assert.equal(result.revokedSessions, 3);
    assert.deepEqual(calls.promote, {
      id: "user_existing",
      name: "Existing User",
      phone: PHONE,
      verifiedAt: NOW,
    });
    assert.deepEqual(calls.revoke, {
      userId: "user_existing",
      revokedAt: NOW,
    });
    assert.deepEqual(calls.audit, {
      entityId: "user_admin",
      mode: "elevated-existing-user",
      phoneLast4: "3210",
    });
  });

  it("preserves the existing name unless a new name is requested", async () => {
    const { store, calls } = createStore({
      existing: { id: "user_existing", name: "Existing User" },
    });

    await bootstrapAdministrator(store, { phone: PHONE, now: NOW });

    assert.equal(calls.promote?.name, "Existing User");
  });

  it("rejects an overlong name before changing access", async () => {
    const { store, calls } = createStore();

    await assert.rejects(
      bootstrapAdministrator(store, {
        phone: PHONE,
        requestedName: "x".repeat(MAX_BOOTSTRAP_ADMIN_NAME_LENGTH + 1),
        now: NOW,
      }),
      /characters or fewer/i,
    );

    assert.equal(calls.promote, null);
    assert.equal(calls.create, null);
  });
});

describe("formatBootstrapAdminResult", () => {
  it("shows only the last four phone digits", () => {
    const summary = formatBootstrapAdminResult({
      user: {
        id: "user_admin",
        name: "Operations Admin",
        phone: PHONE,
        role: "ADMIN",
        status: "ACTIVE",
      },
      promotedExistingUser: true,
      revokedSessions: 2,
    });

    assert.match(summary, /phone ending 3210/);
    assert.equal(summary.includes(PHONE), false);
    assert.equal(summary.includes("9876543210"), false);
  });
});
