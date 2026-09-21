-- Default new accounts to INR (denomination toggle keeps existing rows as-is).
ALTER TABLE "Account" ALTER COLUMN "currency" SET DEFAULT 'INR';
