-- Anti-fraud foundation: multi-account linkage detection, forensic capture on
-- signup/deposit/withdrawal, and a FraudFlag review queue. Additive-only —
-- every new column is nullable or has a safe default, so existing rows are
-- unaffected and no backfill is needed.

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'FLAGGED', 'FROZEN', 'BANNED');
CREATE TYPE "FraudFlagKind" AS ENUM ('LINKED_ACCOUNT', 'HEDGING', 'SHARED_WITHDRAWAL_METHOD', 'RAPID_MULTI_ACCOUNT');
CREATE TYPE "FraudFlagStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED');

ALTER TABLE "User"
  ADD COLUMN "status"          "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "statusReason"    TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "signupIp"        TEXT,
  ADD COLUMN "signupUserAgent" TEXT,
  ADD COLUMN "signupDeviceFp"  TEXT,
  ADD COLUMN "lastIp"          TEXT,
  ADD COLUMN "lastUserAgent"   TEXT,
  ADD COLUMN "lastSeenAt"      TIMESTAMP(3);

CREATE INDEX "User_signupIp_idx" ON "User"("signupIp");
CREATE INDEX "User_lastIp_idx"   ON "User"("lastIp");
CREATE INDEX "User_status_idx"   ON "User"("status");

ALTER TABLE "Deposit"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

ALTER TABLE "Withdrawal"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE INDEX "Withdrawal_method_userId_idx" ON "Withdrawal"("method", "userId");

CREATE TABLE "FraudFlag" (
  "id"            TEXT             NOT NULL,
  "userId"        TEXT             NOT NULL,
  "kind"          "FraudFlagKind"  NOT NULL,
  "status"        "FraudFlagStatus" NOT NULL DEFAULT 'OPEN',
  "evidence"      JSONB            NOT NULL,
  "linkedUserIds" TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reviewedBy"    TEXT,
  "reviewNote"    TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FraudFlag_userId_createdAt_idx" ON "FraudFlag"("userId", "createdAt");
CREATE INDEX "FraudFlag_status_createdAt_idx" ON "FraudFlag"("status", "createdAt");
CREATE INDEX "FraudFlag_kind_status_idx"      ON "FraudFlag"("kind", "status");
