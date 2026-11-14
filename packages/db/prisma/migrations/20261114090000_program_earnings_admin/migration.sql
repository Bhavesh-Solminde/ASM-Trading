-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProgramLedgerKind" AS ENUM ('EARNING_AVAILABLE', 'TRANSFER_TO_TRADING', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAID', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ProgramWithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProgramEarningKind" ADD VALUE 'REVENUE_SHARE';
ALTER TYPE "ProgramEarningKind" ADD VALUE 'ADJUSTMENT';

-- AlterEnum
ALTER TYPE "ProgramEarningStatus" ADD VALUE 'AVAILABLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProgramSettingKey" ADD VALUE 'PROGRAM_MIN_WITHDRAWAL_INR_MINOR';
ALTER TYPE "ProgramSettingKey" ADD VALUE 'PROGRAM_WITHDRAWALS_PER_DAY';
ALTER TYPE "ProgramSettingKey" ADD VALUE 'PROGRAM_WITHDRAWALS_PER_WEEK';
ALTER TYPE "ProgramSettingKey" ADD VALUE 'PROGRAM_WITHDRAWALS_PER_MONTH';
ALTER TYPE "ProgramSettingKey" ADD VALUE 'AFFILIATE_REQUIRES_APPROVAL';

-- AlterEnum
ALTER TYPE "TxKind" ADD VALUE 'PROGRAM_TRANSFER';

-- AlterTable
ALTER TABLE "ProgramEarning" ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "revenueShareDayId" TEXT,
ALTER COLUMN "qualificationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "userId" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AffiliateRate" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "revenueShareBps" INTEGER NOT NULL,
    "depositRewardBps" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "AffiliateRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramWallet" (
    "userId" TEXT NOT NULL,
    "availableMinor" BIGINT NOT NULL DEFAULT 0,
    "reservedMinor" BIGINT NOT NULL DEFAULT 0,
    "transferredMinor" BIGINT NOT NULL DEFAULT 0,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramWallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ProgramLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProgramLedgerKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "availableAfter" BIGINT NOT NULL,
    "reservedAfter" BIGINT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramTransfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "creditedMinor" BIGINT NOT NULL,
    "creditedCurrency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramWithdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" TEXT NOT NULL,
    "accountHolder" TEXT,
    "accountNumber" TEXT,
    "ifsc" TEXT,
    "upiId" TEXT,
    "usdtNetwork" TEXT,
    "usdtAddress" TEXT,
    "destinationKey" TEXT,
    "status" "ProgramWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "paymentReference" TEXT,
    "reviewedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueShareDay" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "netGainMinor" BIGINT NOT NULL,
    "carryInMinor" BIGINT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "rateId" TEXT,
    "eligibleMinor" BIGINT NOT NULL,
    "shareMinor" BIGINT NOT NULL,
    "carryOutMinor" BIGINT NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueShareDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramDayClose" (
    "day" DATE NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revenueShareRows" INTEGER NOT NULL,
    "releasedEarnings" INTEGER NOT NULL,

    CONSTRAINT "ProgramDayClose_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "AffiliateProfile_status_idx" ON "AffiliateProfile"("status");

-- CreateIndex
CREATE INDEX "AffiliateRate_affiliateId_effectiveFrom_idx" ON "AffiliateRate"("affiliateId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProgramLedgerEntry_userId_createdAt_idx" ON "ProgramLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramLedgerEntry_kind_refType_refId_key" ON "ProgramLedgerEntry"("kind", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramTransfer_idempotencyKey_key" ON "ProgramTransfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProgramTransfer_userId_createdAt_idx" ON "ProgramTransfer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramWithdrawal_idempotencyKey_key" ON "ProgramWithdrawal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProgramWithdrawal_userId_createdAt_idx" ON "ProgramWithdrawal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgramWithdrawal_status_createdAt_idx" ON "ProgramWithdrawal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProgramWithdrawal_destinationKey_idx" ON "ProgramWithdrawal"("destinationKey");

-- CreateIndex
CREATE INDEX "RevenueShareDay_day_idx" ON "RevenueShareDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueShareDay_affiliateId_day_key" ON "RevenueShareDay"("affiliateId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramEarning_revenueShareDayId_key" ON "ProgramEarning"("revenueShareDayId");

-- CreateIndex
CREATE INDEX "ProgramEarning_status_earnedAt_idx" ON "ProgramEarning"("status", "earnedAt");

-- AddForeignKey
ALTER TABLE "ProgramEarning" ADD CONSTRAINT "ProgramEarning_revenueShareDayId_fkey" FOREIGN KEY ("revenueShareDayId") REFERENCES "RevenueShareDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateProfile" ADD CONSTRAINT "AffiliateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateRate" ADD CONSTRAINT "AffiliateRate_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramWallet" ADD CONSTRAINT "ProgramWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramLedgerEntry" ADD CONSTRAINT "ProgramLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTransfer" ADD CONSTRAINT "ProgramTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramWithdrawal" ADD CONSTRAINT "ProgramWithdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueShareDay" ADD CONSTRAINT "RevenueShareDay_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing live affiliate account gets a profile: active once its email is verified.
INSERT INTO "AffiliateProfile" ("userId", "status", "createdAt", "updatedAt")
SELECT "id",
       CASE WHEN "emailVerified" THEN 'ACTIVE'::"AffiliateStatus" ELSE 'PENDING_VERIFICATION'::"AffiliateStatus" END,
       NOW(), NOW()
FROM "User"
WHERE "role" = 'AFFILIATE' AND "legacySimulated" = false;

-- Money history is append-only for the runtime role, like AuditLog (sql/restrict-role.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "ProgramLedgerEntry", "AffiliateRate", "RevenueShareDay", "ProgramDayClose" FROM asm_app;
  END IF;
END
$$;
