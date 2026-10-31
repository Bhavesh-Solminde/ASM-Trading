import { describe, expect, it } from "vitest";
import { STALE_CURRENCY_NOTICE, isStaleCurrencyRefusal } from "./trade-refusal";

describe("isStaleCurrencyRefusal", () => {
  it("is true for the server's 409 currency_changed refusal", () => {
    expect(isStaleCurrencyRefusal(409, { error: "x", code: "currency_changed" })).toBe(true);
  });

  it("is false for other 409s, other codes, other statuses and bodies that are not objects", () => {
    expect(isStaleCurrencyRefusal(409, { error: "x" })).toBe(false);
    expect(isStaleCurrencyRefusal(409, { code: "something_else" })).toBe(false);
    expect(isStaleCurrencyRefusal(400, { code: "currency_changed" })).toBe(false);
    expect(isStaleCurrencyRefusal(409, null)).toBe(false);
    expect(isStaleCurrencyRefusal(409, "currency_changed")).toBe(false);
  });

  it("has a notice that tells the user the page is reloading and nothing was placed", () => {
    expect(STALE_CURRENCY_NOTICE).toMatch(/reload/i);
    expect(STALE_CURRENCY_NOTICE).toMatch(/no trade/i);
  });
});
