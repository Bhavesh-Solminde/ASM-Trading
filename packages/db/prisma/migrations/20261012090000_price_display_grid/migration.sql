-- Widen the display grid on the seven markets whose price could not move
-- between adjacent display ticks.
--
-- `Asset.precision` is the grid the shown price snaps to: the engine rounds
-- every published price with toFixed(precision) before it reaches the chart
-- (apps/engine/src/assets/registry.ts, `tick` and `record`). It is NOT the
-- settlement granularity — that is `tickSize`, which the algo uses to place a
-- commit at entryPrice ± tickSize (packages/algo/src/resolve.ts). This
-- migration changes only the former; no tickSize is touched, so how far the
-- price must travel to decide a trade is unchanged.
--
-- The problem: one price update is sigma·√TICK_DT_SEC·volScale·price. Divided
-- by the 10^-precision grid, that is how many display steps the price moves
-- every 5 seconds. In the median volatility regime these seven sat between 1.0
-- and 1.9 steps, so the price could only occupy a handful of distinct values
-- and every 1m candle rendered as the same wickless rectangle. The other
-- twelve markets range from 3.2 (USDJPY) to 602 (BTCUSDT) steps and are left
-- alone. One extra decimal puts each of these at 10-18 steps.
--
-- Re-stated in packages/db/prisma/seed.ts so a fresh database matches.

-- Crypto.
UPDATE "Asset" SET "precision" = 3 WHERE "symbol" = 'SOLUSDT'  AND "precision" = 2;  -- 1.8 -> 18 steps
UPDATE "Asset" SET "precision" = 5 WHERE "symbol" = 'XRPUSDT'  AND "precision" = 4;  -- 1.5 -> 15 steps

-- Forex majors. These now quote a sixth decimal; USDJPY keeps 3 (it already
-- moved 3.2 steps per update) so the pairs are deliberately not uniform.
UPDATE "Asset" SET "precision" = 6 WHERE "symbol" = 'AUDUSD' AND "precision" = 5;    -- 1.0 -> 10 steps
UPDATE "Asset" SET "precision" = 6 WHERE "symbol" = 'EURUSD' AND "precision" = 5;    -- 1.2 -> 12 steps
UPDATE "Asset" SET "precision" = 6 WHERE "symbol" = 'GBPUSD' AND "precision" = 5;    -- 1.5 -> 15 steps
UPDATE "Asset" SET "precision" = 6 WHERE "symbol" = 'USDCAD' AND "precision" = 5;    -- 1.4 -> 14 steps
UPDATE "Asset" SET "precision" = 6 WHERE "symbol" = 'USDCHF' AND "precision" = 5;    -- 1.5 -> 15 steps
