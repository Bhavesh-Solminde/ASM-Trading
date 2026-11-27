CREATE TABLE "PlatformSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "kycRequired" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSettings_singleton" CHECK ("id" = 1)
);
