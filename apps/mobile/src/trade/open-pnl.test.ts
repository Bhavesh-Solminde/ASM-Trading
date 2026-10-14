import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { openPnl } from "./open-pnl";

const trade: Pick<TradeView, "stake" | "payoutPct"> = { stake: 10_000, payoutPct: 85 };

describe("openPnl", () => {
  it("shows the gross return when the trade is winning", () => {
    expect(openPnl(trade, "winning")).toEqual({ sign: "+", amountMinor: 18_500, tone: "up" });
  });
  it("shows the stake when the trade is losing", () => {
    expect(openPnl(trade, "losing")).toEqual({ sign: "−", amountMinor: 10_000, tone: "down" });
  });
  it("shows nothing decided while flat or without a price", () => {
    expect(openPnl(trade, "flat")).toBeNull();
    expect(openPnl(trade, null)).toBeNull();
  });
  it("floors the profit to whole minor units", () => {
    expect(openPnl({ stake: 333, payoutPct: 85 }, "winning")?.amountMinor).toBe(333 + 283);
  });
});
