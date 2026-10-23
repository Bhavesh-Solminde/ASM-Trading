-- Per-asset engine state that must survive a container restart so the shown
-- price stays continuous across deploys. Currently just the GapTracker gap
-- (shown = real × (1 + gap)); when this reset to 0 on restart the chart
-- stepped by the full gap value on the first post-restart tick.
CREATE TABLE "EngineAssetState" (
  "symbol"    TEXT NOT NULL,
  "gap"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineAssetState_pkey" PRIMARY KEY ("symbol")
);
