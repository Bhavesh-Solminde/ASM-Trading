import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetRegistry } from "./registry";
import { prisma } from "@asm/db";

const registry = new AssetRegistry(1234);

beforeAll(async () => {
  await registry.load();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AssetRegistry", () => {
  it("loads the seeded assets", () => {
    expect(registry.symbols()).toContain("AUDNZD_OTC");
    expect(registry.symbols().length).toBeGreaterThanOrEqual(3);
  });

  it("initialises each asset at its base price", () => {
    const asset = registry.get("AUDNZD_OTC")!;
    expect(asset.state.price).toBeCloseTo(1.1735, 4);
  });

  it("returns undefined for an unknown symbol", () => {
    expect(registry.get("NOT_AN_ASSET")).toBeUndefined();
  });

  it("advances the price on tick and keeps it positive", () => {
    let now = 1_757_534_281;
    for (let i = 0; i < 200; i++) {
      const result = registry.tick("AUDNZD_OTC", now);
      expect(result.price).toBeGreaterThan(0);
      now += 1;
    }
  });

  it("emits a closed candle when a minute boundary is crossed", () => {
    let closed = null;
    let now = 1_757_600_000;
    for (let i = 0; i < 200 && closed === null; i++) {
      closed = registry.tick("EURUSD_OTC", now).closed;
      now += 1;
    }
    expect(closed).not.toBeNull();
  });

  it("pulls the price toward an anchor once one is set", () => {
    const asset = registry.get("USDJPY")!;
    const start = asset.state.price;
    registry.setAnchor("USDJPY", start * 1.02);
    let now = 1_757_700_000;
    for (let i = 0; i < 500; i++) {
      registry.tick("USDJPY", now);
      now += 1;
    }
    expect(registry.get("USDJPY")!.state.price).toBeGreaterThan(start);
  });
});
