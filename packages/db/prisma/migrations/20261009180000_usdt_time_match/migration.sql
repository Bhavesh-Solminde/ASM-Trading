-- USDT time-slot deposits on a shared receiving address: each deposit holds
-- one address alone for its window and is matched by block timestamp (plus
-- the optional sender address / a ±3% amount check), crediting the amount
-- that actually arrives. Such rows carry the user's own round amount, so they
-- must not take part in the live-amount reservations (two users may both
-- deposit exactly $25).

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN "usdtMatch" TEXT,
ADD COLUMN "senderAddress" TEXT;

-- Recreate both live-amount partial unique indexes without time-matched rows.
DROP INDEX "Deposit_live_amount_unique";
CREATE UNIQUE INDEX "Deposit_live_amount_unique"
  ON "Deposit" ("amountInr")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')
    AND "gateway" IS NULL
    AND "usdtMatch" IS NULL;

DROP INDEX "Deposit_live_usdt_amount_unique";
CREATE UNIQUE INDEX "Deposit_live_usdt_amount_unique"
  ON "Deposit" ("amountUsdtMinor")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')
    AND "amountUsdtMinor" IS NOT NULL
    AND "gateway" IS NULL
    AND "usdtMatch" IS NULL;

-- The slot-busy check at creation and the matcher's "whose window covers this
-- block timestamp?" lookups.
CREATE INDEX "Deposit_usdt_time_match_idx"
  ON "Deposit" ("network", "receivingAddress", "expiresAt")
  WHERE "usdtMatch" IS NOT NULL;
