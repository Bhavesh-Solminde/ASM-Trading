-- USDT on a second network (BNB Smart Chain, BEP-20) next to TRON (TRC-20).
-- Semantically identical to `prisma migrate diff --from-schema <pre-change
-- schema> --to-schema prisma/schema.prisma --script` output; the rawAmount
-- change is written with an explicit USING cast (Prisma emits the equivalent
-- implicit `SET DATA TYPE DECIMAL(78,0)`).
--
-- rawAmount: BIGINT -> NUMERIC(78,0). BSC USDT is 18-decimal, so any amount
-- above ~9.2 USDT overflows int8. NUMERIC(78,0) holds any uint256. The cast
-- from bigint is exact — every existing (6-decimal TRON) row keeps its value.
-- tokenDecimals: existing rows are all TRON USDT (6 decimals), hence DEFAULT 6.
-- ChainScanCursor.lastScannedBlock: EVM block cursor; NULL for TRON rows.
-- Purely additive otherwise; no existing row changes value.

-- AlterTable
ALTER TABLE "ChainCredit" ADD COLUMN     "tokenDecimals" INTEGER NOT NULL DEFAULT 6,
ALTER COLUMN "rawAmount" TYPE NUMERIC(78,0) USING "rawAmount"::numeric(78,0);

-- AlterTable
ALTER TABLE "ChainScanCursor" ADD COLUMN     "lastScannedBlock" BIGINT;
