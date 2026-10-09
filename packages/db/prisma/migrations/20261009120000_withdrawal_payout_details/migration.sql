-- Withdrawals carry where to pay (bank / UPI / USDT) and the currency of
-- `amount`. Hand-written: schema.prisma has pre-existing drift.

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "accountHolder" TEXT,
ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "upiId" TEXT,
ADD COLUMN     "usdtNetwork" TEXT,
ADD COLUMN     "usdtAddress" TEXT,
ADD COLUMN     "destinationKey" TEXT;

-- Backfill: a historical amount is in the user's LIVE account currency.
UPDATE "Withdrawal" w
SET "currency" = a."currency"
FROM "Account" a
WHERE a."userId" = w."userId" AND a."type" = 'LIVE';

-- CreateIndex
CREATE INDEX "Withdrawal_destinationKey_idx" ON "Withdrawal"("destinationKey");
