import { expect, it } from "vitest";
import { PublishedPrices } from "./published-prices";
it("executes against the published chart price until the next chart tick", () => {
  const prices = new PublishedPrices();
  expect(prices.latest("SENSEX", 100)).toBe(0);
  prices.record("SENSEX", 81638, 100);
  // Feed/model changes are deliberately not inputs to execution pricing.
  expect(prices.latest("SENSEX", 103)).toBe(81638);
  prices.record("SENSEX", 81640, 103);
  expect(prices.latest("SENSEX", 104)).toBe(81640);
});
it("rejects stale, future, missing and invalid prices", () => {
  const prices = new PublishedPrices();
  prices.record("SENSEX", 81638, 100);
  expect(prices.latest("SENSEX", 116)).toBe(0);
  expect(prices.latest("SENSEX", 90)).toBe(0);
  expect(prices.latest("NIFTY50", 101)).toBe(0);
  expect(() => prices.record("SENSEX", NaN, 101)).toThrow();
  expect(() => prices.record("SENSEX", 0, 101)).toThrow();
});
