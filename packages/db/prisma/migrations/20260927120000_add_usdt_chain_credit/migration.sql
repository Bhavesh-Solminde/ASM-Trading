-- CreateEnum
CREATE TYPE "ChainCreditFinalityState" AS ENUM ('DETECTED', 'CONFIRMING', 'FINAL', 'FAILED_ON_CHAIN', 'REORGED');

-- CreateEnum
CREATE TYPE "ChainCreditProcessingStatus" AS ENUM ('PENDING', 'MATCHED', 'MANUAL_REVIEW', 'UNMATCHED');

-- AlterTable: USDT fields on Deposit, all nullable — the INR/UPI path never
-- touches these, and no existing row needs a backfill.
ALTER TABLE "Deposit" ADD COLUMN     "amountUsdtMinor" INTEGER,
ADD COLUMN     "matchedChainCreditId" TEXT,
ADD COLUMN     "network" TEXT,
ADD COLUMN     "receivingAddress" TEXT,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "tokenContract" TEXT;

-- CreateTable
-- The BankCredit analog for a USDT (TRC-20) on-chain transfer. Event
-- identity: eventIndex is "the event's index within the transaction's event
-- log" (TronGrid's own field, resolved via
-- GET /v1/transactions/{txHash}/events — never assumed, never defaulted to
-- 0). That position is already unique within a transaction across every
-- contract that emitted anything in it, so (network, txHash, eventIndex)
-- alone would be sufficient; tokenContract is included in the unique
-- constraint below anyway as defense-in-depth.
CREATE TABLE "ChainCredit" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "rawAmount" BIGINT NOT NULL,
    "normalizedAmountMinor" INTEGER,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "finalityState" "ChainCreditFinalityState" NOT NULL DEFAULT 'DETECTED',
    "processingStatus" "ChainCreditProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "checkAttempts" INTEGER NOT NULL DEFAULT 0,
    "firstNotFoundAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Durable pagination state for the chain watcher's discovery scan. version is
-- the same optimistic-concurrency idiom Account.version already uses — it's
-- what stops two concurrent watcher instances from both advancing (or
-- corrupting) the same cursor row for one tick.
CREATE TABLE "ChainScanCursor" (
    "network" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "receivingAddress" TEXT NOT NULL,
    "lastCommittedTimestampMs" BIGINT NOT NULL,
    "activeSessionMinTimestampMs" BIGINT,
    "activeSessionMaxTimestampMs" BIGINT,
    "activeSessionFingerprint" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainScanCursor_pkey" PRIMARY KEY ("network","tokenContract","receivingAddress")
);

-- CreateIndex
CREATE INDEX "ChainCredit_processingStatus_idx" ON "ChainCredit"("processingStatus");

-- CreateIndex
CREATE INDEX "ChainCredit_finalityState_idx" ON "ChainCredit"("finalityState");

-- CreateIndex
CREATE INDEX "ChainCredit_network_tokenContract_toAddress_normalizedAmoun_idx" ON "ChainCredit"("network", "tokenContract", "toAddress", "normalizedAmountMinor");

-- CreateIndex
CREATE UNIQUE INDEX "ChainCredit_network_tokenContract_txHash_eventIndex_key" ON "ChainCredit"("network", "tokenContract", "txHash", "eventIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_matchedChainCreditId_key" ON "Deposit"("matchedChainCreditId");

-- Amount is the sole reconciliation key for USDT deposit matching, exactly
-- like the existing INR design (see Deposit_live_amount_unique in
-- 20260913172607_add_relay_message_and_amount_reservation) — unique only
-- among LIVE deposits, so two COMPLETED deposits may still legitimately
-- share an amount at different points in time. A SEPARATE index from the
-- INR one: paise and USDT-cents are different unit spaces and must never be
-- allowed to collide with each other. Prisma cannot express a partial index
-- declaratively, hence this hand-written addition (not part of the
-- `prisma migrate diff`-generated SQL above, which stops at what Prisma can
-- express — cross-checked against `prisma migrate diff --from-schema
-- <pre-change schema> --to-schema prisma/schema.prisma --script` to confirm
-- everything else in this file matches Prisma's own output exactly).
CREATE UNIQUE INDEX "Deposit_live_usdt_amount_unique"
  ON "Deposit" ("amountUsdtMinor")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')
    AND "amountUsdtMinor" IS NOT NULL;
