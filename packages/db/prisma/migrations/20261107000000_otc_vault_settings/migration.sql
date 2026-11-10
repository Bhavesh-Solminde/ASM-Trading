CREATE TABLE "OtcVaultSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "dailyTargetMinor" BIGINT NOT NULL,
  CONSTRAINT "OtcVaultSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OtcVaultSettings_singleton" CHECK ("id" = 1),
  CONSTRAINT "OtcVaultSettings_target_range" CHECK ("dailyTargetMinor" BETWEEN 1 AND 99999999999999)
);
