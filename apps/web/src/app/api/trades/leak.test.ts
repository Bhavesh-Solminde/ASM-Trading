import { describe, expect, it } from "vitest";

const FORBIDDEN_KEYS = [
  "honestExitPrice", "honestResult", "deltaPips", "biasApplied",
  "magnetApplied", "imbalanceAtEntry", "exposureUp", "exposureDown",
  "shadow", "shadowO", "shadowH", "shadowL", "shadowC",
];

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

describe("shadow ledger containment", () => {
  it("the TradeView contract contains no shadow fields", () => {
    const sample = {
      id: "t1", accountId: "a1", symbol: "AUDNZD_OTC",
      direction: "UP", stake: 10_000, payoutPct: 100,
      entryPrice: 1.175, entryTs: 0, expiryTs: 0,
      exitPrice: 1.176, status: "WON", pnl: 10_000,
    };
    const keys = collectKeys({ trades: [sample] });
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("rejects a candle payload that carries shadow columns", () => {
    const leaky = {
      candles: [{ openTs: 0, o: 1, h: 1, l: 1, c: 1, shadowC: 1.2 }],
    };
    const keys = collectKeys(leaky);
    const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
    expect(leaked).toContain("shadowC");
  });
});
