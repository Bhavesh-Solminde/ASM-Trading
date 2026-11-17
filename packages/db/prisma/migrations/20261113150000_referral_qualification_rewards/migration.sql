-- Affiliate Program phase 4: qualification, one-time rewards, program settings.
-- See docs/affiliate/phase-4-qualification-rewards.md.

-- CreateEnum
CREATE TYPE "ProgramSettingKey" AS ENUM ('MIN_QUALIFYING_DEPOSIT_INR_MINOR', 'MIN_QUALIFYING_TRADE_INR_MINOR', 'USER_REFERRAL_REWARD_INR_MINOR', 'AFFILIATE_DEPOSIT_REWARD_BPS', 'INVITE_EXTRA_BONUS_PCT');

-- CreateEnum
CREATE TYPE "ReferralQualificationStatus" AS ENUM ('QUALIFIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ProgramEarningKind" AS ENUM ('REFERRAL_REWARD', 'AFFILIATE_DEPOSIT_REWARD');

-- CreateEnum
CREATE TYPE "ProgramEarningStatus" AS ENUM ('PENDING', 'HELD', 'VOID');

-- CreateTable
CREATE TABLE "ProgramSetting" (
    "id" TEXT NOT NULL,
    "key" "ProgramSettingKey" NOT NULL,
    "value" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "ProgramSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralQualification" (
    "id" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "firstDepositId" TEXT NOT NULL,
    "qualifyingTradeId" TEXT NOT NULL,
    "depositInrMinor" BIGINT NOT NULL,
    "tradeRealStakeInrMinor" BIGINT NOT NULL,
    "minDepositInrMinor" BIGINT NOT NULL,
    "minTradeInrMinor" BIGINT NOT NULL,
    "settingIds" TEXT[],
    "status" "ReferralQualificationStatus" NOT NULL DEFAULT 'QUALIFIED',
    "qualifiedAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramEarning" (
    "id" TEXT NOT NULL,
    "beneficiaryUserId" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "kind" "ProgramEarningKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "ProgramEarningStatus" NOT NULL,
    "holdReason" TEXT,
    "voidReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "settingIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramSetting_key_effectiveFrom_idx" ON "ProgramSetting"("key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralQualification_referredUserId_key" ON "ReferralQualification"("referredUserId");

-- CreateIndex
CREATE INDEX "ReferralQualification_inviterId_idx" ON "ReferralQualification"("inviterId");

-- CreateIndex
CREATE INDEX "ReferralQualification_firstDepositId_idx" ON "ReferralQualification"("firstDepositId");

-- CreateIndex
CREATE INDEX "ProgramEarning_beneficiaryUserId_status_idx" ON "ProgramEarning"("beneficiaryUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramEarning_qualificationId_kind_key" ON "ProgramEarning"("qualificationId", "kind");

-- AddForeignKey
ALTER TABLE "ReferralQualification" ADD CONSTRAINT "ReferralQualification_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralQualification" ADD CONSTRAINT "ReferralQualification_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEarning" ADD CONSTRAINT "ProgramEarning_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEarning" ADD CONSTRAINT "ProgramEarning_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "ReferralQualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Launch defaults (effective from the epoch so catch-up evaluation of older activity has a value).
INSERT INTO "ProgramSetting" ("id", "key", "value", "effectiveFrom", "createdBy", "reason") VALUES
  (gen_random_uuid()::text, 'MIN_QUALIFYING_DEPOSIT_INR_MINOR', 50000, '1970-01-01 00:00:00', 'migration', 'Launch default: minimum qualifying deposit ₹500'),
  (gen_random_uuid()::text, 'MIN_QUALIFYING_TRADE_INR_MINOR', 10000, '1970-01-01 00:00:00', 'migration', 'Launch default: minimum qualifying real-money stake ₹100'),
  (gen_random_uuid()::text, 'USER_REFERRAL_REWARD_INR_MINOR', 5000, '1970-01-01 00:00:00', 'migration', 'Launch default: regular inviter reward ₹50'),
  (gen_random_uuid()::text, 'AFFILIATE_DEPOSIT_REWARD_BPS', 500, '1970-01-01 00:00:00', 'migration', 'Launch default: affiliate reward 5% of first qualifying deposit'),
  (gen_random_uuid()::text, 'INVITE_EXTRA_BONUS_PCT', 10, '1970-01-01 00:00:00', 'migration', 'Launch default: +10% extra bonus on an invited friend''s first deposit');

-- Settings are append-only versions, like AuditLog (sql/restrict-role.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "ProgramSetting" FROM asm_app;
  END IF;
END
$$;
