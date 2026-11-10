import { afterEach, expect, it } from "vitest";
import { clearDisplayedQuote, commitDisplayedQuote, displayedQuoteFor } from "./displayed-quote";
afterEach(clearDisplayedQuote);
it("only commits the shown quote; switching or generation changes invalidate its lookup", () => {
  const shown = { symbol: "EURUSD", timeframe: "1m" as const, generation: "a", token: "shown", price: 1.234567, expiresAt: 5000 };
  commitDisplayedQuote(shown);
  expect(displayedQuoteFor("EURUSD", "1m", "a")).toBe(shown);
  expect(displayedQuoteFor("EURUSD", "5m", "a")).toBeNull();
  expect(displayedQuoteFor("EURUSD", "1m", "b")).toBeNull();
  expect(displayedQuoteFor("BTCUSDT", "1m", "a")).toBeNull();
  commitDisplayedQuote({ ...shown, token: "new", price: 1.234568 });
  expect(shown.price).toBe(1.234567);
  clearDisplayedQuote(); expect(displayedQuoteFor("EURUSD", "1m", "a")).toBeNull();
});
