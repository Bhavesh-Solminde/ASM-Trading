import type { OtcSetStopsInput, TradeView } from "@asm/contracts";
import { expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { EMPTY_STOPS, stopLevels } from "./otc-protection";
import { closeStopsDraft, openStopsEditor, postTradeStops, stopsErrorText } from "./stops-flow";

const position: TradeView = {
  id: "trade-1", accountId: "a", symbol: "EURUSD_OTC", mode: "OTC_FIXED", direction: "UP",
  entryPrice: 100, entryTs: 10, expiryTs: 310, status: "OPEN",
  stake: 1000, payoutPct: 92, exitPrice: null, pnl: 0,
};

it("prepares an unsaved draft, sets one level, updates it, then removes protection", async () => {
  let serverTrade = position;
  const post = vi.fn(async (_path: string, { stopLoss, takeProfit }: OtcSetStopsInput) => {
    serverTrade = { ...serverTrade, stopLoss, takeProfit };
    return { trade: serverTrade };
  });
  const draft = openStopsEditor(position, 100, 2);
  expect(draft.draft).toEqual({ stopLoss: 99.85, takeProfit: 100.15 });
  expect(post).not.toHaveBeenCalled();
  expect(closeStopsDraft(draft).draft).toBeNull();
  const setId = "11111111-1111-4111-8111-111111111111";
  const updateId = "22222222-2222-4222-8222-222222222222";
  const removeId = "33333333-3333-4333-8333-333333333333";
  const set = await postTradeStops(position, { ...draft.draft!, takeProfit: null }, setId, post);
  expect(openStopsEditor(set, 100, 2).draft).toBeNull();
  const updated = await postTradeStops(set, { ...stopLevels(set), stopLoss: 99.60 }, updateId, post);
  expect(stopLevels(await postTradeStops(updated, EMPTY_STOPS, removeId, post))).toEqual(EMPTY_STOPS);
  expect(post.mock.calls).toEqual([
    ["/api/trades/trade-1/stops", { requestId: setId, stopLoss: 99.85, takeProfit: null }],
    ["/api/trades/trade-1/stops", { requestId: updateId, stopLoss: 99.6, takeProfit: null }],
    ["/api/trades/trade-1/stops", { requestId: removeId, stopLoss: null, takeProfit: null }],
  ]);
});

it("surfaces the engine refusal and rejects responses for another trade", async () => {
  const refusal = new ApiError("The stop loss must be below the current price and entry.", 409, "stop_loss_invalid");
  const draft = openStopsEditor(position, 100, 2);
  const requestId = "11111111-1111-4111-8111-111111111111";
  await expect(postTradeStops(position, draft.draft!, requestId, async () => { throw refusal; })).rejects.toBe(refusal);
  expect(stopsErrorText(refusal, (key) => key)).toBe(refusal.message);
  expect(stopsErrorText(new ApiError("timeout", 0, "timeout"), (key) => key)).toBe("trade.stops.timedOut");
  await expect(postTradeStops(position, draft.draft!, requestId, async () => ({
    trade: { ...position, id: "another" },
  }))).rejects.toThrow("Mismatched stops response");
});
