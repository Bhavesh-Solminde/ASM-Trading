// Step 2 of docs/cfd-revenue-test-handoff.md — gap tracker + three-layer magnet.
//
// Pure logic (no DB): the magnet decides which way to nudge the shown price
// based on net open positions; the gap tracker accumulates that pull, decays
// it with a 2.4h half-life, and keeps |gap| ≤ sigma1h × maxGapMultiple.
import { describe, expect, it } from "vitest";
import {
  GapTracker,
  assetCategory,
  isMarketClosed,
  cryptoMaintenancePhase,
} from "../gap";
import { computeMagnetPull, adaptiveAggression } from "@asm/algo";

const HALF_LIFE_SEC = 2.4 * 3600;

describe("GapTracker — accumulation + decay", () => {
  it("shownPrice = realPrice × (1 + gap)", () => {
    const g = new GapTracker();
    g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
    g.push("BTCUSD", 0.002, 0);
    expect(g.gap("BTCUSD")).toBeCloseTo(0.002, 10);
    expect(g.shownPrice("BTCUSD", 100000)).toBeCloseTo(100200, 2);
  });

  it("gap decays by exactly ½ after one half-life (2.4h)", () => {
    const g = new GapTracker();
    g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
    g.push("BTCUSD", 0.004, 0);
    g.push("BTCUSD", 0, HALF_LIFE_SEC); // push 0 — the next decay step
    expect(g.gap("BTCUSD")).toBeCloseTo(0.002, 10);
  });

  it("converge() does ×10 decay — one minute of converge ≈ 10 min of normal decay", () => {
    const normal = new GapTracker();
    normal.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
    normal.push("BTCUSD", 0.005, 0);
    normal.push("BTCUSD", 0, 600); // 10 min of normal decay

    const converge = new GapTracker();
    converge.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
    converge.push("BTCUSD", 0.005, 0);
    converge.converge("BTCUSD", 60); // 1 min of ×10 decay

    expect(converge.gap("BTCUSD")).toBeCloseTo(normal.gap("BTCUSD"), 10);
  });

  it("gap is clamped to ±sigma1h × maxGapMultiple", () => {
    const g = new GapTracker();
    g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 3 });
    g.push("BTCUSD", 10, 0); // enormous pull
    expect(g.gap("BTCUSD")).toBeCloseTo(0.03, 10);
    g.push("BTCUSD", -10, 0);
    expect(g.gap("BTCUSD")).toBeCloseTo(-0.03, 10);
  });

  it("reset() zeroes a single symbol; resetAll() zeroes everything", () => {
    const g = new GapTracker();
    g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
    g.registerAsset("ETHUSDT", { sigma1h: 0.01, maxGapMultiple: 5 });
    g.push("BTCUSD", 0.002, 0);
    g.push("ETHUSDT", 0.003, 0);
    g.reset("BTCUSD");
    expect(g.gap("BTCUSD")).toBe(0);
    expect(g.gap("ETHUSDT")).toBeCloseTo(0.003, 10);
    g.resetAll();
    expect(g.gap("ETHUSDT")).toBe(0);
  });

  describe("snapshot/restore — survives engine restart", () => {
    it("round-trips every registered symbol's gap exactly", () => {
      const g = new GapTracker();
      g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      g.registerAsset("ETHUSDT", { sigma1h: 0.02, maxGapMultiple: 5 });
      g.push("BTCUSD", 0.003, 0);
      g.push("ETHUSDT", -0.004, 0);

      const snap = g.snapshot();
      expect(snap).toEqual(expect.arrayContaining([
        { symbol: "BTCUSD", gap: expect.closeTo(0.003, 10) as number },
        { symbol: "ETHUSDT", gap: expect.closeTo(-0.004, 10) as number },
      ]));

      // Simulate a fresh engine process: new tracker, same assets registered.
      const g2 = new GapTracker();
      g2.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      g2.registerAsset("ETHUSDT", { sigma1h: 0.02, maxGapMultiple: 5 });
      const restored = g2.restore(snap);
      expect(restored).toBe(2);
      expect(g2.gap("BTCUSD")).toBeCloseTo(0.003, 10);
      expect(g2.gap("ETHUSDT")).toBeCloseTo(-0.004, 10);
    });

    it("silently skips an unregistered symbol so a removed asset can't crash boot", () => {
      const g = new GapTracker();
      g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      const restored = g.restore([
        { symbol: "BTCUSD", gap: 0.002 },
        { symbol: "DELISTED_COIN", gap: 0.015 },
      ]);
      expect(restored).toBe(1);
      expect(g.gap("BTCUSD")).toBeCloseTo(0.002, 10);
      expect(g.gap("DELISTED_COIN")).toBe(0);
    });

    it("clamps a restored gap to the asset's current [-maxGap, +maxGap] band", () => {
      const g = new GapTracker();
      g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 3 }); // max 0.03
      g.restore([{ symbol: "BTCUSD", gap: 0.10 }]); // way over clamp
      expect(g.gap("BTCUSD")).toBeCloseTo(0.03, 10);
    });

    it("drops a NaN or Infinity so a corrupt row can't poison the tracker", () => {
      const g = new GapTracker();
      g.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      g.push("BTCUSD", 0.002, 0);
      const restored = g.restore([
        { symbol: "BTCUSD", gap: Number.NaN },
        { symbol: "BTCUSD", gap: Number.POSITIVE_INFINITY },
      ]);
      expect(restored).toBe(0);
      // Existing in-memory gap left alone.
      expect(g.gap("BTCUSD")).toBeCloseTo(0.002, 10);
    });

    it("the restore-then-tick path produces no shown-price snap across a restart", () => {
      // Pre-restart: real = 100000, gap built up to 0.004 → shown = 100400.
      const pre = new GapTracker();
      pre.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      pre.push("BTCUSD", 0.004, 0);
      const preShown = pre.shownPrice("BTCUSD", 100000);
      expect(preShown).toBeCloseTo(100400, 2);

      // Post-restart: fresh tracker, same asset, no restore → snap to 100000.
      const noRestore = new GapTracker();
      noRestore.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      expect(noRestore.shownPrice("BTCUSD", 100000)).toBe(100000); // the bug
      expect(Math.abs(preShown - noRestore.shownPrice("BTCUSD", 100000))).toBeCloseTo(400, 2);

      // Post-restart WITH restore from pre's snapshot → continuous.
      const withRestore = new GapTracker();
      withRestore.registerAsset("BTCUSD", { sigma1h: 0.01, maxGapMultiple: 5 });
      withRestore.restore(pre.snapshot());
      expect(withRestore.shownPrice("BTCUSD", 100000)).toBeCloseTo(preShown, 6);
    });
  });
});

describe("assetCategory", () => {
  it("gold is STOCK, EUR/GBP/AUD prefixes are FOREX, anything else with USD is CRYPTO", () => {
    expect(assetCategory("XAUUSD")).toBe("STOCK");
    expect(assetCategory("XAGUSD")).toBe("STOCK");
    expect(assetCategory("EURUSD")).toBe("FOREX");
    expect(assetCategory("GBPUSD")).toBe("FOREX");
    expect(assetCategory("BTCUSD")).toBe("CRYPTO");
    expect(assetCategory("ETHUSDT")).toBe("CRYPTO");
    expect(assetCategory("NIFTY50")).toBe("STOCK");
  });
});

describe("isMarketClosed", () => {
  // All times are IST = UTC+5:30.
  it("crypto never closes", () => {
    const anyTime = new Date("2026-10-25T12:00:00Z"); // Sunday noon UTC
    expect(isMarketClosed("CRYPTO", anyTime)).toBe(false);
  });

  it("forex: closed on Saturday + Sunday", () => {
    // 2026-10-24 is a Saturday, 2026-10-25 a Sunday — pick weekday hours.
    const sat = new Date("2026-10-24T10:00:00Z");
    const sun = new Date("2026-10-25T10:00:00Z");
    expect(isMarketClosed("FOREX", sat)).toBe(true);
    expect(isMarketClosed("FOREX", sun)).toBe(true);
  });

  it("forex: open 05:00 → 23:30 IST on weekdays", () => {
    // Monday 2026-10-26 09:30 IST == 04:00 UTC
    const monday0930Ist = new Date("2026-10-26T04:00:00Z");
    expect(isMarketClosed("FOREX", monday0930Ist)).toBe(false);
    // Monday 2026-10-26 03:00 IST == 2026-10-25T21:30Z (before 05:00 IST)
    const earlyIst = new Date("2026-10-25T21:30:00Z");
    expect(isMarketClosed("FOREX", earlyIst)).toBe(true);
  });
});

describe("cryptoMaintenancePhase", () => {
  it("04:00–05:00 IST is FROZEN", () => {
    const t = new Date("2026-10-26T22:30:00Z"); // 04:00 IST next day
    expect(cryptoMaintenancePhase(t)).toBe("FROZEN");
  });
  it("05:00–06:00 IST is CONVERGING", () => {
    const t = new Date("2026-10-26T23:30:00Z"); // 05:00 IST next day
    expect(cryptoMaintenancePhase(t)).toBe("CONVERGING");
  });
  it("outside the window is OPEN", () => {
    const t = new Date("2026-10-26T10:00:00Z"); // 15:30 IST
    expect(cryptoMaintenancePhase(t)).toBe("OPEN");
  });
});

describe("three-layer magnet — direction + aggression", () => {
  it("adaptiveAggression tiers down with crowd size", () => {
    expect(adaptiveAggression(10)).toBe(3.5);
    expect(adaptiveAggression(30)).toBe(3.0);
    expect(adaptiveAggression(70)).toBe(2.7);
    expect(adaptiveAggression(500)).toBe(2.5);
  });

  it("empty / zero-sigma inputs produce zero pull", () => {
    expect(computeMagnetPull({ positions: [], realMoveSign: 0, volatility: 0.01, sigma: 0.01, activeUsers: 10 })).toBe(0);
    expect(
      computeMagnetPull({
        positions: [{ direction: "UP", stake: 100, stopLoss: null, pnlFrac: 0 }],
        realMoveSign: 0,
        volatility: 0.01,
        sigma: 0,
        activeUsers: 10,
      }),
    ).toBe(0);
  });

  it("net-LONG crowd + sufficient vol → anti-crowd pull is NEGATIVE (push shown price DOWN)", () => {
    const pull = computeMagnetPull({
      positions: Array.from({ length: 10 }, () => ({ direction: "UP" as const, stake: 1000, stopLoss: null, pnlFrac: 0 })),
      realMoveSign: 0,
      volatility: 0.01,
      sigma: 0.01,
      activeUsers: 10,
    });
    expect(pull).toBeLessThan(0);
  });

  it("net-SHORT crowd → anti-crowd pull is POSITIVE", () => {
    const pull = computeMagnetPull({
      positions: Array.from({ length: 10 }, () => ({ direction: "DOWN" as const, stake: 1000, stopLoss: null, pnlFrac: 0 })),
      realMoveSign: 0,
      volatility: 0.01,
      sigma: 0.01,
      activeUsers: 10,
    });
    expect(pull).toBeGreaterThan(0);
  });

  it("volatility gate: zero magnet when vol < 50% of sigma", () => {
    const pull = computeMagnetPull({
      positions: Array.from({ length: 10 }, () => ({ direction: "UP" as const, stake: 1000, stopLoss: null, pnlFrac: 0 })),
      realMoveSign: 0,
      volatility: 0.004, // 40% of sigma
      sigma: 0.01,
      activeUsers: 10,
    });
    expect(pull).toBe(0);
  });

  it("SL gravity: 3+ clustered LONG stops + non-positive real move → extra downward pull", () => {
    const positions = Array.from({ length: 3 }, () => ({ direction: "UP" as const, stake: 1000, stopLoss: 95000, pnlFrac: 0 }));
    const withSl = computeMagnetPull({ positions, realMoveSign: -1, volatility: 0.01, sigma: 0.01, activeUsers: 10 });
    const withoutSl = computeMagnetPull({
      positions: positions.map((p) => ({ ...p, stopLoss: null })),
      realMoveSign: -1,
      volatility: 0.01,
      sigma: 0.01,
      activeUsers: 10,
    });
    expect(withSl).toBeLessThan(withoutSl); // more negative = stronger down-pull
  });

  it("profit drag: a deeply-winning LONG adds extra downward pull", () => {
    const base = { stake: 1000, stopLoss: null };
    const smallWin = computeMagnetPull({
      positions: [{ direction: "UP", ...base, pnlFrac: 0.001 }],
      realMoveSign: 0,
      volatility: 0.01,
      sigma: 0.01,
      activeUsers: 10,
    });
    const bigWin = computeMagnetPull({
      positions: [{ direction: "UP", ...base, pnlFrac: 0.05 }],
      realMoveSign: 0,
      volatility: 0.01,
      sigma: 0.01,
      activeUsers: 10,
    });
    expect(bigWin).toBeLessThan(smallWin);
  });
});
