// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CfdTradeTicket } from "./CfdTradeTicket";

vi.mock("@/components/shell/PlatformProvider", () => ({ usePlatform: () => ({ balances: { demo: { realBalance: 10000000, bonusBalance: 0 } }, accounts: [{ id: "demo", type: "DEMO" }], assets: [{ symbol: "BTCUSDT", spreadBps: 5 }] }) }));
vi.mock("./StakeSheet", () => ({ StakeSheet: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([[/Buy\s*Price goes up/i, "LONG"], [/Sell\s*Price goes down/i, "SHORT"]] as const)("opens %s without automatic SL/TP or a ticket toggle", async (name, direction) => {
  const onOpened = vi.fn();
  const post = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trade: { id: "demo-trade" }, balances: {} }) });
  vi.stubGlobal("fetch", (url: string, options: RequestInit) => url.includes("market-status") ? Promise.resolve({ ok: true, json: async () => ({ status: "open" }) }) : post(url, options));
  render(h(CfdTradeTicket, { symbol: "BTCUSDT", pair: "BTC/USDT", accountId: "demo", currency: "INR", onOpened }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/Spread fee \(5%\): ₹5.00/)).toBeTruthy();
  expect(screen.queryByText("Stop Loss / Take Profit")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name })));
  expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.parse(post.mock.calls[0]![1].body)).toEqual({ symbol: "BTCUSDT", direction, accountId: "demo", stake: 10000, durationSec: 300 });
  expect(onOpened).toHaveBeenCalledTimes(1);
});
