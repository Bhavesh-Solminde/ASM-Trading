-- Admin's reason when a KYC submission is rejected (shown to the user).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycReviewNote" TEXT;
