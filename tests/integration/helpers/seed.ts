import {
  RetailerLinkRequestStatus,
  UserRole,
  UserStatus,
} from "../../../src/generated/prisma/client";
import type { PrismaClient } from "../../../src/generated/prisma/client";

type SeedUserInput = {
  id: string;
  name: string;
  phone: string;
  role?: UserRole;
  status?: UserStatus;
  retailerId?: string | null;
};

export async function seedUser(
  prisma: PrismaClient,
  input: SeedUserInput,
) {
  return prisma.user.create({
    data: {
      id: input.id,
      name: input.name,
      phone: input.phone,
      phoneNormalized: input.phone,
      role: input.role ?? UserRole.RETAILER,
      status: input.status ?? UserStatus.ACTIVE,
      retailerId: input.retailerId ?? null,
      phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

export async function seedRetailer(
  prisma: PrismaClient,
  input: {
    id: string;
    shopName?: string;
    ownerName?: string;
    phone?: string;
  },
) {
  return prisma.retailer.create({
    data: {
      id: input.id,
      shopName: input.shopName ?? `Shop ${input.id}`,
      ownerName: input.ownerName ?? `Owner ${input.id}`,
      phone: input.phone ?? "+919000000001",
    },
  });
}

export async function seedLinkRequest(
  prisma: PrismaClient,
  input: {
    id: string;
    userId: string;
    retailerId: string;
    status?: RetailerLinkRequestStatus;
    reviewedById?: string | null;
    reviewedAt?: Date | null;
    createdAt?: Date;
  },
) {
  return prisma.retailerLinkRequest.create({
    data: {
      id: input.id,
      userId: input.userId,
      retailerId: input.retailerId,
      status: input.status ?? RetailerLinkRequestStatus.PENDING,
      createdAt: input.createdAt ?? new Date("2026-01-02T00:00:00.000Z"),
      reviewedById: input.reviewedById ?? null,
      reviewedAt: input.reviewedAt ?? null,
    },
  });
}
