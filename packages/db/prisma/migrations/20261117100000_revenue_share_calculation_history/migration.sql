-- Each Revenue Share day saves its per-friend inputs, so later closes can replay the
-- carry-forward when a self-referral flag is confirmed or dismissed. The program is
-- unreleased, so RevenueShareDay has no rows yet and the column can be required.
ALTER TABLE "RevenueShareDay" ADD COLUMN "calculation" JSONB NOT NULL;
