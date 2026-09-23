-- Per-user gate for the real-money LIVE account. Default false keeps live
-- trading closed for every existing and new user until granted individually.
ALTER TABLE "User" ADD COLUMN "liveAccess" BOOLEAN NOT NULL DEFAULT false;
