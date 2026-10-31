import { expect, it } from "vitest";
import { cfdProfitMinor, cfdLiquidationPrice, cfdMaxProfitPrice } from "./cfd-math";
it("scales both directions and caps loss at margin", () => {
  expect(cfdProfitMinor("UP", 100, 100.5, 10000, 100)).toBe(5000);
  expect(cfdProfitMinor("DOWN", 100, 99.5, 10000, 100)).toBe(5000);
  expect(cfdProfitMinor("UP", 100, 98, 10000, 100)).toBe(-10000);
  expect(cfdProfitMinor("DOWN", 100, 102, 10000, 100)).toBe(-10000);
  expect(cfdProfitMinor("UP", 100, 100.5, 10000)).toBe(50);
  expect(cfdLiquidationPrice("UP",100,100)).toBe(99);
  expect(cfdLiquidationPrice("DOWN",100,100)).toBe(101);
});

it.each(["UP", "DOWN", "LONG", "SHORT"])("caps displayed and settled %s profit at twice the stake", direction => {
  const isLong = direction === "UP" || direction === "LONG";
  const cap = cfdMaxProfitPrice(direction, 100, 100);
  expect(cap).toBe(isLong ? 102 : 98);
  expect(cfdProfitMinor(direction, 100, cap, 10000, 100)).toBe(20000);
  expect(cfdProfitMinor(direction, 100, isLong ? 110 : 90, 10000, 100)).toBe(20000);
  expect(cfdProfitMinor(direction, 100, isLong ? 101 : 99, 10000, 100)).toBe(10000);
});
