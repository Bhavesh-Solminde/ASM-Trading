import { describe, expect, it } from "vitest";
import {
  filterMarkets,
  findAsset,
  nextBonus,
  payoutPctFor,
  precisionFor,
  resolveSymbol,
  sentimentSplit,
  toggleFavourite,
  type AppAsset,
} from "./markets";

const assets: AppAsset[] = [
  { symbol: "EURUSD", displayName: "EUR/USD", precision: 5, payoutPct: 85, assetClass: "FX" },
  { symbol: "NIFTY50", displayName: "Nifty 50", precision: 2, payoutPct: 80, assetClass: "INDEX" },
  { symbol: "BTCUSD", displayName: "Bitcoin", precision: 2, payoutPct: 82, assetClass: "CRYPTO" },
];

describe("market list", () => {
  it("adds and removes favourites", () => {
    expect(toggleFavourite([], "EURUSD")).toEqual(["EURUSD"]);
    expect(toggleFavourite(["EURUSD"], "EURUSD")).toEqual([]);
    expect(toggleFavourite(["EURUSD"], "BTCUSD")).toEqual(["EURUSD", "BTCUSD"]);
  });

  it("does not mutate the list it is given", () => {
    const list = ["EURUSD"];
    toggleFavourite(list, "BTCUSD");
    expect(list).toEqual(["EURUSD"]);
  });

  it("puts favourites first and searches name or symbol, case-insensitively", () => {
    const out = filterMarkets(assets, "bit", ["NIFTY50"]);
    expect(out.favourites).toEqual([]);
    expect(out.rest.map((a) => a.symbol)).toEqual(["BTCUSD"]);
    expect(filterMarkets(assets, "", ["NIFTY50"]).favourites.map((a) => a.symbol)).toEqual(["NIFTY50"]);
    expect(filterMarkets(assets, "  EUR ", []).rest.map((a) => a.symbol)).toEqual(["EURUSD"]);
    expect(filterMarkets(assets, "nifty50", []).rest.map((a) => a.symbol)).toEqual(["NIFTY50"]);
  });

  it("keeps a favourite in the favourites section when it matches the search", () => {
    const out = filterMarkets(assets, "nifty", ["NIFTY50"]);
    expect(out.favourites.map((a) => a.symbol)).toEqual(["NIFTY50"]);
    expect(out.rest).toEqual([]);
  });

  it("ignores favourites that are no longer listed", () => {
    const out = filterMarkets(assets, "", ["GONE"]);
    expect(out.favourites).toEqual([]);
    expect(out.rest).toHaveLength(3);
  });
});

describe("market lookup", () => {
  it("finds an asset by symbol", () => {
    expect(findAsset(assets, "BTCUSD")?.displayName).toBe("Bitcoin");
    expect(findAsset(assets, "NOPE")).toBeUndefined();
    expect(findAsset(assets, null)).toBeUndefined();
  });

  it("uses the saved symbol only while it is still listed, else the default, else the first market", () => {
    expect(resolveSymbol(assets, "BTCUSD", "EURUSD")).toBe("BTCUSD");
    expect(resolveSymbol(assets, "GONE", "NIFTY50")).toBe("NIFTY50");
    expect(resolveSymbol(assets, null, "NIFTY50")).toBe("NIFTY50");
    expect(resolveSymbol(assets, "GONE", "ALSO_GONE")).toBe("EURUSD");
    expect(resolveSymbol([], "X", "Y")).toBeNull();
  });

  it("prefers the live payout over the listed one", () => {
    expect(payoutPctFor(assets[0], 90)).toBe(90);
    expect(payoutPctFor(assets[0], null)).toBe(85);
    expect(payoutPctFor(undefined, null)).toBeNull();
    expect(payoutPctFor(undefined, 70)).toBe(70);
  });

  it("falls back to 2 decimals when the market is unknown", () => {
    expect(precisionFor(assets[0])).toBe(5);
    expect(precisionFor(undefined)).toBe(2);
  });
});

describe("sentiment", () => {
  it("is an even split until the first reading", () => {
    expect(sentimentSplit(null)).toEqual({ upPct: 50, downPct: 50 });
  });
  it("passes a reading through, clamped to 0..100", () => {
    expect(sentimentSplit({ upPct: 62, downPct: 38 })).toEqual({ upPct: 62, downPct: 38 });
    expect(sentimentSplit({ upPct: 130, downPct: -30 })).toEqual({ upPct: 100, downPct: 0 });
  });
});

describe("bonus tiers", () => {
  it("lights the deposit after the completed ones", () => {
    const b = nextBonus(1);
    expect(b.pct).toBe(100);
    expect(b.tiers.map((t) => t.state)).toEqual(["claimed", "next", "upcoming", "upcoming"]);
    expect(b.tiers.map((t) => t.pct)).toEqual([100, 100, 50, 50]);
    expect(b.tiers.map((t) => t.n)).toEqual([1, 2, 3, 4]);
  });
  it("offers the first tier to a new user", () => {
    expect(nextBonus(0).pct).toBe(100);
    expect(nextBonus(0).tiers[0]?.state).toBe("next");
  });
  it("is spent after the last tier", () => {
    const b = nextBonus(4);
    expect(b.pct).toBe(0);
    expect(b.tiers.every((t) => t.state === "claimed")).toBe(true);
  });
  it("tolerates a bad count", () => {
    expect(nextBonus(-3).pct).toBe(100);
  });
});
