-- Add CURRENCY_CONVERT to TxKind for real cross-currency balance conversions.
ALTER TYPE "TxKind" ADD VALUE IF NOT EXISTS 'CURRENCY_CONVERT';
