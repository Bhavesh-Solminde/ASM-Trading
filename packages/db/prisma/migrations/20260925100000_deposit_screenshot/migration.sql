-- Optional user-submitted proof of payment on a Deposit. Data URL, capped in
-- the app layer at ~450KB. Nullable — most deposits never carry one.
ALTER TABLE "Deposit" ADD COLUMN "screenshotUrl" TEXT;
