import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineSocket, FatalSocketError, HANDSHAKE_TIMEOUT_MS, type SocketStatus } from "./engine-socket";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
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

// A setTimeout promise never resolves under fake timers, so flush by advancing the fake clock by 0.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("EngineSocket", () => {
  let statuses: SocketStatus[];
  let messages: unknown[];
  let online: boolean;
  let fetchTicket: ReturnType<typeof vi.fn<() => Promise<string>>>;
  let socket: EngineSocket;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeWS.instances = [];
    statuses = [];
    messages = [];
    online = true;
    fetchTicket = vi.fn<() => Promise<string>>(async () => "ticket-1");
    socket = new EngineSocket({
      url: "wss://test/ws",
      fetchTicket,
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      onMessage: (m) => messages.push(m),
      onStatus: (s) => statuses.push(s),
      isOnline: () => online,
      random: () => 0.5,
    });
  });

  it("authenticates with a fresh ticket, then subscribes", async () => {
    socket.subscribe("EURUSD", "1m");
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeWS.instances[0]!;
    ws.open();
    expect(ws.sent[0]).toEqual({ type: "auth", token: "ticket-1" });
    ws.receive({ type: "authed" });
    expect(ws.sent[1]).toEqual({ type: "subscribe", symbol: "EURUSD", timeframe: "1m" });
    expect(statuses.at(-1)).toEqual({ phase: "authed", consecutiveFailures: 0 });
  });

  it("re-subscribes to the active market after reconnecting", async () => {
    socket.subscribe("EURUSD", "5m");
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.receive({ type: "authed" });
    FakeWS.instances[0]!.close();
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeWS.instances[1]!;
    second.open();
    second.receive({ type: "authed" });
    expect(second.sent).toContainEqual({ type: "subscribe", symbol: "EURUSD", timeframe: "5m" });
  });

  it("counts consecutive failures and backs off", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.close();
    expect(statuses.at(-1)).toMatchObject({ phase: "closed", consecutiveFailures: 1 });
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWS.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1]!.close();
    expect(statuses.at(-1)).toMatchObject({ phase: "closed", consecutiveFailures: 2 });
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWS.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWS.instances).toHaveLength(3);
  });

  it("resets the failure count once authed", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.close();
    await vi.advanceTimersByTimeAsync(500);
    FakeWS.instances[1]!.open();
    FakeWS.instances[1]!.receive({ type: "authed" });
    expect(statuses.at(-1)).toEqual({ phase: "authed", consecutiveFailures: 0 });
  });

  it("does not reconnect after stop()", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    socket.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(statuses.at(-1)).toEqual({ phase: "idle", consecutiveFailures: 0 });
  });

  it("forwards server messages", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.receive({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
    expect(messages).toContainEqual({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
  });

  it("ignores malformed frames", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeWS.instances[0]!;
    ws.open();
    ws.onmessage?.({ data: "not json" });
    expect(messages).toEqual([]);
  });

  it("switches market on an open socket: unsubscribe the old symbol, subscribe the new", async () => {
    socket.subscribe("EURUSD", "1m");
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeWS.instances[0]!;
    ws.open();
    ws.receive({ type: "authed" });
    socket.subscribe("GBPUSD", "5m");
    expect(ws.sent.slice(2)).toEqual([
      { type: "unsubscribe", symbol: "EURUSD" },
      { type: "subscribe", symbol: "GBPUSD", timeframe: "5m" },
    ]);
  });

  it("asks for older candles on the active market only once authed", async () => {
    socket.subscribe("EURUSD", "1m");
    socket.loadOlder(100);
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeWS.instances[0]!;
    ws.open();
    ws.receive({ type: "authed" });
    socket.loadOlder(100);
    expect(ws.sent.at(-1)).toEqual({ type: "candles:loadOlder", symbol: "EURUSD", timeframe: "1m", before: 100, limit: 200 });
    expect(ws.sent.filter((m) => (m as { type: string }).type === "candles:loadOlder")).toHaveLength(1);
  });

  describe("ticket failures", () => {
    it("backs off and retries when the ticket request fails", async () => {
      fetchTicket.mockRejectedValueOnce(new Error("offline"));
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      expect(statuses.at(-1)).toMatchObject({ phase: "closed", consecutiveFailures: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchTicket).toHaveBeenCalledTimes(2);
      expect(FakeWS.instances).toHaveLength(1);
    });

    it("stops retrying on a fatal ticket error, and start() can try again later", async () => {
      fetchTicket.mockRejectedValueOnce(new FatalSocketError("unauthenticated"));
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      expect(statuses.at(-1)).toMatchObject({ phase: "closed" });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchTicket).toHaveBeenCalledTimes(1);
      expect(FakeWS.instances).toHaveLength(0);

      socket.start();
      await vi.runOnlyPendingTimersAsync();
      expect(FakeWS.instances).toHaveLength(1);
    });

    it("drops a ticket that resolves after stop() + start() (no duplicate socket)", async () => {
      let resolveFirst: (t: string) => void = () => {};
      fetchTicket.mockImplementationOnce(() => new Promise<string>((r) => (resolveFirst = r)));
      socket.start();
      await vi.runOnlyPendingTimersAsync(); // first connect is waiting on its ticket
      socket.stop();
      socket.start();
      await vi.runOnlyPendingTimersAsync(); // second connect gets ticket-1
      expect(FakeWS.instances).toHaveLength(1);
      resolveFirst("stale");
      await flush();
      expect(FakeWS.instances).toHaveLength(1);
    });
  });

  describe("handshake timeout", () => {
    it("closes and backs off when the socket never authenticates", async () => {
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS - 1);
      expect(FakeWS.instances[0]!.readyState).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWS.instances[0]!.readyState).toBe(3);
      expect(statuses.at(-1)).toMatchObject({ phase: "closed", consecutiveFailures: 1 });
    });

    it("is cleared once authed", async () => {
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      FakeWS.instances[0]!.open();
      FakeWS.instances[0]!.receive({ type: "authed" });
      await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS * 3);
      expect(FakeWS.instances[0]!.readyState).toBe(1);
    });
  });

  describe("while offline", () => {
    it("does not connect or burn attempts, then connects promptly when the network returns", async () => {
      online = false;
      socket.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeWS.instances).toHaveLength(0);
      expect(fetchTicket).not.toHaveBeenCalled();
      expect(statuses.at(-1)).toEqual({ phase: "closed", consecutiveFailures: 0 });

      online = true;
      socket.networkRestored();
      await flush();
      expect(FakeWS.instances).toHaveLength(1);
    });

    it("does not count a drop that happens offline, and reconnects on restore", async () => {
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      FakeWS.instances[0]!.open();
      FakeWS.instances[0]!.receive({ type: "authed" });

      online = false;
      FakeWS.instances[0]!.close();
      expect(statuses.at(-1)).toEqual({ phase: "closed", consecutiveFailures: 0 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeWS.instances).toHaveLength(1);

      online = true;
      socket.networkRestored();
      await flush();
      expect(FakeWS.instances).toHaveLength(2);
    });

    it("skips a pending backoff wait when the network returns", async () => {
      socket.start();
      await vi.runOnlyPendingTimersAsync();
      FakeWS.instances[0]!.close(); // online failure: 500ms backoff armed
      expect(statuses.at(-1)).toMatchObject({ consecutiveFailures: 1 });

      socket.networkRestored();
      await flush();
      expect(FakeWS.instances).toHaveLength(2);
      FakeWS.instances[1]!.open();
      FakeWS.instances[1]!.receive({ type: "authed" });
      // and the cancelled backoff timer must not open a third
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeWS.instances).toHaveLength(2);
    });

    it("networkRestored() is a no-op while connecting, authed or stopped", async () => {
      socket.networkRestored(); // stopped
      await flush();
      expect(FakeWS.instances).toHaveLength(0);

      socket.start();
      await vi.runOnlyPendingTimersAsync();
      socket.networkRestored(); // handshake in progress
      await flush();
      expect(FakeWS.instances).toHaveLength(1);
      FakeWS.instances[0]!.open();
      FakeWS.instances[0]!.receive({ type: "authed" });
      socket.networkRestored(); // authed
      await flush();
      expect(FakeWS.instances).toHaveLength(1);
    });
  });
});
