-- AlterTable
-- USDT "I already paid" claim: the tx hash a user says paid their deposit.
-- Evidence for admin review only — never a match key, never credits. Nullable
-- and deliberately NOT unique (a tx hash is public; a fraudulent claim must
-- not block the real payer). Purely additive; no existing row changes.
-- Matches `prisma migrate diff --from-schema <pre-change schema> --to-schema
-- prisma/schema.prisma --script` output exactly.
ALTER TABLE "Deposit" ADD COLUMN     "claimedTxHash" TEXT;

-- CreateIndex
CREATE INDEX "Deposit_claimedTxHash_idx" ON "Deposit"("claimedTxHash");
