ALTER TABLE "Trade" ADD COLUMN "leverage" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_leverage_positive" CHECK ("leverage" > 0);
