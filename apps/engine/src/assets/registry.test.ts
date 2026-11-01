import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIMEFRAME_SEC } from "@asm/contracts";
import { AssetRegistry } from "./registry";
import { prisma } from "@asm/db";

const registry = new AssetRegistry(1234);

// The suite owns its asset rows rather than borrowing seeded markets: the
// seeded catalogue changes over time, and writing a far-future candle onto a
// real market would leave it resuming from the fixture if teardown never ran.
// Closed, so a running engine never loads them.
const RUN = randomUUID().slice(0, 8);
const PAIR = `TESTREG_A_${RUN}`;
const OTHER_PAIR = `TESTREG_B_${RUN}`;
const ANCHORED = `TESTREG_C_${RUN}`;
const SYMBOLS = [PAIR, OTHER_PAIR, ANCHORED];

// Newer than anything the engine persists, so it is the last close on load.
const RESUME_OPEN_TS = new Date("2100-01-01T00:00:00Z");
const RESUME_CLOSE = 1.2345;

beforeAll(async () => {
  for (const symbol of SYMBOLS) {
    await prisma.asset.create({
      data: { symbol, displayName: symbol, kind: "OTC", basePrice: 1.1, isOpen: false },
    });
  }
  const asset = await prisma.asset.findUniqueOrThrow({ where: { symbol: PAIR } });
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
  await registry.loadSymbols(SYMBOLS);
});

afterAll(async () => {
  // Candles cascade with their asset.
  await prisma.asset.deleteMany({ where: { symbol: { in: SYMBOLS } } });
  await prisma.$disconnect();
});

describe("AssetRegistry", () => {
  it("loads exactly the requested assets", () => {
    expect([...registry.symbols()].sort()).toEqual([...SYMBOLS].sort());
  });

  it("resumes each asset from its last persisted close rather than its base price", () => {
    const asset = registry.get(PAIR)!;
    expect(asset.state.price).toBeCloseTo(RESUME_CLOSE, 4);
  });

  it("returns undefined for an unknown symbol", () => {
    expect(registry.get("NOT_AN_ASSET")).toBeUndefined();
  });

  const NO_BIAS = { driftBias: 0, magnet: 0 };

  it("advances the price on tick and keeps it positive", () => {
    let now = 1_757_534_281;
    for (let i = 0; i < 200; i++) {
      const result = registry.tick(PAIR, now, NO_BIAS);
      expect(result.price).toBeGreaterThan(0);
      now += 1;
    }
  });

  it("emits closed candles per timeframe on their bucket boundaries", () => {
    const seen = new Set<string>();
    let now = 1_757_600_000;
    for (let i = 0; i < 400; i++) {
      const { price } = registry.tick(OTHER_PAIR, now, NO_BIAS);
      for (const { timeframe, candle } of registry.record(OTHER_PAIR, now, price)) {
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
    // PAIR was last ticked near 1_757_534_481 above; stay ahead of that
    // so the aggregator's monotonic clock is not violated.
    let now = 1_757_536_000;
    for (let i = 0; i < 10; i++) {
      const { price } = registry.tick(PAIR, now, NO_BIAS);
      registry.record(PAIR, now, price);
      now += 1;
    }
    expect(registry.formingCandle(PAIR, "1m")).not.toBeNull();
    expect(registry.formingCandle(PAIR, "1h")).not.toBeNull();
    expect(registry.formingCandle("UNKNOWN", "1m")).toBeNull();
  });

  it("builds candles from the recorded (shown) price, not the stepped one", () => {
    // A later minute than any other PAIR tick in this file, so the
    // aggregator's monotonic clock holds and this bar starts fresh.
    const minute = 1_757_540_400;
    registry.tick(PAIR, minute, NO_BIAS);
    registry.record(PAIR, minute, 1.2);
    registry.tick(PAIR, minute + 2, NO_BIAS);
    // The loop moved the shown price (e.g. a commit snap); only this counts.
    registry.record(PAIR, minute + 2, 1.25);
    const forming = registry.formingCandle(PAIR, "1m")!;
    expect(forming).toMatchObject({ openTs: minute, o: 1.2, h: 1.25, l: 1.2, c: 1.25 });
  });

  it("pulls the price toward an anchor once one is set", () => {
    const asset = registry.get(ANCHORED)!;
    const start = asset.state.price;
    registry.setAnchor(ANCHORED, start * 1.02);
    let now = 1_757_700_000;
    for (let i = 0; i < 500; i++) {
      registry.tick(ANCHORED, now, NO_BIAS);
      now += 1;
    }
    expect(registry.get(ANCHORED)!.state.price).toBeGreaterThan(start);
  });
});
