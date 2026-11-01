-- CloseReason enum
CREATE TYPE "CloseReason" AS ENUM ('DURATION', 'STOP_LOSS', 'TAKE_PROFIT', 'MANUAL', 'LIQUIDATION', 'TRAILING_STOP');

-- FeedSource enum
CREATE TYPE "FeedSource" AS ENUM ('BINANCE', 'TWELVE_DATA', 'SYNTHETIC');

-- Add CLOSED to TradeStatus
ALTER TYPE "TradeStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- Trade: CFD columns (all nullable — binary trades unaffected)
ALTER TABLE "Trade" ADD COLUMN "durationSec" INTEGER;
ALTER TABLE "Trade" ADD COLUMN "stopLoss" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "takeProfit" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "trailingPct" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "liqPrice" DOUBLE PRECISION;
ALTER TABLE "Trade" ADD COLUMN "closeReason" "CloseReason";
ALTER TABLE "Trade" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Trade" ADD COLUMN "peakPnl" INTEGER;

-- Asset: spread config and feed source
ALTER TABLE "Asset" ADD COLUMN "spreadBps" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Asset" ADD COLUMN "feedSource" "FeedSource" NOT NULL DEFAULT 'SYNTHETIC';
ALTER TABLE "Asset" ADD COLUMN "marketHours" TEXT;

-- Index for CFD position scanning (open trades per asset)
CREATE INDEX "Trade_assetId_status_idx" ON "Trade"("assetId", "status");

-- Set feed sources for assets with known external feeds
UPDATE "Asset" SET "feedSource" = 'BINANCE' WHERE "symbol" IN ('BTCUSD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT');
UPDATE "Asset" SET "feedSource" = 'TWELVE_DATA' WHERE "symbol" IN ('XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD');

-- Set spread by asset class
UPDATE "Asset" SET "spreadBps" = 5 WHERE "assetClass" = 'CRYPTO';
UPDATE "Asset" SET "spreadBps" = 2 WHERE "assetClass" = 'FOREX';
UPDATE "Asset" SET "spreadBps" = 10 WHERE "assetClass" IN ('INDEX', 'COMMODITY');
UPDATE "Asset" SET "spreadBps" = 5 WHERE "symbol" = 'XAUUSD';
