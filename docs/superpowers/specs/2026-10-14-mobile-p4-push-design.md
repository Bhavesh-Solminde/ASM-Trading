# Mobile sub-project 4 — push notifications

**Date:** 2026-10-14 · **Overview:** [mobile app overview](2026-10-14-mobile-app-overview-design.md) · **Needs:** [1](2026-10-14-mobile-p1-server-design.md), [2](2026-10-14-mobile-p2-shell-trade-design.md)

## Goal

Notify users about trade results (when away), deposits, withdrawals and KYC,
on Android (FCM) and on the iPhone home-screen app (Web Push), in the user's
language, without ever slowing settlement or payment code.

## Change from the brainstorm

The brainstorm said "Redis list". Because deposit, withdrawal and KYC status
changes happen inside `packages/db` repository transactions called from many
places (admin actions, bank-feed matcher, chain matcher, gateway), the design
uses a **DB outbox** instead: the event row is written in the same
transaction as the status change, so a notification can never be lost or sent
for a change that rolled back. Trade results stay in-process in the engine
(they need presence and grouping there).

## Data (hand-written migration)

```prisma
enum PushPlatform { ANDROID WEBPUSH }

model PushDevice {
  id          String       @id @default(uuid())
  userId      String
  platform    PushPlatform
  token       String       @unique   // FCM token, or WebPush endpoint URL
  p256dh      String?                 // WebPush only
  auth        String?                 // WebPush only
  locale      String       @default("en")
  createdAt   DateTime     @default(now())
  lastSeenAt  DateTime     @default(now())
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model NotificationOutbox {
  id          String    @id @default(uuid())
  userId      String
  kind        String    // deposit_credited | withdrawal_approved | withdrawal_paid | withdrawal_rejected | kyc_verified | kyc_rejected
  payload     Json      // amounts, currency, ids, reason
  createdAt   DateTime  @default(now())
  sentAt      DateTime?
  attempts    Int       @default(0)
  @@index([sentAt, createdAt])
}
```

`User` gains `notifyTrades Boolean @default(true)`, `notifyPayments Boolean
@default(true)`, `notifyAccount Boolean @default(true)`.

## Outbox writers (`packages/db`)

Inside the existing transactions:

| Function | Kind |
|---|---|
| `creditDepositToAccount` (status → COMPLETED) | `deposit_credited` (amount, bonus, currency, depositId) |
| `approveWithdrawal` | `withdrawal_approved` |
| `markWithdrawalPaid` | `withdrawal_paid` (amount, method) |
| `rejectWithdrawal` | `withdrawal_rejected` (reason) |
| `reviewKyc` and the admin Users KYC select (`users/actions.ts`) | `kyc_verified` / `kyc_rejected` (note) |

A helper `enqueueOutbox(tx, userId, kind, payload)` keeps call sites one line.
Reversals (`reverseCompletedDeposit`) do not notify.

## Sender (`packages/notify`, run by the engine)

- `NotificationSender` with two transports:
  - **FCM HTTP v1** using a Firebase service account (`FCM_PROJECT_ID`,
    `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`), OAuth token via `google-auth-library`,
    cached until expiry.
  - **Web Push** via `web-push` with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
    `VAPID_SUBJECT`.
- Message text from `packages/notify/src/messages/{en,hi}.ts` (pure functions
  `(kind, payload) → { title, body, url }`); Android uses the device locale
  column, Web Push always `en`.
- **Outbox worker:** engine loop every 2s claims up to 50 unsent rows
  (`UPDATE … SET attempts = attempts + 1 … RETURNING` with
  `FOR UPDATE SKIP LOCKED`), sends, sets `sentAt`. Rows failing 5 times are
  marked sent with an error log. Category off (`notifyPayments` /
  `notifyAccount`) → marked sent without delivery.
- **Dead tokens:** FCM `UNREGISTERED` / `INVALID_ARGUMENT`, Web Push 404/410 →
  delete the `PushDevice`.
- Retention: sent rows older than 30 days deleted daily.

## Trade results (engine)

In `trade-desk.ts` where `trade:settled` is emitted:

- Skip demo accounts and users with `notifyTrades = false`.
- **Presence:** `server.isUserOnline(userId)` — true if any authed socket for
  that user is open. Online → no push.
- **Grouping:** `TradeResultBatcher` keeps a per-user buffer; first result
  starts a 10s timer; on fire, sends one notification: single trade →
  "EUR/USD trade won +₹180" / "…lost ₹100"; several → "3 trades closed:
  +₹420" (net). Re-checks presence at fire time.
- Batcher is in-memory; an engine restart drops at most 10s of pending result
  pushes (acceptable — results are visible in History).

## Device registration (web routes)

- `POST /api/v1/push/devices` `{ platform, token, p256dh?, auth? }` → upsert
  by token, set `userId` (re-assigns a token that moved accounts), `locale`
  from the user, `lastSeenAt` now.
- `DELETE /api/v1/push/devices` `{ token }` (only the caller's).
- `PATCH /api/v1/account/preferences` gains `notifyTrades`, `notifyPayments`,
  `notifyAccount`; changing `locale` also updates the user's devices.
- `GET /api/v1/push/vapid` → public VAPID key (for the PWA).

## App side

- `expo-notifications` for permission, channel and display; FCM device token
  via `getDevicePushTokenAsync()` (no Expo push service).
- Android channel "Trades", "Payments", "Account" (users can mute per channel
  in system settings too).
- Ask for permission (Android 13+) after the first live trade settles or the
  first deposit is created — never at launch; if denied, a toggle in Account →
  Notifications explains and opens system settings.
- Register on login and on token refresh; delete on logout.
- Tap handling: `url` in data → expo-router (`/history?tx=d:<id>`,
  `/history?tx=w:<id>`, `/history`, `/account/verify`); behind the app lock if
  locked.
- Account → Notifications: three toggles bound to the preferences route.

## PWA side (iPhone)

Covered with the service worker in [sub-project 5](2026-10-14-mobile-p5-pwa-distribution-design.md):
subscription via `PushManager.subscribe` with the VAPID key, sent to the same
devices route with `platform: "WEBPUSH"`.

## Testing

- DB (serial, shared test DB): each writer adds exactly one outbox row in the
  same transaction; rollback leaves none; reversal adds none.
- Sender: claim is exclusive under two concurrent workers; category-off rows
  skipped; dead-token deletion per transport (transports faked); retries cap.
- Messages: en/hi snapshot per kind; currency formatting via `client-core`.
- Engine: batcher groups within 10s, single vs plural text, demo skipped,
  online user skipped, presence re-checked at fire time (fake timers).
- Manual: Android 13+ permission flow, tap → correct History sheet; iOS 16.4+
  installed PWA receives and opens.

## Out of scope

Marketing/broadcast pushes, email/SMS fallbacks, in-app notification inbox.
