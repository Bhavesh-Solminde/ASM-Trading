-- Set the house-treasury target to ₹3 lakh (30_000_000 paisa) by default and
-- lift any existing singleton row still at the legacy ₹10,000 default so the
-- Growth-Loop Governor's pWin ratio reads correctly on first boot.
ALTER TABLE "HouseTreasury" ALTER COLUMN "treasuryTargetMinor" SET DEFAULT 30000000;
UPDATE "HouseTreasury" SET "treasuryTargetMinor" = 30000000 WHERE id = 1 AND "treasuryTargetMinor" < 30000000;
