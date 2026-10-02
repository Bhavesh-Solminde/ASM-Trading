-- AlterEnum
-- Terminal status for an on-chain transfer an admin reviewed (MANUAL_REVIEW /
-- UNMATCHED) and marked handled WITHOUT crediting anyone (refunded
-- off-platform, spam/dust, etc.). Purely additive; no existing row changes.
-- Matches `prisma migrate diff --from-schema <pre-change schema> --to-schema
-- prisma/schema.prisma --script` output exactly.
ALTER TYPE "ChainCreditProcessingStatus" ADD VALUE 'DISMISSED';
