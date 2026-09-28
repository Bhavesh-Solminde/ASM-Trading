-- CreateTable
CREATE TABLE "HouseTreasury" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "treasuryMinor" INTEGER NOT NULL DEFAULT 0,
    "treasuryTargetMinor" INTEGER NOT NULL DEFAULT 1000000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseTreasury_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row and backfill treasuryMinor from historical HouseDay
-- profits. If HouseDay has never been populated the sum is 0, which is the
-- correct bootstrap starting point.
INSERT INTO "HouseTreasury" ("id", "treasuryMinor", "treasuryTargetMinor", "updatedAt")
SELECT 1,
       COALESCE(SUM("realizedProfitMinor"), 0)::int,
       1000000,
       NOW()
FROM "HouseDay"
ON CONFLICT ("id") DO NOTHING;
