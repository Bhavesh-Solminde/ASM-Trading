-- KYC documents (Aadhaar front/back, PAN, selfie) + PAN number + submit time,
-- and the Google account link for "Continue with Google".

-- CreateEnum
CREATE TYPE "KycDocumentKind" AS ENUM ('AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'SELFIE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pan" TEXT,
ADD COLUMN     "kycSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "googleSub" TEXT;

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "KycDocumentKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_userId_kind_key" ON "KycDocument"("userId", "kind");

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
