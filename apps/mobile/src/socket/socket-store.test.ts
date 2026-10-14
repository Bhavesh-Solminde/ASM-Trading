import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
const net = vi.hoisted(() => ({
  listener: null as ((s: { isConnected: boolean | null }) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock("@/api/client", () => apiMock);
vi.mock("@/config", () => ({ appConfig: () => ({ wsUrl: "wss://test/ws" }) }));
vi.mock("expo-crypto", () => ({ getRandomBytes: () => new Uint8Array([128, 0, 0, 0]) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (fn: (s: { isConnected: boolean | null }) => void) => {
      net.listener = fn;
      return net.unsubscribe;
    },
  },
}));

import type { Bootstrap } from "@asm/contracts";
import { ApiError } from "@/api/errors";
import { useSocket } from "./socket-store";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: Array<{ type: string } & Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as { type: string } & Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const trade = {
  id: "t1",
  accountId: "a1",
  symbol: "EURUSD",
  direction: "UP",
  stake: 10000,
  payoutPct: 85,
  entryPrice: 1.1,
  entryTs: 100,
  expiryTs: 160,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
} as const;

const boot = {
  accounts: [{ id: "a1", type: "DEMO", currency: "USD", realBalance: 500, bonusBalance: 20 }],
  recentTrades: [trade, { junk: true }],
} as unknown as Bootstrap;

async function connect(): Promise<FakeWS> {
  useSocket.getState().start();
  await vi.advanceTimersByTimeAsync(0);
  const ws = FakeWS.instances.at(-1)!;
  ws.open();
  ws.receive({ type: "authed" });
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("WebSocket", FakeWS);
  FakeWS.instances = [];
  apiMock.api.mockReset();
  apiMock.api.mockResolvedValue({ ticket: "tk" });
  useSocket.getState().reset(); // also tears down the previous test's NetInfo subscription
  net.listener = null;
  net.unsubscribe.mockClear();
});

describe("useSocket", () => {
  it("seeds trades and balances from the bootstrap, skipping malformed trades", () => {
    useSocket.getState().seed(boot);
    expect(useSocket.getState().trades).toEqual({
      tradesByAccount: { a1: [trade] },
      balances: { a1: { realBalance: 500, bonusBalance: 20 } },
    });
  });

  it("keeps a socket balance that arrived after the bootstrap request started", async () => {
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    const requestedAt = Date.now() - 10_000;
    ws.receive({ type: "balance:update", accountId: "a1", realBalance: 1, bonusBalance: 2 });
    useSocket.getState().seed(boot, requestedAt);
    expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 1, bonusBalance: 2 });
  });

  it("applies a bootstrap that started after the last socket balance (e.g. a deposit refetch)", async () => {
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    ws.receive({ type: "balance:update", accountId: "a1", realBalance: 1, bonusBalance: 2 });
    useSocket.getState().seed(boot, Date.now() + 10_000);
    expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 500, bonusBalance: 20 });
  });

  it("does not roll back a settlement when re-seeded from an older bootstrap", async () => {
    useSocket.getState().seed(boot);
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    ws.receive({ type: "trade:settled", trade: { ...trade, status: "WON", pnl: 85 } });
    useSocket.getState().seed(boot);
    expect(useSocket.getState().trades.tradesByAccount["a1"]?.[0]?.status).toBe("WON");
  });

  it("notifies a subscriber once per settlement even when two arrive back to back", async () => {
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    const seenIds: string[] = [];
    const unsubscribe = useSocket.subscribe((s, prev) => {
      if (s.lastSettled && s.lastSettled !== prev.lastSettled) seenIds.push(s.lastSettled.id);
    });
    ws.receive({ type: "trade:settled", trade: { ...trade, id: "t1", status: "WON", pnl: 85 } });
    ws.receive({ type: "trade:settled", trade: { ...trade, id: "t2", status: "LOST", pnl: -10000 } });
    unsubscribe();
    expect(seenIds).toEqual(["t1", "t2"]);
  });

  it("publishes a settlement recovered by a bootstrap (open in the store, settled in the response) as `recovered`, once", () => {
    useSocket.getState().seed(boot);
    expect(useSocket.getState().recovered).toEqual([]);
    const settled = { ...trade, status: "LOST", pnl: -10000 };
    const bootSettled = { ...boot, recentTrades: [settled] } as unknown as Bootstrap;
    useSocket.getState().seed(bootSettled);
    expect(useSocket.getState().recovered.map((t) => t.id)).toEqual(["t1"]);
    const first = useSocket.getState().recovered;
    // A second identical response recovers nothing new and must not re-publish the same list.
    useSocket.getState().seed(bootSettled);
    expect(useSocket.getState().recovered).toBe(first);
  });

  it("does not publish trades the socket already settled, or ones it never saw open", async () => {
    useSocket.getState().seed(boot);
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    ws.receive({ type: "trade:settled", trade: { ...trade, status: "WON", pnl: 85 } });
    useSocket.getState().seed({ ...boot, recentTrades: [{ ...trade, status: "WON", pnl: 85 }, { ...trade, id: "old", status: "LOST" }] } as unknown as Bootstrap);
    expect(useSocket.getState().recovered).toEqual([]);
  });

  it("connects with a ticket, subscribes, and folds server messages into chart and trades", async () => {
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    expect(apiMock.api).toHaveBeenCalledWith(
      "/api/auth/ws-ticket",
      expect.objectContaining({ method: "POST", silentRateLimit: true }),
    );
    expect(ws.url).toBe("wss://test/ws");
    expect(ws.sent).toEqual([
      { type: "auth", token: "tk" },
      { type: "subscribe", symbol: "EURUSD", timeframe: "1m" },
    ]);
    expect(useSocket.getState().phase).toBe("authed");

    ws.receive({ type: "tick", symbol: "EURUSD", price: 1.5, ts: 1000 });
    expect(useSocket.getState().chart.lastPrice).toBe(1.5);
    ws.receive({ type: "tick", symbol: "GBPUSD", price: 9, ts: 1000 });
    expect(useSocket.getState().chart.lastPrice).toBe(1.5);

    const settled = { ...trade, status: "WON", pnl: 85 };
    ws.receive({ type: "trade:settled", trade: settled });
    expect(useSocket.getState().lastSettled).toEqual(settled);
    ws.receive({ type: "balance:update", accountId: "a1", realBalance: 1, bonusBalance: 2 });
    expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 1, bonusBalance: 2 });
  });

  it("does not mark loadingOlder when the request could not be sent", async () => {
    useSocket.getState().subscribe("EURUSD", "1m");
    useSocket.setState({
      chart: { ...useSocket.getState().chart, candles: [{ openTs: 600, o: 1, h: 1, l: 1, c: 1 }] },
    });
    useSocket.getState().loadOlder(); // socket not authed
    expect(useSocket.getState().chart.loadingOlder).toBe(false);

    const ws = await connect();
    useSocket.getState().loadOlder();
    expect(ws.sent.at(-1)).toMatchObject({ type: "candles:loadOlder", before: 600 });
    expect(useSocket.getState().chart.loadingOlder).toBe(true);
    useSocket.getState().loadOlder(); // already in flight
    expect(ws.sent.filter((m) => m.type === "candles:loadOlder")).toHaveLength(1);

    ws.receive({ type: "candles:older", symbol: "EURUSD", timeframe: "1m", candles: [], reachedStart: true });
    expect(useSocket.getState().chart).toMatchObject({ loadingOlder: false, reachedStart: true });
  });

  it("stops retrying when the ticket request says unauthenticated", async () => {
    apiMock.api.mockRejectedValue(new ApiError("Not signed in.", 401, "unauthenticated"));
    useSocket.getState().start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(apiMock.api).toHaveBeenCalledTimes(1);
    expect(useSocket.getState().phase).toBe("closed");
  });

  it.each(["maintenance", "blocked", "upgrade"])("stops retrying when the ticket request hits the %s gate", async (gate) => {
    apiMock.api.mockRejectedValue(new ApiError(gate, 503, gate));
    useSocket.getState().start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(apiMock.api).toHaveBeenCalledTimes(1);
    expect(useSocket.getState().phase).toBe("closed");
  });

  it("keeps backing off on a rate-limited ticket request", async () => {
    apiMock.api.mockRejectedValue(new ApiError("Too many requests.", 429, "rate_limited"));
    useSocket.getState().start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(apiMock.api).toHaveBeenCalledTimes(2);
  });

  it("backs off on other ticket errors and the failure count feeds the banner", async () => {
    apiMock.api.mockRejectedValue(new ApiError("No connection.", 0, "offline"));
    useSocket.getState().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSocket.getState().consecutiveFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(useSocket.getState().consecutiveFailures).toBe(2);
    expect(apiMock.api).toHaveBeenCalledTimes(2);
  });

  it("holds reconnects while NetInfo says offline and reconnects when it comes back", async () => {
    useSocket.getState().start();
    net.listener!({ isConnected: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apiMock.api).not.toHaveBeenCalled();
    expect(useSocket.getState()).toMatchObject({ phase: "closed", consecutiveFailures: 0 });

    net.listener!({ isConnected: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it("recycles an authed socket when the network returns", async () => {
    const ws = await connect();
    net.listener!({ isConnected: false });
    expect(ws.readyState).toBe(1); // going offline alone does not close it
    net.listener!({ isConnected: true });
    expect(ws.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWS.instances).toHaveLength(2);
    expect(useSocket.getState().consecutiveFailures).toBe(0);
  });

  it("reset() unsubscribes from NetInfo and forgets a stale offline reading", async () => {
    useSocket.getState().start();
    net.listener!({ isConnected: false });
    useSocket.getState().reset();
    expect(net.unsubscribe).toHaveBeenCalledTimes(1);

    useSocket.getState().start(); // NetInfo has not reported yet: must not be held by the old "offline"
    await vi.advanceTimersByTimeAsync(0);
    expect(apiMock.api).toHaveBeenCalledTimes(1);
  });

  it("stop() closes the socket and stops watching the network; start() resumes", async () => {
    const ws = await connect();
    useSocket.getState().stop();
    expect(ws.readyState).toBe(3);
    expect(net.unsubscribe).toHaveBeenCalled();
    expect(useSocket.getState().phase).toBe("idle");
    await connect();
    expect(FakeWS.instances).toHaveLength(2);
  });

  it("reset() forgets the previous user's data and does not resubscribe their market", async () => {
    useSocket.getState().seed(boot);
    useSocket.getState().subscribe("EURUSD", "1m");
    const ws = await connect();
    ws.receive({ type: "trade:settled", trade: { ...trade, status: "WON" } });

    useSocket.getState().reset();
    expect(ws.readyState).toBe(3);
    expect(useSocket.getState()).toMatchObject({
      phase: "idle",
      consecutiveFailures: 0,
      lastSettled: null,
      recovered: [],
      trades: { tradesByAccount: {}, balances: {} },
      chart: { symbol: "", lastPrice: null },
    });

    const next = await connect();
    expect(next.sent.some((m) => m.type === "subscribe")).toBe(false);
  });
  describe("applyOpenResult", () => {
    const result = { trade, balances: { realBalance: 111, bonusBalance: 22 } };

    it("with the socket down, applies the HTTP balances and stamps them so an older bootstrap cannot overwrite them", () => {
      useSocket.getState().seed(boot);
      const before = Date.now();
      useSocket.getState().applyOpenResult(result);
      expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 111, bonusBalance: 22 });
      expect(useSocket.getState().balanceAt["a1"]).toBeGreaterThanOrEqual(before);

      // A bootstrap whose request started before the open must not roll the balance back.
      useSocket.getState().seed(boot, before - 1);
      expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 111, bonusBalance: 22 });
    });

    it("with the socket live, keeps the socket's balance and does not stamp", async () => {
      useSocket.getState().seed(boot);
      useSocket.getState().subscribe("EURUSD", "1m");
      await connect();
      useSocket.getState().applyOpenResult(result);
      expect(useSocket.getState().trades.balances["a1"]).toEqual({ realBalance: 500, bonusBalance: 20 });
      expect(useSocket.getState().balanceAt["a1"]).toBeUndefined();
      expect(useSocket.getState().trades.tradesByAccount["a1"]?.[0]?.id).toBe("t1");
    });
  });
});
