-- An admin release of a HELD earning wins over the automatic hold re-check at the daily close.
ALTER TABLE "ProgramEarning" ADD COLUMN "adminReleasedAt" TIMESTAMP(3);
