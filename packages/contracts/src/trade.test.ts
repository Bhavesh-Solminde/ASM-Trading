import { describe, expect, it } from "vitest";
import { EngineOpenTradeSchema, OpenTradeSchema, tradeViewFrom } from "./trade";

const valid = {
  symbol: "AUDNZD_OTC",
  direction: "UP" as const,
  stake: 10_000,
  durationSec: 60,
  accountId: "3f2a9c1e-0000-4000-8000-000000000000",
};

describe("OpenTradeSchema", () => {
  it("accepts a valid request", () => {
    expect(OpenTradeSchema.parse(valid).stake).toBe(10_000);
  });

  it("rejects a client-supplied entry price", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, entryPrice: 1.0 }).success).toBe(false);
  });

  it("rejects a client-supplied expiry timestamp", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, expiryTs: 0 }).success).toBe(false);
  });

  it("rejects a client-supplied payout", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, payoutPct: 500 }).success).toBe(false);
  });

  it("rejects a client-supplied actor", () => {
    expect(
      OpenTradeSchema.safeParse({ ...valid, actorId: "3f2a9c1e-0000-4000-8000-000000000001" }).success,
    ).toBe(false);
  });

  it("rejects a negative, zero, or fractional stake", () => {
    for (const stake of [-100, 0, 100.5]) {
      expect(OpenTradeSchema.safeParse({ ...valid, stake }).success).toBe(false);
    }
  });

  it("rejects an unlisted duration", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, durationSec: 37 }).success).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, direction: "SIDEWAYS" }).success).toBe(false);
  });

  it("rejects an account id that is not a uuid", () => {
    expect(OpenTradeSchema.safeParse({ ...valid, accountId: "1; DROP TABLE" }).success).toBe(false);
  });
});

describe("EngineOpenTradeSchema", () => {
  it("requires the actor the web app verified", () => {
    expect(EngineOpenTradeSchema.safeParse(valid).success).toBe(false);
    expect(
      EngineOpenTradeSchema.safeParse({ ...valid, actorId: "3f2a9c1e-0000-4000-8000-000000000001" }).success,
    ).toBe(true);
  });

  it("is still strict about server-owned fields", () => {
    expect(
      EngineOpenTradeSchema.safeParse({
        ...valid,
        actorId: "3f2a9c1e-0000-4000-8000-000000000001",
        entryPrice: 1,
      }).success,
    ).toBe(false);
  });
});

describe("tradeViewFrom", () => {
  const row = {
    id: "t1",
    accountId: "a1",
    assetId: "asset-1",
    direction: "UP" as const,
    stake: 10_000,
    stakeFromBonus: 4_000,
    payoutPct: 92,
    entryPrice: 1.175,
    entryTs: new Date("2026-09-14T10:00:00.900Z"),
    expiryTs: new Date("2026-09-14T10:01:00.900Z"),
    exitPrice: 1.176,
    status: "WON" as const,
    pnl: 9_200,
    createdAt: new Date(),
    shadow: { honestResult: "LOST" },
  };

  it("copies exactly the client-facing fields and nothing else", () => {
    expect(Object.keys(tradeViewFrom(row, "AUDNZD_OTC")).sort()).toEqual(
      [
        "accountId",
        "direction",
        "entryPrice",
        "entryTs",
        "exitPrice",
        "expiryTs",
        "id",
        "payoutPct",
        "pnl",
        "stake",
        "status",
        "symbol",
      ].sort(),
    );
  });

  it("converts timestamps to epoch seconds", () => {
    const view = tradeViewFrom(row, "AUDNZD_OTC");
    expect(view.entryTs).toBe(Math.floor(Date.parse("2026-09-14T10:00:00Z") / 1000));
    expect(view.expiryTs - view.entryTs).toBe(60);
  });
});
