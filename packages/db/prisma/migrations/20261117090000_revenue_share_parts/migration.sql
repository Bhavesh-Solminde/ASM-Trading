-- Default Revenue Share for affiliates without an assigned rate (seeded in the next migration:
-- a new enum value can't be used in the transaction that adds it).
ALTER TYPE "ProgramSettingKey" ADD VALUE 'DEFAULT_REVENUE_SHARE_BPS';

-- Up to two REVENUE_SHARE earnings per RevenueShareDay: CLEAN, and FLAGGED (held share from
-- self-referral-flagged friends). Existing Revenue Share earnings are the CLEAN part.
DROP INDEX "ProgramEarning_revenueShareDayId_key";

ALTER TABLE "ProgramEarning" ADD COLUMN     "relatedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revenueSharePart" TEXT;

UPDATE "ProgramEarning" SET "revenueSharePart" = 'CLEAN' WHERE "revenueShareDayId" IS NOT NULL;

CREATE UNIQUE INDEX "ProgramEarning_revenueShareDayId_revenueSharePart_key" ON "ProgramEarning"("revenueShareDayId", "revenueSharePart");
