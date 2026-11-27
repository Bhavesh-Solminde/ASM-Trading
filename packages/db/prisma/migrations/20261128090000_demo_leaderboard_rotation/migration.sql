CREATE TABLE "DemoLeaderboardEntry" (
  "accountId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "pnlInrMinor" INTEGER NOT NULL,
  "stakeInrMinor" INTEGER NOT NULL,
  CONSTRAINT "DemoLeaderboardEntry_pkey" PRIMARY KEY ("accountId"),
  CONSTRAINT "DemoLeaderboardEntry_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DemoLeaderboardEntry_profit_range" CHECK ("pnlInrMinor" > 0 AND "pnlInrMinor" < 1500000),
  CONSTRAINT "DemoLeaderboardEntry_positive_stake" CHECK ("stakeInrMinor" > 0)
);
