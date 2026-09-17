-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "lifecycleOverride" "LifecycleStage";

-- AlterTable
ALTER TABLE "TradeShadow" ADD COLUMN     "wantedWin" BOOLEAN,
ADD COLUMN     "winProbability" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false;
