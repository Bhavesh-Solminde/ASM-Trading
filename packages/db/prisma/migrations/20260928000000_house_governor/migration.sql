CREATE TYPE "TradeVerdict" AS ENUM ('WIN', 'LOSS', 'HONEST');
CREATE TYPE "PathStyle" AS ENUM ('DIRECT', 'OSCILLATE', 'FEINT');

ALTER TABLE "Trade"
  ADD COLUMN "verdict"     "TradeVerdict",
  ADD COLUMN "pathStyle"   "PathStyle",
  ADD COLUMN "targetPrice" DOUBLE PRECISION;

CREATE TABLE "HouseDay" (
  "date"                DATE      NOT NULL,
  "targetProfitMinor"   INTEGER   NOT NULL,
  "realizedProfitMinor" INTEGER   NOT NULL DEFAULT 0,
  "totalStakesMinor"    INTEGER   NOT NULL DEFAULT 0,
  "totalPayoutsMinor"   INTEGER   NOT NULL DEFAULT 0,
  "tradesSettled"       INTEGER   NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP NOT NULL,
  CONSTRAINT "HouseDay_pkey" PRIMARY KEY ("date")
);
