-- Affiliate Program: the UPI amount the user requested (before the matching
-- offset). Referral qualification and the affiliate reward use it; never credited.

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "requestedInrMinor" BIGINT;
