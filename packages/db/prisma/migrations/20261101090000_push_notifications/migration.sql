-- Push notifications: devices, an outbox written next to payment/KYC status
-- changes, and per-category opt-outs.

CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'WEBPUSH');

CREATE TABLE "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" "PushPlatform" NOT NULL,
  "token" TEXT NOT NULL,
  "p256dh" TEXT,
  "auth" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationOutbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "sentAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationOutbox_sentAt_createdAt_idx" ON "NotificationOutbox"("sentAt", "createdAt");

ALTER TABLE "User"
  ADD COLUMN "notifyTrades" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyPayments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyAccount" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId");
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
