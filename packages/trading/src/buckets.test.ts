import { beforeEach, describe, expect, it } from "vitest";
import { BucketRegistry, type Position } from "./buckets";

let seq = 0;

function pos(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "acct-1",
    assetId: "asset-1",
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    expirySec: 1_757_534_400,
    ...overrides,
  };
}

describe("BucketRegistry", () => {
  let registry: BucketRegistry;

  beforeEach(() => {
    registry = new BucketRegistry();
  });

  it("starts empty", () => {
    expect(registry.size()).toBe(0);
    expect(registry.due(1_757_534_400)).toEqual([]);
  });

  it("groups positions sharing an asset and expiry second", () => {
    registry.add(pos({ tradeId: "a" }));
    registry.add(pos({ tradeId: "b" }));
    const buckets = registry.due(1_757_534_400);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.positions).toHaveLength(2);
  });

  it("keeps different assets in separate buckets at the same second", () => {
    registry.add(pos({ tradeId: "a", assetId: "asset-1" }));
    registry.add(pos({ tradeId: "b", assetId: "asset-2" }));
    expect(registry.due(1_757_534_400)).toHaveLength(2);
  });

  it("keeps different expiry seconds in separate buckets", () => {
    registry.add(pos({ tradeId: "a", expirySec: 1_757_534_400 }));
    registry.add(pos({ tradeId: "b", expirySec: 1_757_534_401 }));
    expect(registry.due(1_757_534_401)).toHaveLength(2);
  });

  it("does not return buckets that are not yet due", () => {
    registry.add(pos({ expirySec: 1_757_534_500 }));
    expect(registry.due(1_757_534_400)).toEqual([]);
    expect(registry.size()).toBe(1);
  });

  it("returns overdue buckets so a stalled loop still settles them", () => {
    registry.add(pos({ expirySec: 1_757_534_300 }));
    registry.add(pos({ expirySec: 1_757_534_350, tradeId: "b" }));
    expect(registry.due(1_757_534_400)).toHaveLength(2);
  });

  it("removes buckets once returned as due", () => {
    registry.add(pos());
    expect(registry.due(1_757_534_400)).toHaveLength(1);
    expect(registry.due(1_757_534_400)).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it("returns due buckets in expiry order", () => {
    registry.add(pos({ tradeId: "later", expirySec: 1_757_534_400 }));
    registry.add(pos({ tradeId: "earlier", expirySec: 1_757_534_200 }));
    const buckets = registry.due(1_757_534_400);
    expect(buckets[0]!.expirySec).toBe(1_757_534_200);
  });

  it("lists open positions for one asset only", () => {
    registry.add(pos({ tradeId: "a", assetId: "asset-1" }));
    registry.add(pos({ tradeId: "b", assetId: "asset-1", expirySec: 1_757_534_500 }));
    registry.add(pos({ tradeId: "c", assetId: "asset-2" }));
    const open = registry.openFor("asset-1");
    expect(open).toHaveLength(2);
    expect(open.every((p) => p.assetId === "asset-1")).toBe(true);
  });

  it("removes a single position by trade id", () => {
    registry.add(pos({ tradeId: "keep" }));
    registry.add(pos({ tradeId: "drop" }));
    expect(registry.remove("drop")).toBe(true);
    expect(registry.remove("missing")).toBe(false);
    expect(registry.size()).toBe(1);
  });

  it("drops the bucket entirely when its last position is removed", () => {
    registry.add(pos({ tradeId: "only" }));
    registry.remove("only");
    expect(registry.due(1_757_534_400)).toEqual([]);
  });
});
