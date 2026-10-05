-- Tatum payment gateway: per-deposit receiving addresses.
-- See docs/superpowers/specs/2026-10-05-tatum-usdt-gateway-design.md.

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN "gateway" TEXT,
ADD COLUMN "gatewayAddressIndex" INTEGER,
ADD COLUMN "gatewaySubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "GatewayAddressCounter" (
    "network" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayAddressCounter_pkey" PRIMARY KEY ("network")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_gateway_network_gatewayAddressIndex_key" ON "Deposit"("gateway", "network", "gatewayAddressIndex");

-- CreateIndex
CREATE INDEX "Deposit_gateway_network_receivingAddress_idx" ON "Deposit"("gateway", "network", "receivingAddress");

-- Gateway deposits are matched by their own unique address, never by
-- amount, so two users may hold live same-amount gateway deposits at once.
-- Both live-amount reservation indexes are narrowed to legacy (gateway IS
-- NULL) rows; every row that existed before this migration has gateway NULL,
-- so the guarantee for the manual flow is unchanged.
DROP INDEX "Deposit_live_amount_unique";
CREATE UNIQUE INDEX "Deposit_live_amount_unique"
  ON "Deposit" ("amountInr")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')
    AND "gateway" IS NULL;

DROP INDEX "Deposit_live_usdt_amount_unique";
CREATE UNIQUE INDEX "Deposit_live_usdt_amount_unique"
  ON "Deposit" ("amountUsdtMinor")
  WHERE "status" IN ('AWAITING_PAYMENT', 'PENDING_CONFIRMATION')
    AND "amountUsdtMinor" IS NOT NULL
    AND "gateway" IS NULL;
