-- Phase 7: read-only USDT deposit reconciliation. Purely additive — a brand
-- new table plus its two enums, populated exclusively by
-- runUsdtReconciliation() (see repositories/reconciliation.ts). Nothing else
-- writes to it, and no existing table/column is touched.
--
-- Two unrelated statements that `prisma migrate diff` also reported against
-- the live dev DB (Asset.garchOmega default representation, FraudFlag.
-- linkedUserIds default) are pre-existing drift from before this migration
-- (confirmed via a diff of the last committed schema against the live DB,
-- with none of this migration's changes applied) and are deliberately NOT
-- included here — out of scope for an additive reconciliation-table
-- migration.

-- CreateEnum
CREATE TYPE "ReconciliationSeverity" AS ENUM ('P1', 'WARNING');

-- CreateEnum
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "severity" "ReconciliationSeverity" NOT NULL,
    "network" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationIssue_status_severity_idx" ON "ReconciliationIssue"("status", "severity");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_checkName_idx" ON "ReconciliationIssue"("checkName");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationIssue_checkName_subjectType_subjectId_key" ON "ReconciliationIssue"("checkName", "subjectType", "subjectId");
