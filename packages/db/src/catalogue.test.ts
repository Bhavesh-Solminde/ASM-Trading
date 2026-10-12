import { describe, expect, it } from "vitest";
import {
  MARKET_CALIBRATIONS,
  MIN_DISPLAY_STEPS_PER_UPDATE,
  displayStepsPerUpdate,
} from "@asm/pricing";
import { MARKETS } from "./catalogue";

const calibrationFor = (symbol: string) =>
  MARKET_CALIBRATIONS.find((c) => c.symbol === symbol);

describe("market catalogue", () => {
  it("has a volatility calibration for every market", () => {
    // seed.ts throws on a missing calibration, but only once someone runs it
    // against a database. Catch it here instead.
    const missing = MARKETS.filter((m) => !calibrationFor(m.symbol)).map((m) => m.symbol);
    expect(missing).toEqual([]);
  });

  it("gives every market enough display steps to draw a candle", () => {
    // The regression this guards: a market whose price moves less than one
    // display step per update renders as identical wickless rectangles,
    // because it can only ever reach two or three distinct prices inside a
    // bar. XRP/USDT shipped at 1.5 steps and looked synthetic (Oct 2026).
    //
    // Checked at basePrice. Prices wander, but never far enough to change the
    // verdict — the margin below is an order of magnitude, not a few percent.
    const cramped = MARKETS.map((m) => {
      const c = calibrationFor(m.symbol);
      if (!c) return null;
      return {
        symbol: m.symbol,
        steps: +displayStepsPerUpdate({
          sigma: c.sigma,
          m0: c.m0,
          price: m.basePrice,
          precision: m.precision,
        }).toFixed(2),
      };
    }).filter((r): r is { symbol: string; steps: number } => r !== null)
      .filter((r) => r.steps < MIN_DISPLAY_STEPS_PER_UPDATE);

    expect(cramped).toEqual([]);
  });

  it("keeps every settlement tick visible on the chart", () => {
    // tickSize is the settlement granularity: the algo commits a trade at
    // entryPrice ± tickSize (packages/algo/src/resolve.ts). It must be at
    // least one display step, or the committed price rounds back onto the
    // entry and a win becomes indistinguishable from a loss on the chart.
    //
    // This is the invariant that stops someone "fixing" a cramped market by
    // shrinking tickSize instead of raising precision — shrinking it below
    // the grid buys no extra candle detail and costs settlement clarity.
    // DOGEUSDT, USDJPY and XAUUSD sit exactly at parity today, hence the
    // float tolerance rather than a strict >=.
    const invisible = MARKETS.filter(
      (m) => m.tickSize < 10 ** -m.precision * (1 - 1e-9),
    ).map((m) => `${m.symbol} (tickSize ${m.tickSize}, grid ${10 ** -m.precision})`);
    expect(invisible).toEqual([]);
  });
});
