import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fully mocked: no database, no Redis, no session store. The sibling `route.test.ts` runs the same route against a
// real Postgres; this file covers the receipt fields and the ownership rule without one.
const mocks = vi.hoisted(() => ({
  getDepositByToken: vi.fn(),
  getDepositReceipt: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@asm/db", () => ({ DEMO_VPA: "demo@ybl", getDepositByToken: mocks.getDepositByToken, getDepositReceipt: mocks.getDepositReceipt }));
vi.mock("@/lib/request-session", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getSession: mocks.getSession,
    unauthenticated: () => NextResponse.json({ error: "Not signed in.", code: "unauthenticated" }, { status: 401 }),
    noStoreJson: (body: unknown) => NextResponse.json(body, { headers: { "cache-control": "no-store" } }),
  };
});

import { CheckoutViewSchema } from "@asm/contracts";
import { GET } from "./route";

const TOKEN = "tok_0123456789abcdefghij";
const CREATED = new Date("2026-10-21T10:00:00.000Z");

function depositRow(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    userId: "owner",
    method: "PhonePe",
    status: "AWAITING_PAYMENT",
    amountUsd: 1200,
    amountInr: 200000,
    amountUsdtMinor: null,
    network: null,
    vpa: "collect@ybl",
    receivingAddress: null,
    gateway: null,
    usdtMatch: null,
    claimedUtr: null,
    claimedTxHash: null,
    matchedCreditId: null,
    createdAt: CREATED,
    expiresAt: new Date("2026-10-21T10:05:00.000Z"),
    ...over,
  };
}

const NO_RECEIPT = { creditedAt: null, creditedMinor: null, creditedCurrency: null, bonusMinor: null, balanceAfterMinor: null, utr: null };

const get = () =>
  GET(new NextRequest(`http://localhost/api/v1/checkout/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.getSession.mockResolvedValue({ userId: "owner" });
  mocks.getDepositReceipt.mockResolvedValue(NO_RECEIPT);
});

describe("GET /api/v1/checkout/:token (receipt fields, mocked)", () => {
  it("rejects a caller who is not signed in", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.getDepositByToken).not.toHaveBeenCalled();
  });

  it("answers someone else's deposit exactly like a missing one, and reads no receipt for it", async () => {
    mocks.getDepositByToken.mockResolvedValue(depositRow({ userId: "somebody-else" }));
    const stranger = await get();
    mocks.getDepositByToken.mockResolvedValue(null);
    const missing = await get();
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual(await missing.json());
    expect(mocks.getDepositReceipt).not.toHaveBeenCalled();
  });

  it("gives an open deposit its created time and null receipt fields", async () => {
    mocks.getDepositByToken.mockResolvedValue(depositRow());
    const res = await get();
    expect(res.status).toBe(200);
    const view = CheckoutViewSchema.parse(await res.json());
    expect(view).toMatchObject({ status: "AWAITING_PAYMENT", createdAt: CREATED.toISOString(), creditedAt: null, creditedMinor: null, bonusMinor: null, balanceAfterMinor: null, utr: null });
  });

  it("gives a credited deposit its receipt: credit, bonus, new balance, UTR and time", async () => {
    mocks.getDepositByToken.mockResolvedValue(depositRow({ status: "COMPLETED", claimedUtr: "428713905561" }));
    mocks.getDepositReceipt.mockResolvedValue({
      creditedAt: new Date("2026-10-21T10:01:30.000Z"),
      creditedMinor: 200000,
      creditedCurrency: "INR",
      bonusMinor: 200000,
      balanceAfterMinor: 1645000,
      utr: "428713905561",
    });
    const view = CheckoutViewSchema.parse(await (await get()).json());
    expect(view).toMatchObject({
      status: "COMPLETED",
      creditedAt: "2026-10-21T10:01:30.000Z",
      creditedMinor: 200000,
      creditedCurrency: "INR",
      bonusMinor: 200000,
      balanceAfterMinor: 1645000,
      utr: "428713905561",
    });
    expect(mocks.getDepositReceipt).toHaveBeenCalledWith(expect.objectContaining({ id: "11111111-2222-3333-4444-555555555555", userId: "owner", status: "COMPLETED" }));
  });

  it("keeps the fields the app already relies on", async () => {
    mocks.getDepositByToken.mockResolvedValue(depositRow());
    const view = CheckoutViewSchema.parse(await (await get()).json());
    expect(view.upiUri).toMatch(/^upi:\/\/pay\?pa=collect%40ybl/);
    expect(view).toMatchObject({ method: "PhonePe", amountInr: 200000, claimedUtr: null, isGateway: false });
  });
});
