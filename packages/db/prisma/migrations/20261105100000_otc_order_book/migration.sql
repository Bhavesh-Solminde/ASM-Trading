CREATE TYPE "TradeMode" AS ENUM ('LEGACY_BINARY', 'CFD', 'OTC_FIXED');
CREATE TYPE "MarketCommandStatus" AS ENUM ('ACCEPTED', 'APPLIED', 'REJECTED');
ALTER TABLE "Candle" ADD COLUMN "volume" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Trade"
  ADD COLUMN "mode" "TradeMode" NOT NULL DEFAULT 'LEGACY_BINARY',
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "marketCommandId" TEXT,
  ADD COLUMN "entrySequence" BIGINT,
  ADD COLUMN "settlementSequence" BIGINT,
  ADD COLUMN "flowLots" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "filledLots" INTEGER NOT NULL DEFAULT 0;
UPDATE "Trade" SET "mode" = 'CFD' WHERE "durationSec" IS NOT NULL;
CREATE UNIQUE INDEX "Trade_marketCommandId_key" ON "Trade"("marketCommandId");
CREATE UNIQUE INDEX "Trade_accountId_idempotencyKey_key" ON "Trade"("accountId", "idempotencyKey");
CREATE INDEX "Trade_mode_status_expiryTs_idx" ON "Trade"("mode", "status", "expiryTs");

CREATE TABLE "MarketReference" (
 "symbol" TEXT PRIMARY KEY, "price" DOUBLE PRECISION NOT NULL,
 "quoteTime" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL,
 "source" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "minuteBps" DOUBLE PRECISION NOT NULL, "calibration" TEXT NOT NULL,
 "sampleBars" INTEGER NOT NULL, "session" TEXT NOT NULL
);
CREATE TABLE "MarketReferenceAudit" (
 "id" BIGSERIAL PRIMARY KEY, "symbol" TEXT NOT NULL,
 "quoteTime" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL, "payload" JSONB NOT NULL
);
CREATE INDEX "MarketReferenceAudit_symbol_receivedAt_idx" ON "MarketReferenceAudit"("symbol", "receivedAt");
CREATE TABLE "MarketWorldCheckpoint" (
 "id" TEXT PRIMARY KEY, "version" INTEGER NOT NULL, "generation" TEXT NOT NULL,
 "sequence" BIGINT NOT NULL, "state" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MarketCommand" (
 "id" TEXT PRIMARY KEY, "sequence" BIGSERIAL NOT NULL,
 "worldId" TEXT NOT NULL, "accountId" TEXT, "actorId" TEXT, "idempotencyKey" TEXT,
 "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "status" "MarketCommandStatus" NOT NULL DEFAULT 'ACCEPTED', "input" JSONB NOT NULL, "result" JSONB
);
CREATE UNIQUE INDEX "MarketCommand_sequence_key" ON "MarketCommand"("sequence");
CREATE UNIQUE INDEX "MarketCommand_accountId_idempotencyKey_key" ON "MarketCommand"("accountId", "idempotencyKey");
CREATE INDEX "MarketCommand_worldId_sequence_idx" ON "MarketCommand"("worldId", "sequence");
CREATE INDEX "MarketCommand_status_acceptedAt_idx" ON "MarketCommand"("status", "acceptedAt");
