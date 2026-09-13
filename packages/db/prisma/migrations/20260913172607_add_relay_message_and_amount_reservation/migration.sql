-- CreateTable
CREATE TABLE "RelayMessage" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "deviceModel" TEXT,
    "sender" TEXT,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "parsedAmountInr" INTEGER,
    "parsedUtr" TEXT,
    "isCredit" BOOLEAN,
    "bankCreditId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelayMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RelayMessage_source_deviceLabel_idx" ON "RelayMessage"("source", "deviceLabel");

-- CreateIndex
CREATE INDEX "RelayMessage_createdAt_idx" ON "RelayMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "RelayMessage" ADD CONSTRAINT "RelayMessage_bankCreditId_fkey" FOREIGN KEY ("bankCreditId") REFERENCES "BankCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Amount is the sole reconciliation key for deposit matching (see
-- docs/superpowers/specs/2026-09-13-bank-feed-deposit-verification-design.md).
-- Unique only among LIVE deposits, so two completed deposits may still
-- legitimately share an amount at different points in time.
CREATE UNIQUE INDEX "Deposit_live_amount_unique"
  ON "Deposit" ("amountInr")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION');
