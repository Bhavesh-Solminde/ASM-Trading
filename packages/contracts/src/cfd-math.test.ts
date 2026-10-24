import { expect, it } from "vitest";
import { cfdProfitMinor, cfdLiquidationPrice } from "./cfd-math";
it("scales both directions and caps loss at margin", () => {
  expect(cfdProfitMinor("UP", 100, 100.5, 10000, 100)).toBe(5000);
  expect(cfdProfitMinor("DOWN", 100, 99.5, 10000, 100)).toBe(5000);
  expect(cfdProfitMinor("UP", 100, 98, 10000, 100)).toBe(-10000);
  expect(cfdProfitMinor("DOWN", 100, 102, 10000, 100)).toBe(-10000);
  expect(cfdProfitMinor("UP", 100, 100.5, 10000)).toBe(50);
  expect(cfdLiquidationPrice("UP",100,100)).toBe(99);
  expect(cfdLiquidationPrice("DOWN",100,100)).toBe(101);
});
