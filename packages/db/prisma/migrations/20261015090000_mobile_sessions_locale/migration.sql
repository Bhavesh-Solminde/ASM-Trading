-- Mobile app: sessions remember which client they were issued to (the app
-- gets a 30-day sliding session, the website keeps 7 days), the device name
-- for a future devices list, and users get a UI/push language.

CREATE TYPE "SessionClient" AS ENUM ('WEB', 'APP');

ALTER TABLE "Session"
  ADD COLUMN "client" "SessionClient" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "deviceName" TEXT;

ALTER TABLE "User"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
