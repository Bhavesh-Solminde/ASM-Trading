import { expect, it } from "vitest";
import { clampStopLevel, defaultStopLevels } from "./otc-trade-stops";

it("uses the previous chart-distance formula or the ten-tick and price fallbacks", () => {
  const buy = { entryPrice: 100, direction: "UP" as const };
  expect(defaultStopLevels(buy, 100, .01, 2, 20)).toEqual({ stopLoss: 94, takeProfit: 106 });
  expect(defaultStopLevels(buy, 100, .25, 2, 1)).toEqual({ stopLoss: 97.5, takeProfit: 102.5 });
  expect(defaultStopLevels({ ...buy, entryPrice: 2000 }, 2000, .01, 2, null)).toEqual({ stopLoss: 1998, takeProfit: 2002 });
});

it("puts defaults outside both entry and live prices for either direction", () => {
  expect(defaultStopLevels({ entryPrice: 95, direction: "UP" }, 100, .01, 2, null)).toEqual({ stopLoss: 94.99, takeProfit: 100.1 });
  expect(defaultStopLevels({ entryPrice: 105, direction: "DOWN" }, 100, .01, 2, null)).toEqual({ stopLoss: 105.01, takeProfit: 99.9 });
  expect(defaultStopLevels({ entryPrice: 105, direction: "UP" }, 100, .01, 2, null)).toEqual({ stopLoss: 99.9, takeProfit: 105.01 });
  expect(defaultStopLevels({ entryPrice: 95, direction: "DOWN" }, 100, .01, 2, null)).toEqual({ stopLoss: 100.1, takeProfit: 94.99 });
});

it("clamps to a strict tick, including entry prices between ticks and below the first positive tick", () => {
  const trade = { entryPrice: 9.995, direction: "UP" as const };
  expect(clampStopLevel("stopLoss", 11, trade, 10.02, .01, 2)).toBe(9.99);
  expect(clampStopLevel("takeProfit", 9, trade, 10.02, .01, 2)).toBe(10.03);
  expect(clampStopLevel("stopLoss", 0, { ...trade, entryPrice: .01 }, .02, .01, 2)).toBeNull();
});
