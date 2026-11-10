# Mobile P4 — Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push notifications for trade results (when the user is away), deposit credited, withdrawal approved/paid/rejected and KYC decisions — to Android (FCM) and the iPhone home-screen app (Web Push) — in the user's language, never slowing settlement or payment code.

**Architecture:** Payment and KYC status changes write a `NotificationOutbox` row next to their existing audit-log write. A sender worker inside the always-running engine claims unsent rows (`FOR UPDATE SKIP LOCKED`), renders text with pure message functions, and delivers through two transports. Trade results never touch the outbox: the engine wraps its WebSocket notifier, intercepts `trade:settled`, and a per-user batcher sends one grouped push 10s later if the user has no live socket. Devices register through web routes.

**Tech Stack:** Prisma (hand-written migration), new `packages/notify` (`google-auth-library` for FCM HTTP v1, `web-push`), engine (`apps/engine`), Next.js routes (`apps/web`), `expo-notifications` (`apps/mobile`).

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-p4-push-design.md` · **Needs:** P1 and P2 merged.

## Global Constraints

- Outbox kinds: `deposit_credited`, `withdrawal_approved`, `withdrawal_paid`, `withdrawal_rejected`, `kyc_verified`, `kyc_rejected`. Reversals do not notify.
- Categories and user flags: Trades → `notifyTrades`, Payments (`deposit_*`, `withdrawal_*`) → `notifyPayments`, Account (`kyc_*`) → `notifyAccount`. All default `true`.
- Trade results: live accounts only (never `DEMO`), never bot users, only when the user has **no** authed engine socket at send time, grouped per user within **10 s**.
- Worker: every **2 s**, claims ≤ **50** rows, a claim lease of **60 s**, max **5** attempts (then marked sent and logged), sent rows deleted after **30 days**.
- Dead tokens deleted: FCM `UNREGISTERED` (404) or `INVALID_ARGUMENT` on the token; Web Push HTTP 404/410.
- Android text in the device's `locale` (`en`/`hi`); Web Push always `en`.
- Tap targets: payments → `/history?tx=d:<id>` / `/history?tx=w:<id>`, trades → `/history`, KYC → `/account/verify`.
- Android channels: `trades`, `payments`, `account`.
- App asks for notification permission (Android 13+) after the first live trade settles or the first deposit is created — never at launch.
- Env: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Missing FCM or VAPID env disables that transport (logged once), it never crashes the engine.
- Migrations hand-written; never `prisma format`. DB tests serial, rows cleaned in `afterAll`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` + `migrations/20261020090000_push_notifications/` | `PushPlatform`, `PushDevice`, `NotificationOutbox`, user notify flags |
| `packages/db/src/repositories/notifications.ts` | `enqueueOutbox`, device upsert/delete, claim/mark/prune, prefs |
| `packages/db/src/repositories/{deposit,withdrawal,profile}.ts`, `apps/web/src/app/admin/(console)/users/actions.ts` | outbox writes |
| `packages/notify/src/messages.ts` | `(kind, payload, locale) → { title, body, url, channel }` |
| `packages/notify/src/fcm.ts`, `webpush.ts` | transports |
| `packages/notify/src/sender.ts` | device fan-out + dead-token cleanup |
| `packages/notify/src/outbox-worker.ts` | claim → send → mark loop |
| `apps/engine/src/push/trade-results.ts` | presence-aware batcher + notifier decorator |
| `apps/engine/src/server.ts` | `isUserOnline` |
| `apps/engine/src/main.ts` | wire worker + decorator |
| `apps/web/src/app/api/v1/push/{devices,vapid}/route.ts` | device registration, VAPID key |
| `apps/web/src/app/api/v1/account/preferences/route.ts` | + notify flags |
| `apps/mobile/src/push/*`, `apps/mobile/app/(tabs)/account/notifications.tsx` | app side |

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261020090000_push_notifications/migration.sql`

**Interfaces:**
- Produces Prisma models `PushDevice`, `NotificationOutbox`; enum `PushPlatform { ANDROID WEBPUSH }`; `User.notifyTrades/notifyPayments/notifyAccount: boolean`, `User.pushDevices` relation.

- [ ] **Step 1: Edit the schema by hand**

Add:

```prisma
enum PushPlatform {
  ANDROID
  WEBPUSH
}

model PushDevice {
  id         String       @id @default(uuid())
  userId     String
  platform   PushPlatform
  /// FCM registration token, or the Web Push endpoint URL.
  token      String       @unique
  p256dh     String?
  auth       String?
  locale     String       @default("en")
  createdAt  DateTime     @default(now())
  lastSeenAt DateTime     @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// Written next to a payment/KYC status change; drained by the engine's sender.
model NotificationOutbox {
  id        String    @id @default(uuid())
  userId    String
  kind      String
  payload   Json
  createdAt DateTime  @default(now())
  claimedAt DateTime?
  sentAt    DateTime?
  attempts  Int       @default(0)

  @@index([sentAt, createdAt])
}
```

In `model User` add, after `locale`:

```prisma
  notifyTrades       Boolean    @default(true)
  notifyPayments     Boolean    @default(true)
  notifyAccount      Boolean    @default(true)
```

and in the relations block `pushDevices    PushDevice[]`.

- [ ] **Step 2: Migration SQL**

```sql
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
  "sentAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationOutbox_sentAt_createdAt_idx" ON "NotificationOutbox"("sentAt", "createdAt");

ALTER TABLE "User"
  ADD COLUMN "notifyTrades" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyPayments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyAccount" BOOLEAN NOT NULL DEFAULT true;
```

Copy the timestamp type (`TIMESTAMP(3)`) and FK naming from an existing migration in the folder to match Prisma's style exactly.

- [ ] **Step 3: Apply, diff, commit**

```bash
cd packages/db && pnpm exec dotenv -e ../../.env -- prisma migrate deploy && pnpm generate
pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```
Expected: migration applied; diff shows only the known pre-existing drift.

```bash
git add packages/db/prisma
git commit -m "feat(db): push devices, notification outbox, notify flags"
```

---

### Task 2: Notification repository and outbox writers

**Files:**
- Create: `packages/db/src/repositories/notifications.ts`, `notifications.test.ts`
- Modify: `packages/db/src/repositories/deposit.ts` (`creditDepositToAccount`), `withdrawal.ts` (`approveWithdrawal`, `markWithdrawalPaid`, `rejectWithdrawal`), `profile.ts` (`reviewKyc`), `packages/db/src/index.ts`
- Modify: `apps/web/src/app/admin/(console)/users/actions.ts`

**Interfaces:**
- Produces:
  - `type OutboxKind = "deposit_credited" | "withdrawal_approved" | "withdrawal_paid" | "withdrawal_rejected" | "kyc_verified" | "kyc_rejected"`
  - `enqueueOutbox(db: Prisma.TransactionClient | typeof prisma, userId: string, kind: OutboxKind, payload: Record<string, unknown>): Promise<void>`
  - `upsertPushDevice(input: { userId: string; platform: "ANDROID" | "WEBPUSH"; token: string; p256dh?: string | null; auth?: string | null }): Promise<void>` (locale copied from the user)
  - `deletePushDevice(userId: string, token: string): Promise<number>`, `deletePushDeviceByToken(token: string): Promise<void>`
  - `listPushDevices(userId: string): Promise<PushDevice[]>`
  - `claimOutbox(limit: number, leaseMs: number): Promise<NotificationOutbox[]>`, `markOutboxSent(ids: string[]): Promise<void>`, `pruneOutbox(olderThan: Date): Promise<number>`
  - `notifyPrefs(userId: string): Promise<{ notifyTrades: boolean; notifyPayments: boolean; notifyAccount: boolean; isBot: boolean }>`
  - `setNotifyPrefs(userId: string, prefs: Partial<{ notifyTrades: boolean; notifyPayments: boolean; notifyAccount: boolean }>): Promise<void>`
  - `liveAccountCurrencies(ids: string[]): Promise<Map<string, string>>` (account id → currency, LIVE accounts only)

- [ ] **Step 1: Failing tests**

`packages/db/src/repositories/notifications.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { reviewKyc } from "./profile";
import { claimOutbox, deletePushDevice, enqueueOutbox, listPushDevices, markOutboxSent, upsertPushDevice } from "./notifications";

let userId = "";
let adminId = "";

beforeAll(async () => {
  const [u, a] = await Promise.all([
    prisma.user.create({ data: { email: `notif-${randomUUID()}@test.local`, passwordHash: "x", locale: "hi", kycStatus: "PENDING" } }),
    prisma.user.create({ data: { email: `notif-admin-${randomUUID()}@test.local`, passwordHash: "x", role: "ADMIN" } }),
  ]);
  userId = u.id;
  adminId = a.id;
});

afterAll(async () => {
  await prisma.notificationOutbox.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  await prisma.$disconnect();
});

describe("push devices", () => {
  it("stores a device with the user's language and moves a reused token to the new user", async () => {
    await upsertPushDevice({ userId, platform: "ANDROID", token: `fcm-${userId}` });
    const [device] = await listPushDevices(userId);
    expect(device).toMatchObject({ platform: "ANDROID", locale: "hi" });
    expect(await deletePushDevice(userId, `fcm-${userId}`)).toBe(1);
  });
});

describe("outbox", () => {
  it("records a KYC decision in the outbox together with the status change", async () => {
    await reviewKyc({ userId, decision: "VERIFIED", adminId });
    const rows = await prisma.notificationOutbox.findMany({ where: { userId } });
    expect(rows.map((r) => r.kind)).toEqual(["kyc_verified"]);
  });

  it("writes nothing when the status change is refused", async () => {
    await expect(reviewKyc({ userId, decision: "REJECTED", adminId })).rejects.toThrow();
    expect(await prisma.notificationOutbox.count({ where: { userId, kind: "kyc_rejected" } })).toBe(0);
  });

  it("hands each row to one claimer until its lease runs out", async () => {
    await enqueueOutbox(prisma, userId, "deposit_credited", { amountMinor: 100_000, currency: "INR", depositId: "d1" });
    const first = await claimOutbox(50, 60_000);
    const second = await claimOutbox(50, 60_000);
    const mine = first.filter((r) => r.userId === userId);
    expect(mine.length).toBeGreaterThan(0);
    expect(second.filter((r) => r.userId === userId)).toEqual([]);
    await markOutboxSent(mine.map((r) => r.id));
    expect(await prisma.notificationOutbox.count({ where: { userId, sentAt: null } })).toBe(0);
  });
});
```

Run: `pnpm --filter @asm/db test -- notifications` → FAIL.

- [ ] **Step 2: Implement the repository**

```ts
import type { NotificationOutbox, Prisma, PushDevice } from "@prisma/client";
import { prisma } from "../client";

export type OutboxKind =
  | "deposit_credited"
  | "withdrawal_approved"
  | "withdrawal_paid"
  | "withdrawal_rejected"
  | "kyc_verified"
  | "kyc_rejected";

type Db = Prisma.TransactionClient | typeof prisma;

/** Call inside the same transaction as the status change it announces. */
export async function enqueueOutbox(db: Db, userId: string, kind: OutboxKind, payload: Record<string, unknown>): Promise<void> {
  await db.notificationOutbox.create({ data: { userId, kind, payload: payload as Prisma.InputJsonValue } });
}

export async function upsertPushDevice(input: {
  userId: string;
  platform: "ANDROID" | "WEBPUSH";
  token: string;
  p256dh?: string | null;
  auth?: string | null;
}): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { locale: true } });
  const data = {
    userId: input.userId,
    platform: input.platform,
    p256dh: input.p256dh ?? null,
    auth: input.auth ?? null,
    locale: user.locale,
    lastSeenAt: new Date(),
  };
  await prisma.pushDevice.upsert({ where: { token: input.token }, create: { ...data, token: input.token }, update: data });
}

export async function deletePushDevice(userId: string, token: string): Promise<number> {
  return (await prisma.pushDevice.deleteMany({ where: { userId, token } })).count;
}

export async function deletePushDeviceByToken(token: string): Promise<void> {
  await prisma.pushDevice.deleteMany({ where: { token } });
}

export function listPushDevices(userId: string): Promise<PushDevice[]> {
  return prisma.pushDevice.findMany({ where: { userId } });
}

/** Leases up to `limit` unsent rows; a row whose lease expired is claimable again. */
export async function claimOutbox(limit: number, leaseMs: number): Promise<NotificationOutbox[]> {
  return prisma.$queryRaw<NotificationOutbox[]>`
    UPDATE "NotificationOutbox"
       SET "attempts" = "attempts" + 1, "claimedAt" = now()
     WHERE "id" IN (
       SELECT "id" FROM "NotificationOutbox"
        WHERE "sentAt" IS NULL
          AND ("claimedAt" IS NULL OR "claimedAt" < now() - (${leaseMs} * interval '1 millisecond'))
        ORDER BY "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

export async function markOutboxSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.notificationOutbox.updateMany({ where: { id: { in: ids } }, data: { sentAt: new Date() } });
}

export async function pruneOutbox(olderThan: Date): Promise<number> {
  return (await prisma.notificationOutbox.deleteMany({ where: { sentAt: { lt: olderThan } } })).count;
}

export async function notifyPrefs(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { notifyTrades: true, notifyPayments: true, notifyAccount: true, isBot: true },
  });
}

export async function setNotifyPrefs(
  userId: string,
  prefs: Partial<{ notifyTrades: boolean; notifyPayments: boolean; notifyAccount: boolean }>,
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: prefs });
}

export async function liveAccountCurrencies(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.account.findMany({ where: { id: { in: ids }, type: "LIVE" }, select: { id: true, currency: true } });
  return new Map(rows.map((r) => [r.id, r.currency]));
}
```

Export all of these (and `OutboxKind`) from `packages/db/src/index.ts`. Match how the index exports Prisma model types (`PushDevice`, `NotificationOutbox`) — follow the existing pattern for `Deposit`.

- [ ] **Step 3: Writers**

1. `reviewKyc` — inside its `$transaction`, after the audit log:
   ```ts
   await enqueueOutbox(tx, input.userId, input.decision === "VERIFIED" ? "kyc_verified" : "kyc_rejected", note ? { note } : {});
   ```
2. `creditDepositToAccount` — inside its `$transaction`, right after the `tx.auditLog.create` that records `status: "COMPLETED"`:
   ```ts
   await enqueueOutbox(tx, deposit.userId, "deposit_credited", {
     depositId: deposit.id,
     amountMinor: credit,
     bonusMinor: bonus,
     currency: liveCurrency,
   });
   ```
   Use the variable names that function actually has for the credited amount, bonus and account currency (read the surrounding code; the audit log already references `credit`/`bonus`).
3. `approveWithdrawal`, `markWithdrawalPaid`, `rejectWithdrawal` — these write the status with `updateMany` and then the audit log without a transaction. Wrap each pair (status `updateMany` + audit log + outbox) in `prisma.$transaction(async (tx) => { … })`, keeping the `count !== 1` early return/throw behaviour identical, and add:
   ```ts
   await enqueueOutbox(tx, w.userId, "withdrawal_paid", { withdrawalId: w.id, amountMinor: w.amount, currency: w.currency, method: w.method });
   ```
   (`withdrawal_approved` / `withdrawal_rejected` with `reason` for reject). Load `userId`, amount, currency and method from the row (`tx.withdrawal.findUniqueOrThrow`) after the claim succeeds. `rejectWithdrawal` already runs in a transaction (it refunds) — add the outbox write inside it.
4. `apps/web/src/app/admin/(console)/users/actions.ts` — where an admin changes `kycStatus` from the Users page: if the new status is `VERIFIED` or `REJECTED` and differs from `before.kycStatus`, call `enqueueOutbox(tx ?? prisma, userId, …)` in the same transaction as the update (if the action uses `prisma.$transaction`, pass `tx`; otherwise wrap the update + audit log + outbox in one).

Add one test per writer to the existing repository test files (`deposit.test.ts` / `withdrawal.test.ts`): after the operation, `prisma.notificationOutbox.count({ where: { userId, kind } })` is 1; for `reverseCompletedDeposit` the count of new rows is 0. Reuse those files' existing fixtures (KYC-verified users etc.).

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @asm/db test && pnpm --filter @asm/web exec vitest run src/app/admin` → PASS.

```bash
git add packages/db apps/web/src/app/admin
git commit -m "feat(db): notification outbox written with payment and KYC changes"
```

---

### Task 3: `packages/notify` — messages

**Files:**
- Create: `packages/notify/package.json`, `tsconfig.json`, `src/index.ts`, `src/messages.ts`, `src/messages.test.ts`

**Interfaces:**
- Consumes: `formatMinor` (`@asm/client-core`).
- Produces:
  - `type Channel = "trades" | "payments" | "account"`
  - `interface PushMessage { title: string; body: string; url: string; channel: Channel }`
  - `outboxMessage(kind: OutboxKind, payload: Record<string, unknown>, locale: "en" | "hi"): PushMessage`
  - `tradeResultsMessage(results: { symbol: string; pnl: number; stake: number; currency: string }[], locale): PushMessage`
  - `channelFor(kind: OutboxKind): Channel`

- [ ] **Step 1: Package**

`packages/notify/package.json`:

```json
{
  "name": "@asm/notify",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@asm/client-core": "workspace:*",
    "@asm/db": "workspace:*",
    "@asm/logger": "workspace:*",
    "google-auth-library": "10.5.0",
    "web-push": "3.6.7"
  },
  "devDependencies": { "@types/web-push": "3.6.4" }
}
```

`tsconfig.json`: copy `packages/logger/tsconfig.json`.

- [ ] **Step 2: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { outboxMessage, tradeResultsMessage } from "./messages";

describe("outboxMessage", () => {
  it("announces a credited deposit with its bonus and links to its timeline", () => {
    const m = outboxMessage("deposit_credited", { depositId: "d1", amountMinor: 200_000, bonusMinor: 200_000, currency: "INR" }, "en");
    expect(m).toEqual({
      title: "Deposit credited",
      body: "₹2,000 added to your balance (+₹2,000 bonus)",
      url: "/history?tx=d:d1",
      channel: "payments",
    });
  });
  it("speaks Hindi when the device is set to Hindi", () => {
    const m = outboxMessage("withdrawal_paid", { withdrawalId: "w1", amountMinor: 500_000, currency: "INR", method: "UPI" }, "hi");
    expect(m.title).toBe("निकासी भेज दी गई");
    expect(m.url).toBe("/history?tx=w:w1");
  });
  it("includes the rejection reason", () => {
    expect(outboxMessage("withdrawal_rejected", { withdrawalId: "w1", amountMinor: 70_000, currency: "INR", reason: "Name mismatch" }, "en").body).toContain(
      "Name mismatch",
    );
  });
  it("sends KYC decisions to the verify screen", () => {
    expect(outboxMessage("kyc_verified", {}, "en")).toMatchObject({ url: "/account/verify", channel: "account" });
  });
});

describe("tradeResultsMessage", () => {
  it("names the market and result for a single trade", () => {
    expect(tradeResultsMessage([{ symbol: "EURUSD", pnl: 18_000, stake: 10_000, currency: "INR" }], "en").body).toBe("EUR/USD trade won +₹180");
  });
  it("sums several trades into one line", () => {
    const m = tradeResultsMessage(
      [
        { symbol: "EURUSD", pnl: 18_000, stake: 10_000, currency: "INR" },
        { symbol: "BTCUSD", pnl: -10_000, stake: 10_000, currency: "INR" },
        { symbol: "NIFTY50", pnl: 34_000, stake: 20_000, currency: "INR" },
      ],
      "en",
    );
    expect(m).toMatchObject({ title: "Trades closed", body: "3 trades closed: +₹420", url: "/history", channel: "trades" });
  });
});
```

Check `formatMinor` output for `200_000` INR (expected "₹2,000" — if it renders "₹2,000.00", update the expected strings to the real format; the messages must use the same formatter as the app).

- [ ] **Step 3: Implement `messages.ts`**

```ts
import { formatMinor } from "@asm/client-core";
import type { OutboxKind } from "@asm/db";

export type Channel = "trades" | "payments" | "account";
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  channel: Channel;
}
type Locale = "en" | "hi";

const S = {
  en: {
    depositTitle: "Deposit credited",
    deposit: (a: string, b: string | null) => `${a} added to your balance${b ? ` (+${b} bonus)` : ""}`,
    approvedTitle: "Withdrawal approved",
    approved: (a: string) => `Your withdrawal of ${a} is approved and on its way`,
    paidTitle: "Withdrawal paid",
    paid: (a: string, m: string) => `${a} paid to your ${m}`,
    rejectedTitle: "Withdrawal rejected",
    rejected: (a: string, r: string) => `Your withdrawal of ${a} was rejected: ${r}. The amount is back in your balance.`,
    kycOkTitle: "Identity verified",
    kycOk: "Withdrawals are unlocked.",
    kycNoTitle: "KYC needs another look",
    kycNo: (r: string | null) => (r ? `Reason: ${r}` : "Open the app to see what to fix."),
    tradesTitle: "Trades closed",
    one: (pair: string, won: boolean, a: string) => `${pair} trade ${won ? "won" : "lost"} ${won ? "+" : ""}${a}`,
    many: (n: number, net: string) => `${n} trades closed: ${net}`,
  },
  hi: {
    depositTitle: "जमा हो गया",
    deposit: (a: string, b: string | null) => `${a} आपके बैलेंस में जोड़ दिए गए${b ? ` (+${b} बोनस)` : ""}`,
    approvedTitle: "निकासी मंज़ूर",
    approved: (a: string) => `${a} की आपकी निकासी मंज़ूर हो गई है`,
    paidTitle: "निकासी भेज दी गई",
    paid: (a: string, m: string) => `${a} आपके ${m} पर भेज दिए गए`,
    rejectedTitle: "निकासी अस्वीकार",
    rejected: (a: string, r: string) => `${a} की निकासी अस्वीकार हुई: ${r}। राशि आपके बैलेंस में वापस है।`,
    kycOkTitle: "पहचान सत्यापित",
    kycOk: "अब आप निकासी कर सकते हैं।",
    kycNoTitle: "KYC दोबारा जाँचें",
    kycNo: (r: string | null) => (r ? `कारण: ${r}` : "क्या ठीक करना है, यह ऐप में देखें।"),
    tradesTitle: "ट्रेड बंद हुए",
    one: (pair: string, won: boolean, a: string) => `${pair} ट्रेड ${won ? "जीता" : "हारा"} ${won ? "+" : ""}${a}`,
    many: (n: number, net: string) => `${n} ट्रेड बंद: ${net}`,
  },
} as const;

const METHOD: Record<string, string> = { UPI: "UPI", BANK: "bank account", USDT: "USDT wallet" };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const pair = (symbol: string) => (symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol);

export function channelFor(kind: OutboxKind): Channel {
  return kind.startsWith("kyc_") ? "account" : "payments";
}

export function outboxMessage(kind: OutboxKind, p: Record<string, unknown>, locale: Locale): PushMessage {
  const s = S[locale];
  const money = (k: string) => formatMinor(num(p[k]), str(p.currency) || "INR");
  switch (kind) {
    case "deposit_credited":
      return {
        title: s.depositTitle,
        body: s.deposit(money("amountMinor"), num(p.bonusMinor) > 0 ? money("bonusMinor") : null),
        url: `/history?tx=d:${str(p.depositId)}`,
        channel: "payments",
      };
    case "withdrawal_approved":
      return { title: s.approvedTitle, body: s.approved(money("amountMinor")), url: `/history?tx=w:${str(p.withdrawalId)}`, channel: "payments" };
    case "withdrawal_paid":
      return {
        title: s.paidTitle,
        body: s.paid(money("amountMinor"), METHOD[str(p.method)] ?? str(p.method)),
        url: `/history?tx=w:${str(p.withdrawalId)}`,
        channel: "payments",
      };
    case "withdrawal_rejected":
      return {
        title: s.rejectedTitle,
        body: s.rejected(money("amountMinor"), str(p.reason) || "—"),
        url: `/history?tx=w:${str(p.withdrawalId)}`,
        channel: "payments",
      };
    case "kyc_verified":
      return { title: s.kycOkTitle, body: s.kycOk, url: "/account/verify", channel: "account" };
    case "kyc_rejected":
      return { title: s.kycNoTitle, body: s.kycNo(str(p.note) || null), url: "/account/verify", channel: "account" };
  }
}

export function tradeResultsMessage(
  results: { symbol: string; pnl: number; stake: number; currency: string }[],
  locale: Locale,
): PushMessage {
  const s = S[locale];
  const currency = results[0]?.currency ?? "INR";
  if (results.length === 1) {
    const r = results[0]!;
    const won = r.pnl > 0;
    return { title: s.tradesTitle, body: s.one(pair(r.symbol), won, formatMinor(Math.abs(won ? r.pnl : r.stake), currency)), url: "/history", channel: "trades" };
  }
  const net = results.reduce((sum, r) => sum + r.pnl, 0);
  const netText = `${net >= 0 ? "+" : "−"}${formatMinor(Math.abs(net), currency)}`;
  return { title: s.tradesTitle, body: s.many(results.length, netText), url: "/history", channel: "trades" };
}
```

Use the `displayName` of the asset instead of the 6-letter split when it's available: add an optional `displayName` field to each result and prefer it (the engine has it from the registry). The method label map gets Hindi values too (`UPI` / `बैंक खाते` / `USDT वॉलेट`) — make `METHOD` per-locale. A native speaker reviews the Hindi strings before release (same blocker as the app's `hi.json`).

`src/index.ts`: `export * from "./messages";` (more exports added in later tasks).

- [ ] **Step 4: Run and commit**

Run: `pnpm install && pnpm --filter @asm/notify test` → PASS.

```bash
git add packages/notify pnpm-lock.yaml
git commit -m "feat(notify): localized push messages"
```

---

### Task 4: Transports and device fan-out

**Files:**
- Create: `packages/notify/src/fcm.ts`, `fcm.test.ts`, `webpush.ts`, `webpush.test.ts`, `sender.ts`, `sender.test.ts`

**Interfaces:**
- Produces:
  - `type SendOutcome = "ok" | "dead" | "retry"`
  - `class FcmTransport { constructor(cfg: { projectId: string; clientEmail: string; privateKey: string }, deps?: { fetch?: typeof fetch; getAccessToken?: () => Promise<string> }); send(token: string, m: PushMessage): Promise<SendOutcome> }`
  - `fcmTransportFromEnv(env?): FcmTransport | null`
  - `class WebPushTransport { constructor(cfg: { publicKey; privateKey; subject }, deps?: { sendNotification?: typeof webpush.sendNotification }); send(sub: { endpoint: string; p256dh: string; auth: string }, m: PushMessage): Promise<SendOutcome> }`
  - `webPushTransportFromEnv(env?): WebPushTransport | null`
  - `class PushSender { constructor(deps: { fcm: FcmTransport | null; web: WebPushTransport | null; devices: (userId) => Promise<PushDevice[]>; dropToken: (token) => Promise<void> }); sendToUser(userId: string, render: (locale: "en" | "hi", platform: "ANDROID" | "WEBPUSH") => PushMessage): Promise<{ delivered: number; retry: boolean }> }`

- [ ] **Step 1: Failing tests**

`fcm.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { FcmTransport } from "./fcm";

const msg = { title: "T", body: "B", url: "/history", channel: "trades" as const };
const make = (status: number, body: unknown) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return { fetch, t: new FcmTransport({ projectId: "p", clientEmail: "e", privateKey: "k" }, { fetch, getAccessToken: async () => "at" }) };
};

describe("FcmTransport", () => {
  it("posts an HTTP v1 message with the channel and url", async () => {
    const { fetch, t } = make(200, { name: "projects/p/messages/1" });
    expect(await t.send("tok", msg)).toBe("ok");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/p/messages:send");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.message).toMatchObject({
      token: "tok",
      notification: { title: "T", body: "B" },
      data: { url: "/history" },
      android: { notification: { channel_id: "trades" } },
    });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer at" });
  });
  it("reports unregistered tokens as dead", async () => {
    expect(await make(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }).t.send("tok", msg)).toBe("dead");
  });
  it("retries on server errors", async () => {
    expect(await make(503, {}).t.send("tok", msg)).toBe("retry");
  });
});
```

`webpush.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { WebPushTransport } from "./webpush";

const sub = { endpoint: "https://push.example/abc", p256dh: "k", auth: "a" };
const msg = { title: "T", body: "B", url: "/history", channel: "payments" as const };

describe("WebPushTransport", () => {
  it("sends a JSON payload the service worker can show", async () => {
    const sendNotification = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    const t = new WebPushTransport({ publicKey: "pub", privateKey: "priv", subject: "mailto:x@y.z" }, { sendNotification });
    expect(await t.send(sub, msg)).toBe("ok");
    expect(JSON.parse(sendNotification.mock.calls[0]![1] as string)).toEqual({ title: "T", body: "B", url: "/history" });
  });
  it("treats 404/410 as a dead subscription", async () => {
    const err = Object.assign(new Error("gone"), { statusCode: 410 });
    const t = new WebPushTransport({ publicKey: "p", privateKey: "q", subject: "mailto:x@y.z" }, { sendNotification: vi.fn(async () => { throw err; }) });
    expect(await t.send(sub, msg)).toBe("dead");
  });
});
```

`sender.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PushSender } from "./sender";

const device = (over: Record<string, unknown>) => ({ id: "x", userId: "u", platform: "ANDROID", token: "t1", p256dh: null, auth: null, locale: "hi", createdAt: new Date(), lastSeenAt: new Date(), ...over }) as never;

describe("PushSender", () => {
  it("renders per device locale and drops dead tokens", async () => {
    const fcm = { send: vi.fn(async (token: string) => (token === "dead" ? "dead" : "ok")) };
    const dropToken = vi.fn(async () => {});
    const sender = new PushSender({
      fcm: fcm as never,
      web: null,
      devices: async () => [device({ token: "t1" }), device({ token: "dead", locale: "en" })],
      dropToken,
    });
    const render = vi.fn((locale: string) => ({ title: locale, body: "b", url: "/", channel: "trades" as const }));
    const out = await sender.sendToUser("u", render);
    expect(out).toEqual({ delivered: 1, retry: false });
    expect(render).toHaveBeenCalledWith("hi", "ANDROID");
    expect(dropToken).toHaveBeenCalledWith("dead");
  });
  it("skips web push devices when no VAPID keys are configured", async () => {
    const sender = new PushSender({ fcm: null, web: null, devices: async () => [device({ platform: "WEBPUSH" })], dropToken: vi.fn() });
    expect(await sender.sendToUser("u", () => ({ title: "", body: "", url: "/", channel: "trades" }))).toEqual({ delivered: 0, retry: false });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement transports**

`fcm.ts`:

```ts
import { JWT } from "google-auth-library";
import type { PushMessage } from "./messages";

export type SendOutcome = "ok" | "dead" | "retry";

export class FcmTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly accessToken: () => Promise<string>;

  constructor(
    private readonly cfg: { projectId: string; clientEmail: string; privateKey: string },
    deps: { fetch?: typeof fetch; getAccessToken?: () => Promise<string> } = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    if (deps.getAccessToken) this.accessToken = deps.getAccessToken;
    else {
      const jwt = new JWT({ email: cfg.clientEmail, key: cfg.privateKey, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
      this.accessToken = async () => (await jwt.getAccessToken()).token ?? "";
    }
  }

  async send(token: string, m: PushMessage): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.cfg.projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: m.title, body: m.body },
            data: { url: m.url },
            android: { priority: "HIGH", notification: { channel_id: m.channel } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return "retry";
    }
    if (res.ok) return "ok";
    const body = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
    const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
    if (res.status === 404 || code === "UNREGISTERED" || (res.status === 400 && code === "INVALID_ARGUMENT")) return "dead";
    return "retry";
  }
}

export function fcmTransportFromEnv(env: Record<string, string | undefined> = process.env): FcmTransport | null {
  const projectId = env["FCM_PROJECT_ID"];
  const clientEmail = env["FCM_CLIENT_EMAIL"];
  const privateKey = env["FCM_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
  return projectId && clientEmail && privateKey ? new FcmTransport({ projectId, clientEmail, privateKey }) : null;
}
```

Note: a 400 `INVALID_ARGUMENT` can also mean a malformed message; since the message shape is fixed and tested, treating it as a bad token is acceptable — log the body at warn level so a real payload bug is visible.

`webpush.ts`:

```ts
import webpush from "web-push";
import type { PushMessage } from "./messages";
import type { SendOutcome } from "./fcm";

export class WebPushTransport {
  private readonly sendImpl: typeof webpush.sendNotification;

  constructor(
    private readonly cfg: { publicKey: string; privateKey: string; subject: string },
    deps: { sendNotification?: typeof webpush.sendNotification } = {},
  ) {
    this.sendImpl = deps.sendNotification ?? webpush.sendNotification.bind(webpush);
  }

  async send(sub: { endpoint: string; p256dh: string; auth: string }, m: PushMessage): Promise<SendOutcome> {
    try {
      await this.sendImpl(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url }),
        { vapidDetails: { subject: this.cfg.subject, publicKey: this.cfg.publicKey, privateKey: this.cfg.privateKey }, TTL: 3600 },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "dead" : "retry";
    }
  }
}

export function webPushTransportFromEnv(env: Record<string, string | undefined> = process.env): WebPushTransport | null {
  const publicKey = env["VAPID_PUBLIC_KEY"];
  const privateKey = env["VAPID_PRIVATE_KEY"];
  const subject = env["VAPID_SUBJECT"];
  return publicKey && privateKey && subject ? new WebPushTransport({ publicKey, privateKey, subject }) : null;
}
```

`sender.ts`:

```ts
import type { PushDevice } from "@asm/db";
import type { SendOutcome } from "./fcm";
import type { FcmTransport } from "./fcm";
import type { PushMessage } from "./messages";
import type { WebPushTransport } from "./webpush";

type Locale = "en" | "hi";

export class PushSender {
  constructor(
    private readonly deps: {
      fcm: Pick<FcmTransport, "send"> | null;
      web: Pick<WebPushTransport, "send"> | null;
      devices: (userId: string) => Promise<PushDevice[]>;
      dropToken: (token: string) => Promise<void>;
    },
  ) {}

  async sendToUser(
    userId: string,
    render: (locale: Locale, platform: "ANDROID" | "WEBPUSH") => PushMessage,
  ): Promise<{ delivered: number; retry: boolean }> {
    const devices = await this.deps.devices(userId);
    let delivered = 0;
    let retry = false;
    await Promise.all(
      devices.map(async (d) => {
        const locale: Locale = d.platform === "WEBPUSH" ? "en" : d.locale === "hi" ? "hi" : "en";
        const message = render(locale, d.platform);
        let outcome: SendOutcome | "skip";
        if (d.platform === "ANDROID") outcome = this.deps.fcm ? await this.deps.fcm.send(d.token, message) : "skip";
        else if (this.deps.web && d.p256dh && d.auth) outcome = await this.deps.web.send({ endpoint: d.token, p256dh: d.p256dh, auth: d.auth }, message);
        else outcome = "skip";
        if (outcome === "ok") delivered += 1;
        else if (outcome === "dead") await this.deps.dropToken(d.token);
        else if (outcome === "retry") retry = true;
      }),
    );
    return { delivered, retry };
  }
}
```

Export transports and sender from `src/index.ts`.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @asm/notify test` → PASS.

```bash
git add packages/notify
git commit -m "feat(notify): FCM and Web Push transports with dead-token cleanup"
```

---

### Task 5: Outbox worker

**Files:**
- Create: `packages/notify/src/outbox-worker.ts`, `outbox-worker.test.ts`

**Interfaces:**
- Consumes: `claimOutbox`, `markOutboxSent`, `pruneOutbox`, `notifyPrefs` (`@asm/db`); `PushSender`; `outboxMessage`, `channelFor`.
- Produces: `startOutboxWorker(deps: { sender: Pick<PushSender, "sendToUser">; intervalMs?: number; now?: () => Date }): { stop(): Promise<void>; tick(): Promise<void> }`

- [ ] **Step 1: Failing test (shared DB, serial)**

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { enqueueOutbox, prisma } from "@asm/db";
import { startOutboxWorker } from "./outbox-worker";

let userId = "";
let mutedId = "";

beforeAll(async () => {
  const [u, m] = await Promise.all([
    prisma.user.create({ data: { email: `ow-${randomUUID()}@test.local`, passwordHash: "x" } }),
    prisma.user.create({ data: { email: `ow-m-${randomUUID()}@test.local`, passwordHash: "x", notifyPayments: false } }),
  ]);
  userId = u.id;
  mutedId = m.id;
});

afterAll(async () => {
  await prisma.notificationOutbox.deleteMany({ where: { userId: { in: [userId, mutedId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, mutedId] } } });
  await prisma.$disconnect();
});

describe("outbox worker", () => {
  it("sends pending rows once and marks them sent", async () => {
    await enqueueOutbox(prisma, userId, "kyc_verified", {});
    const sendToUser = vi.fn(async () => ({ delivered: 1, retry: false }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.tick();
    await worker.stop();
    expect(sendToUser.mock.calls.filter(([u]) => u === userId)).toHaveLength(1);
    expect(await prisma.notificationOutbox.count({ where: { userId, sentAt: null } })).toBe(0);
  });

  it("does not deliver a muted category but still clears the row", async () => {
    await enqueueOutbox(prisma, mutedId, "deposit_credited", { depositId: "d", amountMinor: 1, currency: "INR" });
    const sendToUser = vi.fn(async () => ({ delivered: 1, retry: false }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.stop();
    expect(sendToUser.mock.calls.some(([u]) => u === mutedId)).toBe(false);
    expect(await prisma.notificationOutbox.count({ where: { userId: mutedId, sentAt: null } })).toBe(0);
  });

  it("gives up after five attempts", async () => {
    await enqueueOutbox(prisma, userId, "kyc_rejected", { note: "blurry" });
    await prisma.notificationOutbox.updateMany({ where: { userId, kind: "kyc_rejected" }, data: { attempts: 4 } });
    const sendToUser = vi.fn(async () => ({ delivered: 0, retry: true }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.stop();
    const row = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId, kind: "kyc_rejected" } });
    expect(row.sentAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { claimOutbox, markOutboxSent, notifyPrefs, pruneOutbox, type OutboxKind } from "@asm/db";
import { logger } from "@asm/logger";
import { channelFor, outboxMessage } from "./messages";
import type { PushSender } from "./sender";

const BATCH = 50;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const RETENTION_MS = 30 * 24 * 3600 * 1000;

export function startOutboxWorker(deps: { sender: Pick<PushSender, "sendToUser">; intervalMs?: number; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  let running: Promise<void> | null = null;
  let lastPrune = 0;

  async function tick(): Promise<void> {
    const rows = await claimOutbox(BATCH, LEASE_MS);
    const done: string[] = [];
    for (const row of rows) {
      const kind = row.kind as OutboxKind;
      try {
        const prefs = await notifyPrefs(row.userId);
        const channel = channelFor(kind);
        const muted = channel === "payments" ? !prefs.notifyPayments : !prefs.notifyAccount;
        if (muted || prefs.isBot) {
          done.push(row.id);
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const out = await deps.sender.sendToUser(row.userId, (locale) => outboxMessage(kind, payload, locale));
        if (!out.retry || row.attempts >= MAX_ATTEMPTS) {
          if (out.retry) logger.warn({ evt: "push.outbox_gave_up", id: row.id, kind }, "push gave up after retries");
          done.push(row.id);
        }
      } catch (err) {
        logger.error({ evt: "push.outbox_failed", id: row.id, reason: err instanceof Error ? err.message : "unknown" }, "outbox send failed");
        if (row.attempts >= MAX_ATTEMPTS) done.push(row.id);
      }
    }
    await markOutboxSent(done);

    const t = now().getTime();
    if (t - lastPrune > 24 * 3600 * 1000) {
      lastPrune = t;
      await pruneOutbox(new Date(t - RETENTION_MS));
    }
  }

  const timer = setInterval(() => {
    if (running) return;
    running = tick()
      .catch((err) => logger.error({ evt: "push.outbox_tick_failed", reason: String(err) }, "outbox tick failed"))
      .finally(() => {
        running = null;
      });
  }, deps.intervalMs ?? 2_000);

  return {
    tick,
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
```

Export from `src/index.ts`. The claim increments `attempts` before sending, so "≥ 5" after claim means the fifth attempt just ran.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @asm/notify test` → PASS.

```bash
git add packages/notify
git commit -m "feat(notify): outbox worker with mute, retry cap and retention"
```

---

### Task 6: Engine — presence, trade-result batching, wiring

**Files:**
- Modify: `apps/engine/src/server.ts` (add `isUserOnline`), `apps/engine/package.json` (+ `@asm/notify`)
- Create: `apps/engine/src/push/trade-results.ts`, `trade-results.test.ts`
- Modify: `apps/engine/src/main.ts`

**Interfaces:**
- Produces:
  - `EngineServer.isUserOnline(userId: string): boolean`
  - `class TradeResultBatcher { constructor(deps: { isOnline: (userId) => boolean; liveAccounts: (ids: string[]) => Promise<Map<string, string>>; prefs: (userId) => Promise<{ notifyTrades: boolean; isBot: boolean }>; send: (userId: string, results: TradeResult[]) => Promise<void>; windowMs?: number; setTimer?; clearTimer? }); add(userId: string, trade: TradeView): void; flushAll(): Promise<void> }`
  - `withTradeResultPush(inner: Notifier, batcher: TradeResultBatcher): Notifier` — passes everything through and also feeds `trade:settled` to the batcher.

- [ ] **Step 1: Presence**

In `EngineServer` (next to `sendToUser`):

```ts
  /** True while any authenticated socket for this user is open — the app closes its socket in the background. */
  isUserOnline(userId: string): boolean {
    for (const client of this.clients) {
      if (client.userId === userId && client.socket.readyState === client.socket.OPEN) return true;
    }
    return false;
  }
```

Add a test to `apps/engine/src/server.test.ts` following its existing socket setup: before auth → false; after `authed` → true; after close → false.

- [ ] **Step 2: Failing batcher tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "@asm/contracts";
import { TradeResultBatcher } from "./trade-results";

const trade = (id: string, accountId: string, pnl: number): TradeView => ({
  id, accountId, symbol: "EURUSD", direction: "UP", stake: 10_000, payoutPct: 80, entryPrice: 1, entryTs: 0, expiryTs: 30, exitPrice: 1, status: pnl > 0 ? "WON" : "LOST", pnl,
} as TradeView);

describe("TradeResultBatcher", () => {
  let online: boolean;
  let send: ReturnType<typeof vi.fn>;
  let batcher: TradeResultBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    online = false;
    send = vi.fn(async () => {});
    batcher = new TradeResultBatcher({
      isOnline: () => online,
      liveAccounts: async (ids) => new Map(ids.filter((i) => i.startsWith("live")).map((i) => [i, "INR"])),
      prefs: async () => ({ notifyTrades: true, isBot: false }),
      send,
    });
  });

  it("groups results that settle within 10 seconds into one push", async () => {
    batcher.add("u1", trade("t1", "live-1", 8_000));
    await vi.advanceTimersByTimeAsync(4_000);
    batcher.add("u1", trade("t2", "live-1", -10_000));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toHaveLength(2);
  });

  it("never pushes demo trades", async () => {
    batcher.add("u1", trade("t1", "demo-1", 8_000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when the user came back online before the push fired", async () => {
    batcher.add("u1", trade("t1", "live-1", 8_000));
    online = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips users who turned trade notifications off", async () => {
    batcher = new TradeResultBatcher({
      isOnline: () => false,
      liveAccounts: async (ids) => new Map(ids.map((i) => [i, "INR"])),
      prefs: async () => ({ notifyTrades: false, isBot: false }),
      send,
    });
    batcher.add("u1", trade("t1", "live-1", 8_000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement `trade-results.ts`**

```ts
import type { ServerMessage, TradeView } from "@asm/contracts";
import { logger } from "@asm/logger";
import type { Notifier } from "../trading/trade-desk";

export interface TradeResult {
  symbol: string;
  pnl: number;
  stake: number;
  currency: string;
}

interface Deps {
  isOnline: (userId: string) => boolean;
  liveAccounts: (ids: string[]) => Promise<Map<string, string>>;
  prefs: (userId: string) => Promise<{ notifyTrades: boolean; isBot: boolean }>;
  send: (userId: string, results: TradeResult[]) => Promise<void>;
  windowMs?: number;
}

export class TradeResultBatcher {
  private readonly pending = new Map<string, { trades: TradeView[]; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly deps: Deps) {}

  add(userId: string, trade: TradeView): void {
    const entry = this.pending.get(userId);
    if (entry) {
      entry.trades.push(trade);
      return;
    }
    const timer = setTimeout(() => void this.flush(userId), this.deps.windowMs ?? 10_000);
    this.pending.set(userId, { trades: [trade], timer });
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((u) => this.flush(u)));
  }

  private async flush(userId: string): Promise<void> {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(userId);
    try {
      if (this.deps.isOnline(userId)) return;
      const prefs = await this.deps.prefs(userId);
      if (!prefs.notifyTrades || prefs.isBot) return;
      const live = await this.deps.liveAccounts([...new Set(entry.trades.map((t) => t.accountId))]);
      const results = entry.trades
        .filter((t) => live.has(t.accountId))
        .map((t) => ({ symbol: t.symbol, pnl: t.pnl, stake: t.stake, currency: live.get(t.accountId)! }));
      if (results.length) await this.deps.send(userId, results);
    } catch (err) {
      logger.error({ evt: "push.trade_results_failed", userId, reason: err instanceof Error ? err.message : "unknown" }, "trade result push failed");
    }
  }
}

/** Passes engine messages through unchanged and feeds settlements to the batcher. */
export function withTradeResultPush(inner: Notifier, batcher: TradeResultBatcher): Notifier {
  return {
    sendToUser(userId: string, message: ServerMessage) {
      inner.sendToUser(userId, message);
      if (message.type === "trade:settled") batcher.add(userId, message.trade);
    },
    broadcast(symbol: string, message: ServerMessage) {
      inner.broadcast(symbol, message);
    },
  };
}
```

Run: `pnpm --filter @asm/engine test -- trade-results` → PASS. Also export `Notifier` from `trade-desk.ts` if it isn't already (it is `export interface Notifier`).

- [ ] **Step 4: Wire into `main.ts`**

Add `"@asm/notify": "workspace:*"` to `apps/engine/package.json`, run `pnpm install`. In `main()`:

```ts
import { listPushDevices, deletePushDeviceByToken, liveAccountCurrencies, notifyPrefs } from "@asm/db";
import { PushSender, fcmTransportFromEnv, startOutboxWorker, tradeResultsMessage, webPushTransportFromEnv } from "@asm/notify";
import { TradeResultBatcher, withTradeResultPush } from "./push/trade-results";

// after `await server.ready();`
const fcm = fcmTransportFromEnv();
const web = webPushTransportFromEnv();
if (!fcm) logger.warn({ evt: "push.fcm_disabled" }, "FCM env missing — Android push off");
if (!web) logger.warn({ evt: "push.webpush_disabled" }, "VAPID env missing — web push off");
const sender = new PushSender({ fcm, web, devices: listPushDevices, dropToken: deletePushDeviceByToken });
const batcher = new TradeResultBatcher({
  isOnline: (u) => server.isUserOnline(u),
  liveAccounts: liveAccountCurrencies,
  prefs: notifyPrefs,
  send: async (userId, results) => {
    await sender.sendToUser(userId, (locale) => tradeResultsMessage(results, locale));
  },
});
const outbox = startOutboxWorker({ sender });

// replace `desk = new TradeDesk(registry, server, controller);` with:
desk = new TradeDesk(registry, withTradeResultPush(server, batcher), controller);
```

Market names: if `AssetRegistry` (`apps/engine/src/assets`) exposes each asset's `displayName`, map `results` to include `displayName` before calling `tradeResultsMessage` (Task 3 prefers it over the 6-letter split); otherwise leave it out.

In `shutdown`, before `await server.stop()`:

```ts
    await batcher.flushAll();
    await outbox.stop();
```

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @asm/engine test && pnpm --filter @asm/engine exec tsc --noEmit` → PASS.

```bash
git add apps/engine packages/db pnpm-lock.yaml
git commit -m "feat(engine): presence-aware grouped trade-result pushes and outbox sender"
```

---

### Task 7: Web routes — devices, VAPID key, notification preferences

**Files:**
- Create: `apps/web/src/app/api/v1/push/devices/route.ts`, `…/route.test.ts`, `apps/web/src/app/api/v1/push/vapid/route.ts`
- Modify: `apps/web/src/app/api/v1/account/preferences/route.ts`, `packages/contracts/src/app.ts`, `apps/web/src/app/api/v1/account/preferences/route.test.ts`

**Interfaces:**
- Produces:
  - `RegisterDeviceSchema = z.discriminatedUnion("platform", [{ platform: "ANDROID", token: string(20..4096) }, { platform: "WEBPUSH", token: url(https), p256dh: string, auth: string }])`
  - `POST /api/v1/push/devices` → 204; `DELETE /api/v1/push/devices` body `{ token }` → 204
  - `GET /api/v1/push/vapid` → `{ publicKey: string | null }`
  - `PreferencesUpdateSchema` gains `notifyTrades?`, `notifyPayments?`, `notifyAccount?`; `PreferencesSchema` returns all four fields.

- [ ] **Step 1: Contracts**

In `packages/contracts/src/app.ts`:

```ts
export const RegisterDeviceSchema = z.discriminatedUnion("platform", [
  z.strictObject({ platform: z.literal("ANDROID"), token: z.string().min(20).max(4096) }),
  z.strictObject({
    platform: z.literal("WEBPUSH"),
    token: z.url().startsWith("https://"),
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(8).max(256),
  }),
]);
export type RegisterDevice = z.infer<typeof RegisterDeviceSchema>;
export const UnregisterDeviceSchema = z.strictObject({ token: z.string().min(1).max(4096) });
```

Replace `PreferencesUpdateSchema` / `PreferencesSchema`:

```ts
export const PreferencesUpdateSchema = z.strictObject({
  locale: LocaleSchema.optional(),
  notifyTrades: z.boolean().optional(),
  notifyPayments: z.boolean().optional(),
  notifyAccount: z.boolean().optional(),
});
export const PreferencesSchema = z.object({
  locale: LocaleSchema,
  notifyTrades: z.boolean(),
  notifyPayments: z.boolean(),
  notifyAccount: z.boolean(),
});
```

- [ ] **Step 2: Failing route tests**

`apps/web/src/app/api/v1/push/devices/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { DELETE, POST } from "./route";

let userId = "";
let token = "";
const fcmToken = `fcm-${randomUUID()}-${"x".repeat(40)}`;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `dev-${randomUUID()}@test.local`, passwordHash: "x", locale: "hi" } });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const call = (fn: typeof POST, body: unknown, method: string) =>
  fn(new NextRequest("http://localhost/api/v1/push/devices", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("/api/v1/push/devices", () => {
  it("registers an Android device in the user's language", async () => {
    expect((await call(POST, { platform: "ANDROID", token: fcmToken }, "POST")).status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: fcmToken } })).toMatchObject({ userId, locale: "hi" });
  });
  it("rejects a web push subscription without keys", async () => {
    expect((await call(POST, { platform: "WEBPUSH", token: "https://push.example/x" }, "POST")).status).toBe(400);
  });
  it("removes the caller's device", async () => {
    expect((await call(DELETE, { token: fcmToken }, "DELETE")).status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: fcmToken } })).toBeNull();
  });
});
```

Extend the preferences route test: `PATCH { notifyTrades: false }` → body includes `notifyTrades: false`, DB updated; `PATCH { locale: "hi" }` also updates the user's devices' `locale` (create a device first with `upsertPushDevice`, then check its `locale`).

- [ ] **Step 3: Implement**

`apps/web/src/app/api/v1/push/devices/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { RegisterDeviceSchema, UnregisterDeviceSchema } from "@asm/contracts";
import { deletePushDevice, upsertPushDevice } from "@asm/db";
import { getSession, unauthenticated } from "@/lib/request-session";

const bad = () => NextResponse.json({ error: "Invalid device.", code: "bad_request" }, { status: 400 });

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  const parsed = RegisterDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const d = parsed.data;
  await upsertPushDevice({
    userId: session.userId,
    platform: d.platform,
    token: d.token,
    p256dh: d.platform === "WEBPUSH" ? d.p256dh : null,
    auth: d.platform === "WEBPUSH" ? d.auth : null,
  });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  const parsed = UnregisterDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  await deletePushDevice(session.userId, parsed.data.token);
  return new NextResponse(null, { status: 204 });
}
```

`apps/web/src/app/api/v1/push/vapid/route.ts`:

```ts
import { noStoreJson } from "@/lib/request-session";

export function GET() {
  return noStoreJson({ publicKey: process.env["VAPID_PUBLIC_KEY"] || null });
}
```

Preferences route: after the locale update, apply `setNotifyPrefs(session.userId, { notifyTrades, notifyPayments, notifyAccount })` for whichever are defined; when `locale` changes also run `prisma.pushDevice.updateMany({ where: { userId }, data: { locale } })`; read back all four fields and return `PreferencesSchema.parse(...)`.

Generate VAPID keys once with `pnpm dlx web-push generate-vapid-keys` and add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:support@<domain>`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` to `.env.example` (empty values, comments) — real values go to the VPS env, never the repo.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @asm/contracts test && pnpm --filter @asm/web exec vitest run src/app/api/v1` → PASS.

```bash
git add packages/contracts apps/web .env.example
git commit -m "feat(web): push device registration, VAPID key and notification preferences"
```

---

### Task 8: App — permission, registration, channels, tap routing, settings

**Files:**
- Create: `apps/mobile/src/push/push.ts`, `apps/mobile/src/push/permission-moment.ts`, `permission-moment.test.ts`, `apps/mobile/src/push/usePushRouting.ts`
- Modify: `apps/mobile/app.config.ts` (expo-notifications plugin, `googleServicesFile`), `apps/mobile/app/_layout.tsx`, `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/trade/ResultToast.ts`, `apps/mobile/app/(tabs)/payments/deposit.tsx`
- Replace: `apps/mobile/app/(tabs)/account/notifications.tsx`

**Interfaces:**
- Produces:
  - `shouldAskPermission(s: { asked: boolean; status: "granted" | "denied" | "undetermined"; event: "live_trade_settled" | "deposit_created" | "other" }): boolean` (pure)
  - `setupChannels(): Promise<void>`, `registerDevice(): Promise<void>`, `unregisterDevice(): Promise<void>`, `askPermissionAt(event): Promise<void>`
  - `usePushRouting()` — routes notification taps to `data.url`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldAskPermission } from "./permission-moment";

describe("shouldAskPermission", () => {
  it("asks once, after the first live trade settles or the first deposit is created", () => {
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "live_trade_settled" })).toBe(true);
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "deposit_created" })).toBe(true);
  });
  it("never asks at other moments, twice, or after a decision", () => {
    expect(shouldAskPermission({ asked: false, status: "undetermined", event: "other" })).toBe(false);
    expect(shouldAskPermission({ asked: true, status: "undetermined", event: "deposit_created" })).toBe(false);
    expect(shouldAskPermission({ asked: false, status: "denied", event: "deposit_created" })).toBe(false);
    expect(shouldAskPermission({ asked: false, status: "granted", event: "deposit_created" })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// permission-moment.ts
export function shouldAskPermission(s: {
  asked: boolean;
  status: "granted" | "denied" | "undetermined";
  event: "live_trade_settled" | "deposit_created" | "other";
}): boolean {
  return !s.asked && s.status === "undetermined" && s.event !== "other";
}
```

```ts
// push.ts
import * as Notifications from "expo-notifications";
import { MMKV } from "react-native-mmkv";
import { Platform } from "react-native";
import { api } from "@/api/client";
import { shouldAskPermission } from "./permission-moment";

const store = new MMKV({ id: "ixt-push" });
const ASKED = "asked";
const TOKEN = "token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function setupChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("trades", { name: "Trades", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync("payments", { name: "Payments", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync("account", { name: "Account", importance: Notifications.AndroidImportance.DEFAULT });
}

export async function registerDevice(): Promise<void> {
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted") return;
  const { data: token } = await Notifications.getDevicePushTokenAsync();
  if (typeof token !== "string") return;
  await api("/api/v1/push/devices", { method: "POST", body: { platform: "ANDROID", token } });
  store.set(TOKEN, token);
}

export async function unregisterDevice(): Promise<void> {
  const token = store.getString(TOKEN);
  if (!token) return;
  await api("/api/v1/push/devices", { method: "DELETE", body: { token } }).catch(() => {});
  store.delete(TOKEN);
}

export async function askPermissionAt(event: "live_trade_settled" | "deposit_created" | "other"): Promise<void> {
  const perm = await Notifications.getPermissionsAsync();
  const status = perm.status === "granted" ? "granted" : perm.canAskAgain ? "undetermined" : "denied";
  if (!shouldAskPermission({ asked: store.getBoolean(ASKED) ?? false, status, event })) return;
  store.set(ASKED, true);
  const res = await Notifications.requestPermissionsAsync();
  if (res.status === "granted") await registerDevice();
}

/** FCM rotates tokens; keep the server's copy current. */
export function watchTokenRefresh(): () => void {
  const sub = Notifications.addPushTokenListener(() => void registerDevice());
  return () => sub.remove();
}
```

`usePushRouting.ts`:

```ts
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

const ALLOWED = /^\/(history|account\/verify)(\?.*)?$/;

export function usePushRouting(ready: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!ready || !last) return;
    const url = last.notification.request.content.data?.url;
    if (typeof url === "string" && ALLOWED.test(url)) router.push(url as never);
  }, [ready, last]);
}
```

`ready` = signed in and unlocked (pass `routeFor(...) === null` from the Gatekeeper) so a tap while locked opens the destination after unlock. Only app-internal paths matching `ALLOWED` are followed.

- [ ] **Step 3: Wire it in**

- `app.config.ts`: add plugin `["expo-notifications", { icon: "./assets/notification-icon.png", color: "#2f81f7" }]` and `android.googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json"` (the file comes from the Firebase console for each package id — `com.indianxtrade.app` and `com.indianxtrade.app.direct` — and is **not** committed; P5's CI writes it from a secret). Add `google-services.json` to `apps/mobile/.gitignore`. Create a monochrome `assets/notification-icon.png` (white mark on transparent, 96×96).
- `app/_layout.tsx` Gatekeeper: on first ready-and-unlocked, `void setupChannels().then(registerDevice)`, `watchTokenRefresh()` in an effect, and `usePushRouting(target === null && ready)`.
- `session-store.ts` `signOut`: `await unregisterDevice()` before deleting the token (needs the token for auth).
- `ResultToast.ts` (`useResultFeedback`): when the settled trade's account is LIVE (look it up in bootstrap accounts), call `void askPermissionAt("live_trade_settled")`.
- `payments/deposit.tsx`: after `POST /api/deposits` succeeds, `void askPermissionAt("deposit_created")`.

- [ ] **Step 4: Notifications settings screen**

`app/(tabs)/account/notifications.tsx`:

```tsx
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { PreferencesSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { registerDevice } from "@/push/push";
import { ListRow } from "@/ui/ListRow";
import { Button, Card, Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

const KEYS = ["notifyTrades", "notifyPayments", "notifyAccount"] as const;

export default function NotificationsSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [granted, setGranted] = useState<boolean | null>(null);
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => api("/api/v1/account/preferences", { method: "PATCH", body: {}, schema: PreferencesSchema }) });

  useEffect(() => {
    void Notifications.getPermissionsAsync().then((p) => setGranted(p.status === "granted"));
  }, []);

  async function toggle(key: (typeof KEYS)[number], value: boolean) {
    const next = await api("/api/v1/account/preferences", { method: "PATCH", body: { [key]: value }, schema: PreferencesSchema });
    qc.setQueryData(["prefs"], next);
  }

  return (
    <Screen style={{ padding: space(4), gap: space(3) }}>
      <Txt variant="title">{t("notifications.title")}</Txt>
      {granted === false ? (
        <Card style={{ gap: space(2) }}>
          <Txt>{t("notifications.off")}</Txt>
          <Button
            label={t("notifications.turnOn")}
            onPress={async () => {
              const res = await Notifications.requestPermissionsAsync();
              if (res.status === "granted") {
                setGranted(true);
                await registerDevice();
              } else void Linking.openSettings();
            }}
          />
        </Card>
      ) : null}
      <Card>
        {KEYS.map((k) => (
          <ListRow
            key={k}
            title={t(`notifications.${k}`)}
            right={<Switch value={prefs.data?.[k] ?? true} onValueChange={(v) => void toggle(k, v)} />}
          />
        ))}
      </Card>
      <View />
    </Screen>
  );
}
```

Using `PATCH` with an empty body to read preferences is a deliberate shortcut (it returns the current values and changes nothing); if the reviewer prefers, add `GET /api/v1/account/preferences` in Task 7 instead and use it here.

i18n keys `notifications.{title, off, turnOn, notifyTrades, notifyPayments, notifyAccount}` in both languages.

- [ ] **Step 5: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`.

Manual (real Android 13+ phone, debug build with a Firebase project and `FCM_*` env on the local engine):
1. Fresh install → no permission prompt at launch.
2. Place a live trade, let it settle in the app → permission prompt once; allow.
3. Background the app, place a trade from the website, wait for settle + 10s → one push "EUR/USD trade won …"; tap → app opens History.
4. Admin marks a deposit completed → push; tap → that deposit's timeline sheet.
5. Turn "Payments" off → next deposit credit shows no push.
6. Switch language to Hindi → next push in Hindi.
7. Log out → device row gone from `PushDevice`.

```bash
git add apps/mobile
git commit -m "feat(mobile): push permission at the right moment, registration and tap routing"
```

---

## Self-Review Notes

- Spec coverage: data model → T1; outbox writers (deposit credit, withdrawal approved/paid/rejected, KYC review + admin select, no reversal) → T2; messages en/hi, channels → T3; FCM v1 + Web Push, dead tokens → T4; worker (2s, 50, SKIP LOCKED, mute, 5 attempts, 30-day retention) → T5; trade results (live only, presence, 10s grouping, re-check at fire) → T6; devices/vapid/preferences routes → T7; app (getDevicePushTokenAsync, channels, permission moment, register/unregister, tap routing, settings) → T8; PWA side → P5.
- Deviation from spec, recorded: withdrawal approve/paid functions were not transactional; T2 wraps status + audit + outbox in one transaction so the outbox guarantee holds. Added `claimedAt` lease column (not in spec) to make claims safe across ticks.
- Type names consistent: `OutboxKind`, `PushMessage`, `Channel`, `SendOutcome`, `PushSender.sendToUser(userId, render)`, `TradeResultBatcher.add/flushAll`, `withTradeResultPush`.
