-- Affiliate Program phase 3: referral ownership. Each user gets a lazily
-- assigned invitation code; the inviter is recorded once at signup.

-- CreateEnum
CREATE TYPE "ReferralVia" AS ENUM ('LINK', 'CODE');

-- AlterEnum
ALTER TYPE "FraudFlagKind" ADD VALUE 'SELF_REFERRAL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralVia" "ReferralVia",
ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
