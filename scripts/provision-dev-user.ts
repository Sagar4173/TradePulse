import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  UserRole,
  UserStatus,
} from "../src/generated/prisma/client";
import {
  maskPhone,
  normalizeIndianPhone,
} from "../src/lib/auth/phone";
import { validateAccessAssignment } from "../src/lib/auth/user-access";
import {
  DevelopmentTargetError,
  requireDevelopmentDatabaseTarget,
} from "../src/lib/dev/dev-target";
import { buildNormalizedPhoneLookupWhere } from "../src/lib/users/phone-lookup";
import { fail, many, parseArgs, single } from "./lib/cli";
import { findExistingUserByPhone } from "./lib/users";

/**
 * Development-only account provisioning.
 *
 * This script creates or updates a user by verified-phone ownership, but it
 * never creates an OTP or a session. The person still has to complete the
 * normal phone OTP flow. It refuses to run in production and requires an
 * explicit opt-in flag.
 */

if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production"
) {
  console.error("Refusing to provision users in a production environment.");
  process.exit(1);
}

if (process.env.AUTH_DEV_PROVISIONING_ENABLED !== "true") {
  console.error(
    "Set AUTH_DEV_PROVISIONING_ENABLED=true in your local .env before using this development-only script.",
  );
  process.exit(1);
}

try {
  // DATABASE_URL is the runtime target. If DIRECT_URL is configured, the guard
  // requires both URLs to resolve to the same host, port, database, and schema.
  requireDevelopmentDatabaseTarget(process.env);
} catch (error) {
  console.error(
    error instanceof DevelopmentTargetError
      ? error.message
      : "Refusing to provision users: the database target could not be verified.",
  );
  process.exit(1);
}

const connectionString =
  process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.error(
    "DATABASE_URL must be set. Copy .env.example to .env and configure PostgreSQL.",
  );
  process.exit(1);
}

function parseRole(value: string): UserRole {
  const roles = Object.values(UserRole) as string[];

  if (!roles.includes(value)) {
    fail(`Invalid --role "${value}". Use one of: ${roles.join(", ")}.`);
  }

  return value as UserRole;
}

function parseStatus(value: string): UserStatus {
  const statuses = Object.values(UserStatus) as string[];

  if (!statuses.includes(value)) {
    fail(`Invalid --status "${value}". Use one of: ${statuses.join(", ")}.`);
  }

  return value as UserStatus;
}

async function resolveRetailerId(
  prisma: PrismaClient,
  input: { id: string | null; phone: string | null; label: string },
): Promise<string | null> {
  if (input.id) {
    const retailer = await prisma.retailer.findUnique({
      where: { id: input.id },
      select: { id: true },
    });

    if (!retailer) {
      fail(`${input.label} retailer id "${input.id}" does not exist.`);
    }

    return retailer.id;
  }

  if (input.phone) {
    const normalized = normalizeIndianPhone(input.phone);

    if (!normalized) {
      fail(`${input.label} retailer phone is not a valid Indian mobile number.`);
    }

    const candidates = await prisma.retailer.findMany({
      where: buildNormalizedPhoneLookupWhere(normalized),
      select: { id: true, shopName: true, phone: true },
    });
    const matches = candidates.filter(
      (retailer) => normalizeIndianPhone(retailer.phone) === normalized,
    );

    if (matches.length !== 1) {
      fail(
        `${input.label} retailer phone matches ${matches.length} retailer records; exactly one is required.`,
      );
    }

    return matches[0].id;
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPhone = single(args, "phone");

  if (!rawPhone) {
    fail(
      "Usage: npm run db:provision-dev -- --phone 9876543210 --role ADMIN [--name \"Dev Admin\"] [--status ACTIVE] [--retailer-id ID | --retailer-phone 9876543210] [--assign-retailer-id ID] [--assign-retailer-phone PHONE]",
    );
  }

  const phone = normalizeIndianPhone(rawPhone);

  if (!phone) {
    fail("--phone must be a valid Indian mobile number.");
  }

  const rawRole = single(args, "role");

  if (!rawRole) {
    fail("--role is required.");
  }

  const role = parseRole(rawRole);
  const status = parseStatus(single(args, "status") ?? UserStatus.ACTIVE);
  const name = single(args, "name") ?? `Dev ${role} ${phone.slice(-4)}`;
  const retailerId = await resolveRetailerId(prisma, {
    id: single(args, "retailer-id"),
    phone: single(args, "retailer-phone"),
    label: "Linked",
  });

  const assignedRetailerIds: string[] = [];

  for (const id of many(args, "assign-retailer-id")) {
    const resolved = await resolveRetailerId(prisma, {
      id,
      phone: null,
      label: "Assigned",
    });

    if (resolved) {
      assignedRetailerIds.push(resolved);
    }
  }

  for (const assignmentPhone of many(args, "assign-retailer-phone")) {
    const resolved = await resolveRetailerId(prisma, {
      id: null,
      phone: assignmentPhone,
      label: "Assigned",
    });

    if (resolved) {
      assignedRetailerIds.push(resolved);
    }
  }

  const assignment = validateAccessAssignment({
    role,
    status,
    retailerId,
    assignedRetailerIds,
  });

  if (!assignment.ok) {
    fail(assignment.error);
  }

  const existing = await findExistingUserByPhone(prisma, phone);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          phone,
          phoneNormalized: phone,
          role: assignment.value.role,
          status: assignment.value.status,
          retailerId: assignment.value.retailerId,
          phoneVerifiedAt: new Date(),
          assignedRetailers:
            assignment.value.role === "SALESMAN"
              ? {
                  deleteMany: {},
                  create: assignment.value.assignedRetailerIds.map(
                    (assignedRetailerId) => ({
                      retailerId: assignedRetailerId,
                    }),
                  ),
                }
              : { deleteMany: {} },
        },
        select: { id: true, name: true, phone: true, role: true, status: true },
      })
    : await prisma.user.create({
        data: {
          name,
          phone,
          phoneNormalized: phone,
          role: assignment.value.role,
          status: assignment.value.status,
          retailerId: assignment.value.retailerId,
          phoneVerifiedAt: new Date(),
          assignedRetailers:
            assignment.value.role === "SALESMAN"
              ? {
                  create: assignment.value.assignedRetailerIds.map(
                    (assignedRetailerId) => ({
                      retailerId: assignedRetailerId,
                    }),
                  ),
                }
              : undefined,
        },
        select: { id: true, name: true, phone: true, role: true, status: true },
      });

  await prisma.auditEvent.create({
    data: {
      eventType: "USER_DEV_PROVISIONED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        role: user.role,
        status: user.status,
        assignedRetailerCount: assignment.value.assignedRetailerIds.length,
      },
    },
  });

  console.log(
    `${existing ? "Updated" : "Created"} ${user.role} user ${user.name} (${maskPhone(user.phone)}).`,
  );
  console.log("No OTP or session was created. Sign in through the normal OTP flow.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Provisioning failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
