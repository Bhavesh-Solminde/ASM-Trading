CREATE TABLE "MarketReferencePoll" (
  "group" TEXT NOT NULL, "attemptedAt" TIMESTAMP(3) NOT NULL,
  "nextDueAt" TIMESTAMP(3) NOT NULL, "failures" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MarketReferencePoll_pkey" PRIMARY KEY ("group")
);
