import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Owner role: the runtime role may not delete append-only program rows during cleanup.
vi.hoisted(() => {
  if (process.env.DATABASE_MIGRATE_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATE_URL;
});

import { createAccountsForUser, ensureAffiliateProfile, prisma } from "@asm/db";
import type { Prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { GET as summaryGET } from "./summary/route";
import { GET as activityGET } from "./activity/route";
import { POST as transferPOST } from "./transfer/route";
import { GET as withdrawalsGET, POST as withdrawalsPOST } from "./withdrawals/route";
import { POST as cancelPOST } from "./withdrawals/[id]/cancel/route";

const RUN = randomUUID();
let n = 0;
type U = { userId: string; liveId: string; cookie: string };
let alice: U, bob: U, carol: U, pendingAff: U;

async function makeUser(data: Partial<Prisma.UserCreateInput> = {}, availableMinor = 0): Promise<U> {
  const user = await prisma.user.create({
    data: { email: `program-${n++}-${RUN}@test.local`, passwordHash: "x", kycStatus: "VERIFIED", ...data },
  });
  const accounts = await createAccountsForUser(user.id, 0, "INR");
  if (availableMinor) await prisma.programWallet.create({ data: { userId: user.id, availableMinor } });
  return { userId: user.id, liveId: accounts.find((a) => a.type === "LIVE")!.id, cookie: await createSession(user.id, {}) };
}

beforeAll(async () => {
  alice = await makeUser({}, 10_000_00);
  bob = await makeUser({}, 10_000_00);
  carol = await makeUser({ kycStatus: "NOT_STARTED" }, 10_000_00);
  pendingAff = await makeUser({ role: "AFFILIATE", emailVerified: true }, 10_000_00);
  await ensureAffiliateProfile(pendingAff.userId);
  await prisma.affiliateProfile.update({ where: { userId: pendingAff.userId }, data: { status: "PENDING_APPROVAL" } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function req(path: string, cookie: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (cookie) headers["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const transfer = (u: U | null, body: unknown) => transferPOST(req("/api/program/transfer", u?.cookie ?? null, body));
const withdraw = (u: U | null, body: unknown) => withdrawalsPOST(req("/api/program/withdrawals", u?.cookie ?? null, body));
const cancel = (u: U | null, id: string) =>
  cancelPOST(req(`/api/program/withdrawals/${id}/cancel`, u?.cookie ?? null, {}), { params: Promise.resolve({ id }) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const UPI = { method: "UPI", upiId: "alice@okaxis" };

describe("auth", () => {
  it("every route requires a session", async () => {
    expect((await summaryGET(req("/api/program/summary", null))).status).toBe(401);
    expect((await activityGET(req("/api/program/activity", null))).status).toBe(401);
    expect((await withdrawalsGET(req("/api/program/withdrawals", null))).status).toBe(401);
    expect((await transfer(null, { amountMinor: 100, idempotencyKey: randomUUID() })).status).toBe(401);
    expect((await withdraw(null, { amountMinor: 2_000_00, payout: UPI, idempotencyKey: randomUUID() })).status).toBe(401);
    expect((await cancel(null, randomUUID())).status).toBe(401);
  });
});

describe("GET summary / activity", () => {
  it("returns the caller's own aggregates only", async () => {
    const res = await summaryGET(req("/api/program/summary", alice.cookie));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body).toMatchObject({ availableMinor: 10_000_00, totalReferrals: 0, currency: "INR", canTransfer: true });
    expect(body).not.toHaveProperty("userId");
  });

  it("validates activity paging", async () => {
    expect((await activityGET(req("/api/program/activity?limit=0", alice.cookie))).status).toBe(400);
    expect((await activityGET(req("/api/program/activity?before=yesterday", alice.cookie))).status).toBe(400);
    expect((await activityGET(req("/api/program/activity?evil=1", alice.cookie))).status).toBe(400);
    const res = await activityGET(req("/api/program/activity?limit=5", alice.cookie));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ items: expect.any(Array) });
  });
});

describe("POST transfer", () => {
  it("rejects malformed bodies", async () => {
    for (const body of [
      { amountMinor: 1.5, idempotencyKey: randomUUID() },
      { amountMinor: -1, idempotencyKey: randomUUID() },
      { amountMinor: 100, idempotencyKey: "nope" },
      { amountMinor: 100, idempotencyKey: randomUUID(), userId: bob.userId },
    ]) {
      expect((await transfer(alice, body)).status).toBe(400);
    }
  });

  it("refuses more than available with the repo's code", async () => {
    const res = await transfer(alice, { amountMinor: 10_000_01, idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: "insufficient_funds", error: expect.stringMatching(/available/) });
  });

  it("refuses an affiliate that is not ACTIVE", async () => {
    const res = await transfer(pendingAff, { amountMinor: 100_00, idempotencyKey: randomUUID() });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: "affiliate_not_active" });
  });

  it("credits the caller's LIVE balance once per idempotency key", async () => {
    const key = randomUUID();
    const before = (await prisma.account.findUniqueOrThrow({ where: { id: alice.liveId } })).realBalance;
    const first = await transfer(alice, { amountMinor: 1_000_00, idempotencyKey: key });
    expect(first.status).toBe(201);
    const a = await json(first);
    expect(a).toMatchObject({ creditedMinor: 1_000_00, creditedCurrency: "INR", accountId: alice.liveId });
    const again = await json(await transfer(alice, { amountMinor: 1_000_00, idempotencyKey: key }));
    expect(again.transferId).toBe(a.transferId);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: alice.liveId } })).realBalance).toBe(before + 1_000_00);
    // Someone else's key is refused, never answered with Alice's transfer.
    const stolen = await transfer(bob, { amountMinor: 1_000_00, idempotencyKey: key });
    expect(stolen.status).toBe(409);
    expect(await json(stolen)).not.toHaveProperty("transferId");
  });
});

describe("withdrawals", () => {
  it("names the payout field to fix", async () => {
    const res = await withdraw(alice, {
      amountMinor: 2_000_00,
      payout: { method: "BANK", accountHolder: "Alice", accountNumber: "123456789", ifsc: "BAD" },
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/IFSC/);
  });

  it("refuses below the minimum and without KYC", async () => {
    const low = await withdraw(alice, { amountMinor: 100_00, payout: UPI, idempotencyKey: randomUUID() });
    expect(low.status).toBe(400);
    expect(await json(low)).toMatchObject({ code: "below_minimum" });
    const kyc = await withdraw(carol, { amountMinor: 2_000_00, payout: UPI, idempotencyKey: randomUUID() });
    expect(kyc.status).toBe(400);
    expect(await json(kyc)).toMatchObject({ code: "kyc_required" });
  });

  it("requests, lists without internals, and cancels only the owner's REQUESTED withdrawal", async () => {
    const res = await withdraw(alice, { amountMinor: 2_000_00, payout: UPI, idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    const { id, status } = await json(res);
    expect(status).toBe("REQUESTED");
    expect((await prisma.programWallet.findUniqueOrThrow({ where: { userId: alice.userId } })).reservedMinor).toBe(2_000_00);

    const list = (await json(await withdrawalsGET(req("/api/program/withdrawals", alice.cookie)))).withdrawals as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ id, status: "REQUESTED", method: "UPI", destination: "alice@okaxis" });
    expect(list[0]).not.toHaveProperty("ipAddress");
    expect((await json(await withdrawalsGET(req("/api/program/withdrawals", bob.cookie)))).withdrawals).toEqual([]);

    expect((await cancel(bob, String(id))).status).toBe(404);
    const ok = await cancel(alice, String(id));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ id, status: "CANCELLED" });
    // A repeated cancel is idempotent and never releases the money twice.
    expect(await json(await cancel(alice, String(id)))).toMatchObject({ id, status: "CANCELLED" });
    expect(await prisma.programWallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({
      reservedMinor: 0,
      availableMinor: 9_000_00,
    });
  });

  it("refuses to cancel once the withdrawal is no longer REQUESTED (409)", async () => {
    const { id } = await json(await withdraw(alice, { amountMinor: 2_000_00, payout: UPI, idempotencyKey: randomUUID() }));
    await prisma.programWithdrawal.update({ where: { id: String(id) }, data: { status: "APPROVED" } });
    const res = await cancel(alice, String(id));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: "invalid_state" });
  });
});
