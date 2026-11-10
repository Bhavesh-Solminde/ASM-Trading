// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCfdMarketStatus } from "./use-cfd-market-status";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("follows market close and reopen without depending on incoming ticks", async () => {
  let status = "closed";
  const fetchStatus = vi.fn(async () => ({ ok: true, json: async () => ({ status }) }));
  vi.stubGlobal("fetch", fetchStatus);
  const { result } = renderHook(() => useCfdMarketStatus("NIFTY50", true));
  expect(result.current).toBe("unavailable");
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBe("closed");
  status = "open";
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(result.current).toBe("open");
  status = "closed";
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(result.current).toBe("closed");
});

it("does not reuse the old symbol's open status while the new market is loading", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("BTCUSDT")
    ? Promise.resolve({ ok: true, json: async () => ({ status: "open" }) })
    : new Promise(() => {})));
  const { result, rerender } = renderHook(({ symbol }) => useCfdMarketStatus(symbol, true), { initialProps: { symbol: "BTCUSDT" } });
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBe("open");
  rerender({ symbol: "NIFTY50" });
  expect(result.current).toBe("unavailable");
});

it("does not poll when CFD trading is disabled and stops polling on unmount", async () => {
  const fetchStatus = vi.fn(async () => ({ ok: true, json: async () => ({ status: "open" }) }));
  vi.stubGlobal("fetch", fetchStatus);
  const { rerender, unmount } = renderHook(({ enabled }) => useCfdMarketStatus("NIFTY50", enabled), { initialProps: { enabled: false } });
  expect(fetchStatus).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await act(async () => { await Promise.resolve(); });
  expect(fetchStatus).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fetchStatus).toHaveBeenCalledTimes(1);
});
