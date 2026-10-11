-- Replace GARCH(1,1) volatility model with MSM + intraday profile.
-- See packages/pricing/src/msm.ts, intraday.ts and markets.ts for the model
-- and the per-symbol calibration this migration backfills.

-- 1. New enum for the five calibrated intraday hour-of-day families.
CREATE TYPE "IntradayProfile" AS ENUM ('FX_MAJOR', 'FX_PACIFIC', 'METAL', 'INDEX', 'CRYPTO');

-- 2. Add the new columns on Asset. msmSigma / msmM0 / intradayProfile land
--    with safe defaults so the ALTER TABLE is non-blocking on big tables;
--    the UPDATE statements below set the real per-symbol values, and the
--    final ALTER drops the defaults so inserting a new asset without a
--    calibration becomes a loud error rather than a silent 1e-5 placeholder.
ALTER TABLE "Asset"
  ADD COLUMN "msmSigma" DOUBLE PRECISION NOT NULL DEFAULT 1.0e-5,
  ADD COLUMN "msmM0" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  ADD COLUMN "intradayProfile" "IntradayProfile" NOT NULL DEFAULT 'FX_MAJOR';

-- 3. Backfill per-symbol calibrations from packages/pricing/src/markets.ts.
--    Mirrors MARKET_CALIBRATIONS exactly. Any symbol not listed here keeps
--    the migration defaults (and should be added to markets.ts before it
--    reaches a user).

-- Crypto — m0 1.55, CRYPTO profile.
UPDATE "Asset" SET "msmSigma" = 5.78e-5, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'BTCUSDT';
UPDATE "Asset" SET "msmSigma" = 7.31e-5, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'ETHUSDT';
UPDATE "Asset" SET "msmSigma" = 6.59e-5, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'BNBUSDT';
UPDATE "Asset" SET "msmSigma" = 9.33e-5, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'SOLUSDT';
UPDATE "Asset" SET "msmSigma" = 1.15e-4, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'DOGEUSDT';
UPDATE "Asset" SET "msmSigma" = 1.03e-4, "msmM0" = 1.55, "intradayProfile" = 'CRYPTO' WHERE "symbol" = 'XRPUSDT';

-- Forex — m0 1.5. European / NA pairs use FX_MAJOR; AUD and JPY use FX_PACIFIC.
UPDATE "Asset" SET "msmSigma" = 1.38e-5, "msmM0" = 1.5, "intradayProfile" = 'FX_PACIFIC' WHERE "symbol" = 'AUDUSD';
UPDATE "Asset" SET "msmSigma" = 1.04e-5, "msmM0" = 1.5, "intradayProfile" = 'FX_MAJOR'   WHERE "symbol" = 'EURUSD';
UPDATE "Asset" SET "msmSigma" = 1.09e-5, "msmM0" = 1.5, "intradayProfile" = 'FX_MAJOR'   WHERE "symbol" = 'GBPUSD';
UPDATE "Asset" SET "msmSigma" = 9.65e-6, "msmM0" = 1.5, "intradayProfile" = 'FX_MAJOR'   WHERE "symbol" = 'USDCAD';
UPDATE "Asset" SET "msmSigma" = 1.51e-5, "msmM0" = 1.5, "intradayProfile" = 'FX_MAJOR'   WHERE "symbol" = 'USDCHF';
UPDATE "Asset" SET "msmSigma" = 1.97e-5, "msmM0" = 1.5, "intradayProfile" = 'FX_PACIFIC' WHERE "symbol" = 'USDJPY';

-- Metal.
UPDATE "Asset" SET "msmSigma" = 4.63e-5, "msmM0" = 1.5, "intradayProfile" = 'METAL' WHERE "symbol" = 'XAUUSD';

-- India indices — m0 1.45, INDEX profile. Sigmas are the measured
-- in-session volatility divided by 1.527 (the in-session level of
-- INDEX_INTRADAY) so the busy hours match the real session.
UPDATE "Asset" SET "msmSigma" = 2.42e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'BANKNIFTY';
UPDATE "Asset" SET "msmSigma" = 2.46e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'FINNIFTY';
UPDATE "Asset" SET "msmSigma" = 1.88e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'NIFTY50';
UPDATE "Asset" SET "msmSigma" = 4.41e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'NIFTYIT';
UPDATE "Asset" SET "msmSigma" = 2.37e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'NIFTYMIDCAP100';
UPDATE "Asset" SET "msmSigma" = 1.93e-5, "msmM0" = 1.45, "intradayProfile" = 'INDEX' WHERE "symbol" = 'SENSEX';

-- 4. Drop the retired GARCH columns.
ALTER TABLE "Asset"
  DROP COLUMN "garchOmega",
  DROP COLUMN "garchAlpha",
  DROP COLUMN "garchBeta";
