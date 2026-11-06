import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  UserRole,
  UserStatus,
} from "../src/generated/prisma/client";
import { normalizeIndianPhone } from "../src/lib/auth/phone";
import {
  bootstrapAdministrator,
  formatBootstrapAdminResult,
} from "../src/lib/users/bootstrap";
import { fail, parseArgs, single } from "./lib/cli";
import { findExistingUserByPhone } from "./lib/users";

/**
 * Explicit first-administrator bootstrap for a new environment.
 *
 * This is intentionally not exposed over HTTP. It requires an opt-in
 * environment flag and direct database access, refuses to run if an active
 * administrator already exists, and never creates an OTP or a session. The
 * administrator signs in afterwards through the normal phone OTP flow.
 */

if (process.env.AUTH_BOOTSTRAP_ADMIN_ENABLED !== "true") {
  console.error(
    "Set AUTH_BOOTSTRAP_ADMIN_ENABLED=true in the trusted environment before using the first-administrator bootstrap.",
  );
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DIRECT_URL (preferred) or DATABASE_URL must be set. Configure the target environment before bootstrapping an administrator.",
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPhone = single(args, "phone");

  if (!rawPhone) {
    fail(
      'Usage: npm run db:bootstrap-admin -- --phone 9876543210 [--name "Operations Admin"]',
    );
  }

  const phone = normalizeIndianPhone(rawPhone);

  if (!phone) {
    fail("--phone must be a valid Indian mobile number.");
  }

  const requestedName = single(args, "name");
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const now = new Date();

        return bootstrapAdministrator(
          {
            countActiveAdmins: () =>
              tx.user.count({
                where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
              }),
            findExistingUserByPhone: (candidatePhone) =>
              findExistingUserByPhone(tx, candidatePhone),
            promoteToAdmin: (input) =>
              tx.user.update({
                where: { id: input.id },
                data: {
                  name: input.name,
                  phone: input.phone,
                  phoneNormalized: input.phone,
                  role: UserRole.ADMIN,
                  status: UserStatus.ACTIVE,
                  retailerId: null,
                  phoneVerifiedAt: input.verifiedAt,
                  assignedRetailers: { deleteMany: {} },
                },
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  role: true,
                  status: true,
                },
              }),
            createAdmin: (input) =>
              tx.user.create({
                data: {
                  name: input.name,
                  phone: input.phone,
                  phoneNormalized: input.phone,
                  role: UserRole.ADMIN,
                  status: UserStatus.ACTIVE,
                  phoneVerifiedAt: input.verifiedAt,
                },
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  role: true,
                  status: true,
                },
              }),
            revokeSessionsForUser: async (userId, revokedAt) => {
              const revoked = await tx.session.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt },
              });
              return revoked.count;
            },
            recordAuditEvent: async (input) => {
              await tx.auditEvent.create({
                data: {
                  eventType: "USER_BOOTSTRAP_ADMIN",
                  entityType: "User",
                  entityId: input.entityId,
                  metadata: {
                    mode: input.mode,
                    phoneLast4: input.phoneLast4,
                  },
                },
              });
            },
          },
          { phone, requestedName, now },
        );
      },
      { isolationLevel: "Serializable" },
    );

    console.log(formatBootstrapAdminResult(result));
    console.log(
      "No OTP was created and no new session was issued. Sign in through the normal phone OTP flow.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Administrator bootstrap failed.",
  );
  process.exitCode = 1;
});
