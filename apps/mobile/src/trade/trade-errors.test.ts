import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/errors";
import { tradeErrorKey } from "./trade-errors";

describe("tradeErrorKey", () => {
  it.each([
    ["insufficient_funds", "trade.insufficient"],
    ["market_closed", "trade.marketClosed"],
    ["account_not_active", "trade.accountPaused"],
    ["unknown_asset", "trade.assetUnavailable"],
    ["trading_unavailable", "trade.unavailable"],
  ])("maps the server code %s to %s", (code, key) => {
    expect(tradeErrorKey(new ApiError("English server text", 409, code))).toBe(key);
  });

  it("never shows an unknown server message (it would be English in the Hindi UI): falls back to trade.failed", () => {
    expect(tradeErrorKey(new ApiError("Could not place that trade.", 400, "something_new"))).toBe("trade.failed");
    expect(tradeErrorKey(new ApiError("Could not place that trade.", 500, null))).toBe("trade.failed");
  });

  it("keeps the offline wording", () => {
    expect(tradeErrorKey(new ApiError("No connection.", 0, "offline"))).toBe("common.noConnection");
  });

  it("falls back to trade.failed for anything that is not an ApiError", () => {
    expect(tradeErrorKey(new Error("boom"))).toBe("trade.failed");
  });
});
