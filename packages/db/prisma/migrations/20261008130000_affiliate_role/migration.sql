-- Affiliate accounts: streamer-facing role separate from USER/ADMIN.
-- See docs/superpowers/specs/2026-10-08-affiliate-accounts-design.md.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'AFFILIATE';

-- AlterEnum
ALTER TYPE "TxKind" ADD VALUE 'AFFILIATE_RESET';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "lastAffiliateResetAt" TIMESTAMP(3);
