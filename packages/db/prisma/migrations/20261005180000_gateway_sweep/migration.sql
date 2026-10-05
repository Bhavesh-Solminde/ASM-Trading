-- Audit table for the offline Tatum USDT sweep tool
-- (packages/tatum/scripts/sweep.ts). See
-- docs/superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md.

-- CreateEnum
CREATE TYPE "GatewaySweepStatus" AS ENUM ('PENDING', 'GAS_SENT', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "GatewaySweep" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "rawAmount" DECIMAL(78,0) NOT NULL,
    "gasTopUpRaw" DECIMAL(78,0),
    "gasTopUpTxHash" TEXT,
    "sweepTxHash" TEXT,
    "status" "GatewaySweepStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewaySweep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewaySweep_depositId_idx" ON "GatewaySweep"("depositId");

-- CreateIndex
CREATE INDEX "GatewaySweep_network_status_idx" ON "GatewaySweep"("network", "status");

-- AddForeignKey
ALTER TABLE "GatewaySweep" ADD CONSTRAINT "GatewaySweep_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
