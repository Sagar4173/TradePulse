-- Milestone 2.5 authentication hardening (additive, not yet applied).
--
-- Adds:
--   1. An OTP admission reservation ledger so rate-limit checks happen before
--      scrypt hashing. Reservations count immediately for per-phone and per-IP
--      windows; expired PENDING rows become ABANDONED and still count for the
--      window, so a crashed request cannot reset the limits.
--   2. A retailer link-request workflow. A verified phone that matches an
--      existing retailer creates a PENDING request only; an administrator must
--      approve it before the user receives any retailer scope.
--
-- No existing rows are rewritten or deleted. OtpChallenge.reservationId is
-- nullable so challenges created before this migration remain valid and are
-- still counted by the compatibility path. Review and approve this SQL before
-- applying it; do not apply it as part of the code-hardening phase.

-- CreateEnum
CREATE TYPE "OtpReservationStatus" AS ENUM ('PENDING', 'CONSUMED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RetailerLinkRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN     "reservationId" TEXT;

-- CreateTable
CREATE TABLE "OtpRequestReservation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "requestIpHash" TEXT,
    "status" "OtpReservationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequestReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailerLinkRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "status" "RetailerLinkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" TEXT,

    CONSTRAINT "RetailerLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpRequestReservation_phone_createdAt_idx" ON "OtpRequestReservation"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequestReservation_requestIpHash_createdAt_idx" ON "OtpRequestReservation"("requestIpHash", "createdAt");

-- CreateIndex
CREATE INDEX "OtpRequestReservation_status_expiresAt_idx" ON "OtpRequestReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OtpRequestReservation_createdAt_idx" ON "OtpRequestReservation"("createdAt");

-- CreateIndex
CREATE INDEX "RetailerLinkRequest_status_createdAt_idx" ON "RetailerLinkRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RetailerLinkRequest_retailerId_status_idx" ON "RetailerLinkRequest"("retailerId", "status");

-- CreateIndex
CREATE INDEX "RetailerLinkRequest_reviewedById_idx" ON "RetailerLinkRequest"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "RetailerLinkRequest_userId_retailerId_key" ON "RetailerLinkRequest"("userId", "retailerId");

-- CreateIndex
CREATE UNIQUE INDEX "OtpChallenge_reservationId_key" ON "OtpChallenge"("reservationId");

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "OtpRequestReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerLinkRequest" ADD CONSTRAINT "RetailerLinkRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerLinkRequest" ADD CONSTRAINT "RetailerLinkRequest_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerLinkRequest" ADD CONSTRAINT "RetailerLinkRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
