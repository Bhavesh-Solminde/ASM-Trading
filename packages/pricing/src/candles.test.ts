import { describe, expect, it } from "vitest";
import { CandleAggregator, bucketStart } from "./candles";

describe("bucketStart", () => {
  it("floors to the wall-clock minute", () => {
    expect(bucketStart(1_757_534_296, 60)).toBe(1_757_534_280);
    expect(bucketStart(1_757_534_280, 60)).toBe(1_757_534_280);
  });
});

describe("CandleAggregator", () => {
  it("returns null while the first candle is still forming", () => {
    const agg = new CandleAggregator(60);
    expect(agg.addTick(1_757_534_281, 1.175)).toBeNull();
    expect(agg.addTick(1_757_534_290, 1.176)).toBeNull();
  });

  it("tracks open, high, low and close of the forming candle", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_290, 1.178);
    agg.addTick(1_757_534_300, 1.172);
    agg.addTick(1_757_534_310, 1.176);
    const c = agg.current()!;
    expect(c.o).toBe(1.175);
    expect(c.h).toBe(1.178);
    expect(c.l).toBe(1.172);
    expect(c.c).toBe(1.176);
    expect(c.openTs).toBe(1_757_534_280);
  });

  it("emits the closed candle when the boundary is crossed", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_290, 1.178);
    const closed = agg.addTick(1_757_534_341, 1.177);
    expect(closed).not.toBeNull();
    expect(closed!.openTs).toBe(1_757_534_280);
    expect(closed!.c).toBe(1.178);
  });

  it("opens the next candle at the first tick of the new bucket", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    agg.addTick(1_757_534_341, 1.177);
    const c = agg.current()!;
    expect(c.openTs).toBe(1_757_534_340);
    expect(c.o).toBe(1.177);
  });

  it("skips empty buckets when ticks jump several minutes", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_281, 1.175);
    const closed = agg.addTick(1_757_534_581, 1.19);
    expect(closed!.openTs).toBe(1_757_534_280);
    expect(agg.current()!.openTs).toBe(1_757_534_580);
  });

  it("rejects out-of-order ticks rather than corrupting the candle", () => {
    const agg = new CandleAggregator(60);
    agg.addTick(1_757_534_290, 1.175);
    expect(() => agg.addTick(1_757_534_281, 1.9)).toThrow(/out of order/i);
  });
});
