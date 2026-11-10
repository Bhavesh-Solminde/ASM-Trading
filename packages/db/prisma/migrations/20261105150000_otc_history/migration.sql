CREATE TABLE "OtcCandle" (
  "worldId" TEXT NOT NULL, "symbol" TEXT NOT NULL, "openTs" TIMESTAMP(3) NOT NULL,
  "o" DOUBLE PRECISION NOT NULL, "h" DOUBLE PRECISION NOT NULL,
  "l" DOUBLE PRECISION NOT NULL, "c" DOUBLE PRECISION NOT NULL, "volume" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "OtcCandle_pkey" PRIMARY KEY ("worldId", "symbol", "openTs")
);
CREATE INDEX "OtcCandle_worldId_openTs_idx" ON "OtcCandle"("worldId", "openTs");
CREATE TABLE "MarketExecution" (
  "worldId" TEXT NOT NULL, "symbol" TEXT NOT NULL, "sequence" BIGINT NOT NULL,
  "time" TIMESTAMP(3) NOT NULL, "price" DOUBLE PRECISION NOT NULL, "quantity" INTEGER NOT NULL,
  "side" TEXT NOT NULL, "makerId" TEXT NOT NULL, "takerId" TEXT NOT NULL,
  CONSTRAINT "MarketExecution_pkey" PRIMARY KEY ("worldId", "symbol", "sequence")
);
CREATE INDEX "MarketExecution_worldId_time_idx" ON "MarketExecution"("worldId", "time");
