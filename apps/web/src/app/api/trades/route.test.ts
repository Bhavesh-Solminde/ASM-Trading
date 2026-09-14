import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/engine-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine-client")>();
  return { ...actual, engineOpenTrade: vi.fn() };
});

import type { OpenTradeResult } from "@asm/contracts";
import { createAccountsForUser, openTrade, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "@/lib/engine-client";
import { GET, POST } from "./route";

const RUN = randomUUID();
const engine = vi.mocked(engineOpenTrade);

let alice = { userId: "", demoId: "", cookie: "" };
let bob = { userId: "", demoId: "", cookie: "" };

async function makeUser(name: string) {
  const user = await prisma.user.create({
    data: { email: `${name}-${RUN}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  return {
    userId: user.id,
    demoId: accounts.find((a) => a.type === "DEMO")!.id,
    cookie: await createSession(user.id, {}),
  };
}

beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function headers(cookie: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (cookie) h["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return h;
}

function post(body: unknown, cookie: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/trades", {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify(body),
    }),
  );
}

function get(accountId: string, cookie: string | null): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost/api/trades?accountId=${encodeURIComponent(accountId)}`, {
      headers: headers(cookie),
    }),
  );
}

const order = () => ({
  symbol: "AUDNZD_OTC",
  direction: "UP",
  stake: 1_000,
  durationSec: 60,
  accountId: alice.demoId,
});

describe("POST /api/trades", () => {
  it("requires a session", async () => {
    expect((await post(order(), null)).status).toBe(401);
  });

  it("rejects a client-supplied entry price before reaching the engine", async () => {
    engine.mockClear();
    expect((await post({ ...order(), entryPrice: 0.0001 }, alice.cookie)).status).toBe(400);
    expect(engine).not.toHaveBeenCalled();
  });

  it("refuses another user's account without reaching the engine", async () => {
    engine.mockClear();
    const res = await post({ ...order(), accountId: alice.demoId }, bob.cookie);
    expect(res.status).toBe(404);
    expect(engine).not.toHaveBeenCalled();
  });

  it("forwards the session's user as the actor — never a value from the body", async () => {
    const result = { trade: { id: "t1" }, balances: { realBalance: 1, bonusBalance: 0 } } as unknown as OpenTradeResult;
    engine.mockResolvedValueOnce(result);
    const res = await post(order(), alice.cookie);
    expect(res.status).toBe(201);
    expect(engine).toHaveBeenLastCalledWith({ ...order(), actorId: alice.userId });
  });

  it("maps an engine insufficient-funds rejection to a 409 the trader can read", async () => {
    engine.mockRejectedValueOnce(new EngineRejected(409, "insufficient_funds"));
    const res = await post(order(), alice.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Not enough balance for that stake." });
  });

  it("returns 503 when the engine is unavailable", async () => {
    engine.mockRejectedValueOnce(new EngineUnavailable("engine unreachable"));
    expect((await post(order(), alice.cookie)).status).toBe(503);
  });
});

describe("GET /api/trades", () => {
  it("lists only the caller's own trades, as trade views", async () => {
    const assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
    await openTrade({
      accountId: alice.demoId,
      assetId,
      direction: "UP",
      stake: 1_000,
      payoutPct: 100,
      entryPrice: 1.175,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });

    const mine = (await (await get(alice.demoId, alice.cookie)).json()) as { trades: Record<string, unknown>[] };
    expect(mine.trades).toHaveLength(1);
    expect(mine.trades[0]!["symbol"]).toBe("AUDNZD_OTC");
    expect(mine.trades[0]).not.toHaveProperty("stakeFromBonus");
    expect(mine.trades[0]).not.toHaveProperty("assetId");

    const theirs = (await (await get(alice.demoId, bob.cookie)).json()) as { trades: unknown[] };
    expect(theirs.trades).toEqual([]);
  });

  it("rejects an account id that is not a uuid", async () => {
    expect((await get("not-a-uuid", alice.cookie)).status).toBe(400);
  });
});
