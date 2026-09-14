import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EngineOpenTradeInput, OpenTradeResult } from "@asm/contracts";
import { createInternalApi, type TradeOpener } from "./internal-api";
import { DeskRejection } from "./trading/errors";

const SECRET = "test-internal-secret";
const received: EngineOpenTradeInput[] = [];
let nextError: Error | null = null;

const result: OpenTradeResult = {
  trade: {
    id: "t1",
    accountId: "3f2a9c1e-0000-4000-8000-000000000000",
    symbol: "AUDNZD_OTC",
    direction: "UP",
    stake: 1_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: 1,
    expiryTs: 61,
    exitPrice: null,
    status: "OPEN",
    pnl: 0,
  },
  balances: { realBalance: 999_000, bonusBalance: 0 },
};

const desk: TradeOpener = {
  async open(input) {
    received.push(input);
    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }
    return result;
  },
};

const api = createInternalApi({ desk, secret: SECRET, port: 0 });
let base = "";

beforeAll(async () => {
  base = `http://127.0.0.1:${await api.listen()}`;
});

afterAll(async () => {
  await api.close();
});

const body = {
  symbol: "AUDNZD_OTC",
  direction: "UP",
  stake: 1_000,
  durationSec: 60,
  accountId: "3f2a9c1e-0000-4000-8000-000000000000",
  actorId: "3f2a9c1e-0000-4000-8000-000000000001",
};

function post(payload: unknown, secret: string | null = SECRET, path = "/trades"): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["Authorization"] = `Bearer ${secret}`;
  return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
}

describe("engine internal api", () => {
  it("refuses to start without a secret", () => {
    expect(() => createInternalApi({ desk, secret: "", port: 0 })).toThrow(/ENGINE_INTERNAL_SECRET/);
  });

  it("rejects a missing or wrong secret without calling the desk", async () => {
    const before = received.length;
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "wrong-secret")).status).toBe(401);
    expect(received.length).toBe(before);
  });

  it("rejects a payload carrying a server-owned field", async () => {
    const before = received.length;
    expect((await post({ ...body, entryPrice: 0.0001 })).status).toBe(400);
    expect(received.length).toBe(before);
  });

  it("passes a valid request through and returns 201", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(result);
    expect(received.at(-1)).toEqual(body);
  });

  it("maps desk rejections to 4xx with the reason", async () => {
    nextError = new DeskRejection("insufficient_funds");
    const res = await post(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "insufficient_funds" });

    nextError = new DeskRejection("unknown_asset");
    expect((await post(body)).status).toBe(404);
  });

  it("returns a bare 500 for an unexpected failure, without leaking its message", async () => {
    nextError = new Error("connection string postgres://secret@host");
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("404s any other route", async () => {
    expect((await post(body, SECRET, "/positions")).status).toBe(404);
  });
});
