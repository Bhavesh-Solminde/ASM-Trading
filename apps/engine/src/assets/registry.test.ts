import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIMEFRAME_SEC } from "@asm/contracts";
import { AssetRegistry } from "./registry";
import { prisma } from "@asm/db";

const registry = new AssetRegistry(1234);

// Newer than anything the engine persists, so it is the last close on load.
const RESUME_OPEN_TS = new Date("2100-01-01T00:00:00Z");
const RESUME_CLOSE = 1.2345;

beforeAll(async () => {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: "AUDNZD_OTC" } });
  await prisma.candle.create({
    data: {
      assetId: asset.id,
      timeframe: "1m",
      openTs: RESUME_OPEN_TS,
      o: RESUME_CLOSE,
      h: RESUME_CLOSE,
      l: RESUME_CLOSE,
      c: RESUME_CLOSE,
    },
  });
  // Load these explicitly, ignoring isOpen: the product now opens only BTC/Gold,
  // but this suite exercises the OTC price engine against the OTC fixtures.
  await registry.loadSymbols(["AUDNZD_OTC", "EURUSD_OTC", "USDJPY"]);
});

afterAll(async () => {
  await prisma.candle.deleteMany({ where: { openTs: RESUME_OPEN_TS } });
  await prisma.$disconnect();
});

describe("AssetRegistry", () => {
  it("loads the seeded assets", () => {
    expect(registry.symbols()).toContain("AUDNZD_OTC");
    expect(registry.symbols().length).toBeGreaterThanOrEqual(3);
  });

  it("resumes each asset from its last persisted close rather than its base price", () => {
    const asset = registry.get("AUDNZD_OTC")!;
    expect(asset.state.price).toBeCloseTo(RESUME_CLOSE, 4);
  });

  it("returns undefined for an unknown symbol", () => {
    expect(registry.get("NOT_AN_ASSET")).toBeUndefined();
  });

  const NO_BIAS = { driftBias: 0, magnet: 0 };

  it("advances the price on tick and keeps it positive", () => {
    let now = 1_757_534_281;
    for (let i = 0; i < 200; i++) {
      const result = registry.tick("AUDNZD_OTC", now, NO_BIAS);
      expect(result.price).toBeGreaterThan(0);
      now += 1;
    }
  });

  it("emits closed candles per timeframe on their bucket boundaries", () => {
    const seen = new Set<string>();
    let now = 1_757_600_000;
    for (let i = 0; i < 400; i++) {
      for (const { timeframe, candle } of registry.tick("EURUSD_OTC", now, NO_BIAS).closed) {
        seen.add(timeframe);
        // A closed candle always opens on its own bucket boundary.
        expect(candle.openTs % TIMEFRAME_SEC[timeframe]).toBe(0);
      }
      now += 1;
    }
    // ~6.6 minutes elapsed: 1m closes several times, 5m at least once.
    expect(seen.has("1m")).toBe(true);
    expect(seen.has("5m")).toBe(true);
  });

  it("exposes the in-progress candle for each timeframe", () => {
    // AUDNZD_OTC was last ticked near 1_757_534_481 above; stay ahead of that
    // so the aggregator's monotonic clock is not violated.
    let now = 1_757_536_000;
    for (let i = 0; i < 10; i++) {
      registry.tick("AUDNZD_OTC", now, NO_BIAS);
      now += 1;
    }
    expect(registry.formingCandle("AUDNZD_OTC", "1m")).not.toBeNull();
    expect(registry.formingCandle("AUDNZD_OTC", "1h")).not.toBeNull();
    expect(registry.formingCandle("UNKNOWN", "1m")).toBeNull();
  });

  it("pulls the price toward an anchor once one is set", () => {
    const asset = registry.get("USDJPY")!;
    const start = asset.state.price;
    registry.setAnchor("USDJPY", start * 1.02);
    let now = 1_757_700_000;
    for (let i = 0; i < 500; i++) {
      registry.tick("USDJPY", now, NO_BIAS);
      now += 1;
    }
    expect(registry.get("USDJPY")!.state.price).toBeGreaterThan(start);
  });
});
