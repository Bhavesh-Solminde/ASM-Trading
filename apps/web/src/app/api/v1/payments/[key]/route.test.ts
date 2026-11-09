import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentRowSchema, paymentKeyOf } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let otherId = "";
let token = "";
let depositId = "";
let withdrawalId = "";
let otherDepositId = "";
let otherWithdrawalId = "";

const makeUser = (label: string) =>
  prisma.user.create({
    data: { email: `payment-key-${label}-${randomUUID()}@test.local`, passwordHash: "x", accounts: { create: [{ type: "LIVE" }, { type: "DEMO" }] } },
  });

const makeDeposit = (uid: string, over: { status?: "AWAITING_PAYMENT" | "COMPLETED" } = {}) =>
  prisma.deposit.create({
    data: {
      userId: uid,
      method: "UPI",
      amountUsd: 1200,
      amountInr: 100_000,
      vpa: "test@upi",
      checkoutToken: randomUUID(),
      correlationId: randomUUID(),
      expiresAt: new Date(Date.now() + 300_000),
      status: over.status ?? "COMPLETED",
    },
  });

const makeWithdrawal = (uid: string) =>
  prisma.withdrawal.create({
    data: {
      userId: uid,
      amount: 70_000,
      method: "UPI",
      status: "HELD",
      upiId: "me@okbank",
      holdUntil: new Date(Date.now() + 3_600_000),
      cancelableUntil: new Date(Date.now() + 7_200_000),
    },
  });

beforeAll(async () => {
  const [user, other] = await Promise.all([makeUser("a"), makeUser("b")]);
  userId = user.id;
  otherId = other.id;
  token = await createSession(userId, { client: "APP" });
  depositId = (await makeDeposit(userId)).id;
  withdrawalId = (await makeWithdrawal(userId)).id;
  otherDepositId = (await makeDeposit(otherId)).id;
  otherWithdrawalId = (await makeWithdrawal(otherId)).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});

const get = (key: string, opts: { auth?: boolean; encoded?: boolean } = {}) =>
  GET(
    new NextRequest(`http://localhost/api/v1/payments/${encodeURIComponent(key)}`, {
      headers: opts.auth === false ? {} : { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ key: opts.encoded ? encodeURIComponent(key) : key }) },
  );

describe("GET /api/v1/payments/[key]", () => {
  it("returns the caller's deposit as a payment row", async () => {
    const res = await get(`d:${depositId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const row = PaymentRowSchema.parse(await res.json());
    expect(row).toMatchObject({ key: `d:${depositId}`, id: depositId, kind: "deposit", status: "COMPLETED", methodLabel: "UPI", currency: "INR" });
  });

  it("returns the caller's held withdrawal with its payout and cancel window", async () => {
    const row = PaymentRowSchema.parse(await (await get(`w:${withdrawalId}`)).json());
    expect(row).toMatchObject({ key: `w:${withdrawalId}`, kind: "withdrawal", status: "HELD", amountMinor: 70_000, destination: "me@okbank" });
    expect(row.holdUntil).not.toBeNull();
    expect(row.cancelableUntil).not.toBeNull();
  });

  it("reads the same row the list does, key for key", async () => {
    const { GET: list } = await import("../route");
    const page = (await (await list(new NextRequest("http://localhost/api/v1/payments?limit=10", { headers: { authorization: `Bearer ${token}` } }))).json()) as { rows: unknown[] };
    for (const row of page.rows as { key: string }[]) {
      expect(await (await get(row.key)).json()).toEqual(row);
    }
  });

  it("accepts the key percent-encoded as the app sends it", async () => {
    expect((await get(`d:${depositId}`, { encoded: true })).status).toBe(200);
  });

  it("answers 404 not_found for another user's deposit and withdrawal (no IDOR)", async () => {
    for (const key of [`d:${otherDepositId}`, `w:${otherWithdrawalId}`]) {
      const res = await get(key);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not_found" });
    }
  });

  it("answers 404 for a key that matches no row, and for the wrong kind of id", async () => {
    expect((await get(paymentKeyOf({ kind: "deposit", id: randomUUID() }))).status).toBe(404);
    expect((await get(`w:${depositId}`)).status).toBe(404);
    expect((await get(`d:${withdrawalId}`)).status).toBe(404);
  });

  it("answers 400 bad_request for a malformed key", async () => {
    for (const key of ["x", "d:", `t:${depositId}`, `d:${depositId}z`, "d:not-a-uuid"]) {
      const res = await get(key);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "bad_request" });
    }
  });

  it("answers 401 unauthenticated without a session, and for a junk bearer", async () => {
    const res = await get(`d:${depositId}`, { auth: false });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    const junk = await GET(new NextRequest("http://localhost/api/v1/payments/x", { headers: { authorization: "Bearer nope" } }), { params: Promise.resolve({ key: `d:${depositId}` }) });
    expect(junk.status).toBe(401);
  });
});
