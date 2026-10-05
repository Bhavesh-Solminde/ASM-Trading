-- First-withdrawal hold + user-cancel window.
--
-- Adds two enum values and two nullable timestamp columns on Withdrawal.
-- Historical rows keep status unchanged and leave the new columns NULL.

ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'HELD';
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'CANCELLED_BY_USER';

ALTER TABLE "Withdrawal"
  ADD COLUMN IF NOT EXISTS "holdUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelableUntil" TIMESTAMP(3);
