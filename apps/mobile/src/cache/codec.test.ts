import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { decodeResume, encodeResume, type ResumeSnapshot } from "./codec";

const trade: TradeView = {
  id: "t1",
  accountId: "a1",
  symbol: "EURUSD",
  direction: "UP",
  stake: 100,
  payoutPct: 85,
  entryPrice: 1.1,
  entryTs: 1_000,
  expiryTs: 1_060,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
};

const snap: ResumeSnapshot = {
  v: 1,
  savedAt: 1_000,
  userId: "u1",
  symbol: "EURUSD",
  timeframe: "1m",
  candles: Array.from({ length: 300 }, (_, i) => ({ openTs: i * 60, o: 1, h: 2, l: 0.5, c: 1.5 })),
  balances: { a1: { realBalance: 100, bonusBalance: 0 } },
  openTrades: [],
  accountId: "a1",
};

const encoded = (patch: Record<string, unknown>) => JSON.stringify({ ...snap, ...patch });

describe("resume codec", () => {
  it("round-trips and keeps only the last 200 candles", () => {
    const out = decodeResume(encodeResume(snap), 2_000)!;
    expect(out.candles).toHaveLength(200);
    expect(out.candles[0]!.openTs).toBe(100 * 60);
    expect(out.candles.at(-1)!.openTs).toBe(299 * 60);
    expect(out.symbol).toBe("EURUSD");
    expect(out.balances).toEqual(snap.balances);
  });

  it("trims on encode so storage stays small", () => {
    expect((JSON.parse(encodeResume(snap)) as ResumeSnapshot).candles).toHaveLength(200);
  });

  it("round-trips open trades", () => {
    const out = decodeResume(encodeResume({ ...snap, openTrades: [trade] }), 2_000)!;
    expect(out.openTrades).toEqual([trade]);
  });

  it("drops snapshots older than a day but keeps one exactly a day old", () => {
    expect(decodeResume(encodeResume(snap), 1_000 + 24 * 3600 * 1000 + 1)).toBeNull();
    expect(decodeResume(encodeResume(snap), 1_000 + 24 * 3600 * 1000)).not.toBeNull();
  });

  it("drops snapshots saved far in the future (clock moved back)", () => {
    expect(decodeResume(encodeResume({ ...snap, savedAt: 10 * 3600 * 1000 }), 2_000)).toBeNull();
  });

  it("ignores corrupt or foreign data", () => {
    expect(decodeResume("{nope", 2_000)).toBeNull();
    expect(decodeResume(JSON.stringify({ v: 9 }), 2_000)).toBeNull();
    expect(decodeResume(JSON.stringify(null), 2_000)).toBeNull();
    expect(decodeResume(JSON.stringify([1, 2]), 2_000)).toBeNull();
    expect(decodeResume("", 2_000)).toBeNull();
    expect(decodeResume(undefined, 2_000)).toBeNull();
  });

  it("rejects the wrong version", () => {
    expect(decodeResume(encoded({ v: 2 }), 2_000)).toBeNull();
  });

  it("rejects a snapshot whose shape is wrong", () => {
    expect(decodeResume(encoded({ timeframe: "2m" }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ candles: [{ openTs: 1 }] }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ candles: "nope" }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ balances: { a1: { realBalance: "100", bonusBalance: 0 } } }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ openTrades: [{ id: "t1" }] }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ symbol: 5 }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ savedAt: "1000" }), 2_000)).toBeNull();
    expect(decodeResume(encoded({ accountId: undefined }), 2_000)).toBeNull();
  });

  it("rejects a snapshot that belongs to another user", () => {
    expect(decodeResume(encodeResume(snap), 2_000, "u1")).not.toBeNull();
    expect(decodeResume(encodeResume(snap), 2_000, "u2")).toBeNull();
  });

  it("does not carry unknown fields such as a token through", () => {
    const out = decodeResume(encoded({ token: "secret" }), 2_000)!;
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
