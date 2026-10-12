-- Group the catalogue into asset classes so the trade UI's market picker can
-- offer Forex / Crypto / Commodities / Indices tabs. Presentational only —
-- nothing in pricing, settlement or the engine reads this column.

-- 1. The four classes our catalogue spans today.
CREATE TYPE "AssetClass" AS ENUM ('FOREX', 'CRYPTO', 'COMMODITY', 'INDEX');

-- 2. Add the column with a FOREX default so the ALTER TABLE is non-blocking;
--    the UPDATEs below set the real value per symbol. The default stays so a
--    new market inserted without a class lands somewhere sensible rather than
--    failing — the seed is still the source of truth (packages/db/prisma/seed.ts).
ALTER TABLE "Asset"
  ADD COLUMN "assetClass" "AssetClass" NOT NULL DEFAULT 'FOREX';

-- 3. Backfill. Mirrors the MARKETS table in packages/db/prisma/seed.ts.
UPDATE "Asset" SET "assetClass" = 'CRYPTO'
  WHERE "symbol" IN ('BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'BTCUSD');

UPDATE "Asset" SET "assetClass" = 'FOREX'
  WHERE "symbol" IN ('EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'AUDNZD_OTC', 'EURUSD_OTC');

UPDATE "Asset" SET "assetClass" = 'COMMODITY'
  WHERE "symbol" IN ('XAUUSD');

UPDATE "Asset" SET "assetClass" = 'INDEX'
  WHERE "symbol" IN ('NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'NIFTYIT', 'NIFTYMIDCAP100');
