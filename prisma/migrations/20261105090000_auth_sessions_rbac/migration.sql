-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMPTZ(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMPTZ(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "requestIpHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "requestIpHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesmanRetailerAssignment" (
    "id" TEXT NOT NULL,
    "salesmanId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesmanRetailerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_requestIpHash_createdAt_idx" ON "OtpChallenge"("requestIpHash", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_createdAt_idx" ON "Session"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "SalesmanRetailerAssignment_retailerId_idx" ON "SalesmanRetailerAssignment"("retailerId");

-- CreateIndex
CREATE INDEX "SalesmanRetailerAssignment_assignedById_idx" ON "SalesmanRetailerAssignment"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "SalesmanRetailerAssignment_salesmanId_retailerId_key" ON "SalesmanRetailerAssignment"("salesmanId", "retailerId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesmanRetailerAssignment" ADD CONSTRAINT "SalesmanRetailerAssignment_salesmanId_fkey" FOREIGN KEY ("salesmanId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesmanRetailerAssignment" ADD CONSTRAINT "SalesmanRetailerAssignment_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesmanRetailerAssignment" ADD CONSTRAINT "SalesmanRetailerAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Additional integrity checks for the new authentication tables.
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_attempts_nonnegative" CHECK ("attempts" >= 0);
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_maxAttempts_positive" CHECK ("maxAttempts" > 0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
