CREATE TYPE "AffiliateLinkKind" AS ENUM ('HOME', 'REGISTER', 'APP');

CREATE TABLE "AffiliateLink" (
    "id" TEXT PRIMARY KEY,
    "affiliateId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "code" TEXT NOT NULL,
    "kind" "AffiliateLinkKind" NOT NULL,
    "comment" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AffiliateLink_code_key" ON "AffiliateLink"("code");
CREATE UNIQUE INDEX "AffiliateLink_one_default" ON "AffiliateLink"("affiliateId") WHERE "isDefault";
CREATE INDEX "AffiliateLink_affiliateId_idx" ON "AffiliateLink"("affiliateId");

CREATE TABLE "AffiliateLinkDay" (
    "linkId" TEXT NOT NULL REFERENCES "AffiliateLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "day" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("linkId", "day")
);

ALTER TABLE "User" ADD COLUMN "referralLinkId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_referralLinkId_fkey" FOREIGN KEY ("referralLinkId")
    REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_referralLinkId_idx" ON "User"("referralLinkId");

-- Affiliates without a code get their default link lazily when first needed.
INSERT INTO "AffiliateLink" ("id", "affiliateId", "code", "kind", "isDefault", "createdAt")
SELECT gen_random_uuid()::text, "id", "referralCode", 'REGISTER', true, "createdAt"
FROM "User" WHERE "role" = 'AFFILIATE' AND NOT "legacySimulated" AND "referralCode" IS NOT NULL;

CREATE TABLE "AffiliateLevelTerms" (
    "id" TEXT PRIMARY KEY,
    "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 7),
    "revenueShareBps" INTEGER NOT NULL CHECK ("revenueShareBps" BETWEEN 0 AND 10000),
    "depositRewardBps" INTEGER NOT NULL CHECK ("depositRewardBps" BETWEEN 0 AND 10000),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL
);
CREATE INDEX "AffiliateLevelTerms_level_effectiveFrom_idx" ON "AffiliateLevelTerms"("level", "effectiveFrom");

INSERT INTO "AffiliateLevelTerms" ("id", "level", "revenueShareBps", "depositRewardBps", "effectiveFrom", "createdAt", "createdBy", "reason")
SELECT gen_random_uuid()::text, levels.level, revenue.value, deposit.value,
       now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC', 'migration', 'Seed from program defaults in force at launch'
FROM generate_series(1, 7) AS levels(level)
CROSS JOIN LATERAL (
  SELECT value FROM "ProgramSetting"
  WHERE key = 'DEFAULT_REVENUE_SHARE_BPS' AND "effectiveFrom" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  ORDER BY "effectiveFrom" DESC, "createdAt" DESC, id DESC LIMIT 1
) revenue
CROSS JOIN LATERAL (
  SELECT value FROM "ProgramSetting"
  WHERE key = 'AFFILIATE_DEPOSIT_REWARD_BPS' AND "effectiveFrom" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  ORDER BY "effectiveFrom" DESC, "createdAt" DESC, id DESC LIMIT 1
) deposit;

CREATE TABLE "AffiliateMonthLevel" (
    "affiliateId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "month" DATE NOT NULL,
    "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 7),
    "qualifyingDeposits" INTEGER NOT NULL CHECK ("qualifyingDeposits" >= 0),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("affiliateId", "month")
);

-- Supports both the LIVE credit lookup and linking confirmed flags to an invitee.
CREATE INDEX "Transaction_affiliate_deposit_credit_idx" ON "Transaction"("accountId", "refId", "createdAt")
    INCLUDE ("amount") WHERE "kind" = 'DEPOSIT' AND "refType" = 'Deposit' AND "amount" > 0;
CREATE INDEX "FraudFlag_affiliate_self_referral_users_idx" ON "FraudFlag" USING GIN ("linkedUserIds")
    WHERE "kind" = 'SELF_REFERRAL' AND "status" = 'CONFIRMED';
CREATE INDEX "ProgramEarning_affiliate_stats_idx" ON "ProgramEarning"("beneficiaryUserId", "earnedAt")
    WHERE "status" <> 'VOID';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "AffiliateLevelTerms", "AffiliateMonthLevel" FROM asm_app;
  END IF;
END
$$;
