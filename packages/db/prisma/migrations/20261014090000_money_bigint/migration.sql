-- Widen every money column (minor units: paise / cents / USDT micro-units)
-- from INTEGER to BIGINT. INTEGER tops out at 2,147,483,647 minor units
-- (₹2,14,74,836.47); on 2026-10-14 a demo refund past that ceiling threw
-- "integer out of range" and crash-looped the engine. BIGINT's ceiling is
-- 9.2e18; the app reads these back as JS numbers (exact to 2^53, see
-- packages/db/src/client.ts).
--
-- INTEGER -> BIGINT is lossless, but each ALTER rewrites its table and
-- rebuilds its indexes under an ACCESS EXCLUSIVE lock. "Transaction" (~4.2M
-- rows on 2026-10-14) took ~22s locally; expect a few minutes on the VPS,
-- during which every trade write blocks. Deploy inside a maintenance window
-- (MAINTENANCE_MODE=1, engine stopped) rather than under live traffic.

ALTER TABLE "User"
  ALTER COLUMN "cumulativeDeposits" SET DATA TYPE BIGINT;

ALTER TABLE "Account"
  ALTER COLUMN "realBalance" SET DATA TYPE BIGINT,
  ALTER COLUMN "bonusBalance" SET DATA TYPE BIGINT,
  ALTER COLUMN "turnoverProgress" SET DATA TYPE BIGINT,
  ALTER COLUMN "medianStake" SET DATA TYPE BIGINT,
  ALTER COLUMN "dailyLimit" SET DATA TYPE BIGINT;

ALTER TABLE "Trade"
  ALTER COLUMN "stake" SET DATA TYPE BIGINT,
  ALTER COLUMN "stakeFromBonus" SET DATA TYPE BIGINT,
  ALTER COLUMN "pnl" SET DATA TYPE BIGINT;

ALTER TABLE "HouseDay"
  ALTER COLUMN "targetProfitMinor" SET DATA TYPE BIGINT,
  ALTER COLUMN "realizedProfitMinor" SET DATA TYPE BIGINT,
  ALTER COLUMN "totalStakesMinor" SET DATA TYPE BIGINT,
  ALTER COLUMN "totalPayoutsMinor" SET DATA TYPE BIGINT;

ALTER TABLE "HouseTreasury"
  ALTER COLUMN "treasuryMinor" SET DATA TYPE BIGINT,
  ALTER COLUMN "treasuryTargetMinor" SET DATA TYPE BIGINT;

ALTER TABLE "TradeShadow"
  ALTER COLUMN "exposureUp" SET DATA TYPE BIGINT,
  ALTER COLUMN "exposureDown" SET DATA TYPE BIGINT;

ALTER TABLE "Deposit"
  ALTER COLUMN "amountUsd" SET DATA TYPE BIGINT,
  ALTER COLUMN "amountInr" SET DATA TYPE BIGINT,
  ALTER COLUMN "amountUsdtMinor" SET DATA TYPE BIGINT;

ALTER TABLE "BankCredit"
  ALTER COLUMN "amountInr" SET DATA TYPE BIGINT;

ALTER TABLE "RelayMessage"
  ALTER COLUMN "parsedAmountInr" SET DATA TYPE BIGINT;

ALTER TABLE "ChainCredit"
  ALTER COLUMN "normalizedAmountMinor" SET DATA TYPE BIGINT;

ALTER TABLE "Withdrawal"
  ALTER COLUMN "amount" SET DATA TYPE BIGINT;

ALTER TABLE "Transaction"
  ALTER COLUMN "amount" SET DATA TYPE BIGINT,
  ALTER COLUMN "balanceAfter" SET DATA TYPE BIGINT;

ALTER TABLE "BonusGrant"
  ALTER COLUMN "amount" SET DATA TYPE BIGINT,
  ALTER COLUMN "turnoverRequired" SET DATA TYPE BIGINT,
  ALTER COLUMN "turnoverDone" SET DATA TYPE BIGINT;
