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
    const sendToUser = vi.fn<(userId: string) => Promise<{ delivered: number; retry: boolean }>>(async () => ({ delivered: 1, retry: false }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.tick();
    await worker.stop();
    expect(sendToUser.mock.calls.filter(([u]) => u === userId)).toHaveLength(1);
    expect(await prisma.notificationOutbox.count({ where: { userId, sentAt: null } })).toBe(0);
  });

  it("does not deliver a muted category but still clears the row", async () => {
    await enqueueOutbox(prisma, mutedId, "deposit_credited", { depositId: "d", amountMinor: 1, currency: "INR" });
    const sendToUser = vi.fn<(userId: string) => Promise<{ delivered: number; retry: boolean }>>(async () => ({ delivered: 1, retry: false }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.stop();
    expect(sendToUser.mock.calls.some(([u]) => u === mutedId)).toBe(false);
    expect(await prisma.notificationOutbox.count({ where: { userId: mutedId, sentAt: null } })).toBe(0);
  });

  it("gives up after five attempts", async () => {
    await enqueueOutbox(prisma, userId, "kyc_rejected", { note: "blurry" });
    await prisma.notificationOutbox.updateMany({ where: { userId, kind: "kyc_rejected" }, data: { attempts: 4 } });
    const sendToUser = vi.fn<(userId: string) => Promise<{ delivered: number; retry: boolean }>>(async () => ({ delivered: 0, retry: true }));
    const worker = startOutboxWorker({ sender: { sendToUser }, intervalMs: 1_000_000 });
    await worker.tick();
    await worker.stop();
    const row = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId, kind: "kyc_rejected" } });
    expect(row.sentAt).not.toBeNull();
  });
});

it("keeps events pending without spending attempts while a transport is not configured", async () => {
  await enqueueOutbox(prisma, userId, "kyc_verified", {});
  const worker = startOutboxWorker({ sender: { sendToUser: async () => ({ delivered: 0, retry: false, deferred: true }) }, intervalMs: 1_000_000 });
  await worker.tick(); await worker.stop();
  const row = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId, sentAt: null } });
  expect(row.attempts).toBe(0);
  expect(row.claimedAt).not.toBeNull();
});
