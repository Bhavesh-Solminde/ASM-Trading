import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { reviewKyc } from "./profile";
import { claimOutbox, deletePushDevice, enqueueOutbox, listPushDevices, liveTradeResults, markOutboxSent, upsertPushDevice } from "./notifications";

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
    await markOutboxSent(mine);
    expect(await prisma.notificationOutbox.count({ where: { userId, sentAt: null } })).toBe(0);
  });
});

it("an expired worker cannot acknowledge a row leased by its replacement", async () => {
  await enqueueOutbox(prisma, userId, "kyc_verified", {});
  const first = (await claimOutbox(50, 60_000)).filter((r) => r.userId === userId);
  await prisma.notificationOutbox.updateMany({ where: { id: { in: first.map((r) => r.id) } }, data: { claimedAt: new Date(0) } });
  const replacement = (await claimOutbox(50, 60_000)).filter((r) => r.userId === userId);
  expect(replacement).toHaveLength(first.length);
  await markOutboxSent(first);
  expect(await prisma.notificationOutbox.count({ where: { userId, sentAt: null } })).toBe(replacement.length);
  await markOutboxSent(replacement);
});
it("rolls back an outbox write with the transaction that made it", async () => {
  const before = await prisma.notificationOutbox.count({ where: { userId } });
  await expect(prisma.$transaction(async (tx) => {
    await enqueueOutbox(tx, userId, "kyc_rejected", {});
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect(await prisma.notificationOutbox.count({ where: { userId } })).toBe(before);
});
it("two simultaneous workers claim disjoint rows", async () => {
  await enqueueOutbox(prisma, userId, "kyc_verified", {});
  const [a, b] = await Promise.all([claimOutbox(50, 60_000), claimOutbox(50, 60_000)]);
  expect(a.some((r) => b.some((other) => other.id === r.id))).toBe(false);
  await markOutboxSent([...a, ...b]);
});

it("reads a closed CFD result with its current currency and excludes demo/open trades", async () => {
  const asset = await prisma.asset.create({ data: { symbol: `PUSH${randomUUID()}`, displayName: "Push test", kind: "REAL" } });
  const live = await prisma.account.create({ data: { userId, type: "LIVE", currency: "USD" } });
  const demo = await prisma.account.create({ data: { userId, type: "DEMO", currency: "INR" } });
  const base = { mode: "CFD" as const, assetId: asset.id, direction: "UP" as const, stake: 91, payoutPct: 100, entryPrice: 1, entryTs: new Date(), expiryTs: new Date(), pnl: -9, spreadFee: 7, durationSec: 60 };
  const closed = await prisma.trade.create({ data: { ...base, accountId: live.id, status: "CLOSED" } });
  const open = await prisma.trade.create({ data: { ...base, accountId: live.id, status: "OPEN" } });
  const practice = await prisma.trade.create({ data: { ...base, accountId: demo.id, status: "CLOSED" } });
  try {
    expect(await liveTradeResults([closed.id, open.id, practice.id])).toEqual([{ id: closed.id, symbol: asset.symbol, displayName: "Push test", pnl: -16, stake: 91, currency: "USD" }]);
  } finally { await prisma.trade.deleteMany({ where: { assetId: asset.id } }); await prisma.asset.delete({ where: { id: asset.id } }); }
});

it("keeps OTC result units after its account is converted", async () => {
  const asset = await prisma.asset.create({ data: { symbol: `PUSH${randomUUID()}`, displayName: "OTC push test", kind: "OTC" } });
  const live = await prisma.account.upsert({ where: { userId_type: { userId, type: "LIVE" } }, create: { userId, type: "LIVE", currency: "USD" }, update: { currency: "USD" } });
  const trade = await prisma.trade.create({ data: { mode: "OTC_FIXED", currency: "INR", assetId: asset.id, accountId: live.id, direction: "UP", stake: 10000, payoutPct: 92, entryPrice: 1, entryTs: new Date(), expiryTs: new Date(), pnl: 9200, spreadFee: 0, durationSec: 30, status: "WON" } });
  try {
    expect(await liveTradeResults([trade.id])).toEqual([{ id: trade.id, symbol: asset.symbol, displayName: "OTC push test", pnl: 9200, stake: 10000, currency: "INR" }]);
  } finally { await prisma.trade.delete({ where: { id: trade.id } }); await prisma.asset.delete({ where: { id: asset.id } }); }
});
