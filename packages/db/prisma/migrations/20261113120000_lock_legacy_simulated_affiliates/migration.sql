-- Affiliate Program phase 1: retire the old simulated affiliate feature.
-- Every existing role=AFFILIATE user is a staff-created play-money account.
-- Keep their records for review, but lock them and mark them simulated so no
-- balance, trade or ledger row of theirs is ever treated as real money.

ALTER TABLE "User" ADD COLUMN "legacySimulated" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "legacySimulated" = true,
    "status" = 'BANNED',
    "statusReason" = 'Legacy simulated affiliate account (retired).',
    "statusChangedAt" = NOW()
WHERE "role" = 'AFFILIATE';

DELETE FROM "Session"
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "legacySimulated" = true);
