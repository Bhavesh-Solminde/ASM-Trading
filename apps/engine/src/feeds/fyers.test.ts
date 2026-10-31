import { afterEach, describe, expect, it, vi } from "vitest";
import { createFyersFeed, parseFyersQuote } from "./fyers";
import type { FyersSocketEvent, FyersConnector } from "./fyers";
import type { Quote } from "./types";

const mapping = { NIFTY50: "NSE:NIFTY50-INDEX", SENSEX: "BSE:SENSEX-INDEX" };
const reverse = Object.fromEntries(Object.entries(mapping).map(([a,b]) => [b,a]));
const tick = { type: "if", symbol: mapping.NIFTY50, ltp: "22600", exch_feed_time: "1792800000" };

describe("FYERS index stream parser", () => {
  it("maps a full-mode index tick and preserves its source timestamp", () => {
    expect(parseFyersQuote(tick, reverse)).toEqual({ symbol: "NIFTY50", price: 22600, ts: 1792800000 });
    expect(parseFyersQuote({ ...tick, symbol: mapping.SENSEX, ltp: 73123.83 }, reverse)?.symbol).toBe("SENSEX");
  });
  it("normalizes millisecond timestamps", () => {
    expect(parseFyersQuote({ ...tick, exch_feed_time: 1792800000123 }, reverse)?.ts).toBe(1792800000);
  });
  it("uses receipt time only when the provider omits exchange time", () => {
    expect(parseFyersQuote({ ...tick, exch_feed_time: undefined }, reverse, 1792800005123)?.ts).toBe(1792800005);
  });
  it.each([null, "broken", { ...tick, type: "cn" }, { ...tick, type: "dp" },
    { ...tick, symbol: "NSE:UNKNOWN-INDEX" }, { ...tick, ltp: 0 }, { ...tick, ltp: -1 },
    { ...tick, ltp: "NaN" }, { ...tick, ltp: true }, { ...tick, s: "error" }])("ignores unusable frames %#", (frame) => {
    expect(parseFyersQuote(frame, reverse)).toBeNull();
  });
});

function harness(initialToken: string | null = "token-one") {
  let token = initialToken;
  const sessions: { send: (e: FyersSocketEvent) => void; close: ReturnType<typeof vi.fn> }[] = [];
  const connector = vi.fn<FyersConnector>((_, __, send) => {
    const close = vi.fn(async () => {});
    sessions.push({ send, close });
    return { close };
  });
  const getToken = vi.fn(async () => token);
  const feed = createFyersFeed({ appId: "TEST-100", mapping, getToken, connectSocket: connector, tokenCheckMs: 100, connectTimeoutMs: 500 });
  const quotes: Quote[] = [];
  return { feed, quotes, sessions, connector, getToken, setToken: (next: string | null) => { token = next; } };
}

describe("FYERS WebSocket lifecycle", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("opens one stream for all symbols and emits ticks immediately without REST polling", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(q => h.quotes.push(q));
    expect(h.connector).toHaveBeenCalledWith("TEST-100:token-one", Object.values(mapping), expect.any(Function));
    h.sessions[0]!.send({ type: "connect" });
    h.sessions[0]!.send({ type: "message", data: [tick, { type: "sub", s: "ok" }] });
    expect(h.quotes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.connector).toHaveBeenCalledTimes(1);
    await h.feed.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("picks up authorization completed after engine startup", async () => {
    vi.useFakeTimers();
    const h = harness(null);
    await h.feed.start(() => {});
    expect(h.connector).not.toHaveBeenCalled();
    h.setToken("new-token");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.connector).toHaveBeenCalledTimes(1);
    await h.feed.stop();
  });
  it.each(["close", "error"] as const)("reconnects with full subscriptions after %s; ignores old events", async type => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(q => h.quotes.push(q));
    h.sessions[0]!.send({ type: "connect" });
    h.sessions[0]!.send({ type });
    h.sessions[0]!.send({ type: "close" });
    h.sessions[0]!.send({ type: "message", data: tick });
    await vi.advanceTimersByTimeAsync(900);
    expect(h.connector).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.connector).toHaveBeenCalledTimes(2);
    expect(h.sessions[0]!.close).toHaveBeenCalledOnce();
    expect(h.quotes).toHaveLength(0);
    expect(h.connector.mock.calls[1]![1]).toEqual(Object.values(mapping));
    await h.feed.stop();
  });
  it("closes expired credentials and reconnects with rotated credentials", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(() => {});
    h.sessions[0]!.send({ type: "connect" });
    h.setToken(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sessions[0]!.close).toHaveBeenCalledOnce();
    h.setToken("token-two");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.connector.mock.calls[1]![0]).toBe("TEST-100:token-two");
    await h.feed.stop();
  });
  it("times out a stuck handshake and backs off before retrying", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(() => {});
    await vi.advanceTimersByTimeAsync(500);
    expect(h.sessions[0]!.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.connector).toHaveBeenCalledTimes(2);
    await h.feed.stop();
  });
  it("retries subscription rejection without emitting it as a quote", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(q => h.quotes.push(q));
    h.sessions[0]!.send({ type: "connect" });
    h.sessions[0]!.send({ type: "message", data: { s: "error", type: "sub" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.connector).toHaveBeenCalledTimes(2);
    expect(h.quotes).toHaveLength(0);
    await h.feed.stop();
  });
  it("stop cancels reconnects and ignores late messages", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.feed.start(q => h.quotes.push(q));
    h.sessions[0]!.send({ type: "close" });
    await h.feed.stop();
    await vi.advanceTimersByTimeAsync(30000);
    h.sessions[0]!.send({ type: "message", data: tick });
    expect(h.connector).toHaveBeenCalledTimes(1);
    expect(h.quotes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not open a socket if stopped during a pending token read", async () => {
    let resolve!: (s: string) => void;
    const connector = vi.fn<FyersConnector>();
    const feed = createFyersFeed({ appId: "TEST", mapping, connectSocket: connector, getToken: () => new Promise(r => { resolve = r; }) });
    const start = feed.start(() => {});
    const stop = feed.stop();
    resolve("late-token");
    await Promise.all([start, stop]);
    expect(connector).not.toHaveBeenCalled();
  });
  it("does not create duplicate connections on repeated start", async () => {
    const h = harness();
    await h.feed.start(() => {});
    await h.feed.start(() => {});
    expect(h.connector).toHaveBeenCalledOnce();
    await h.feed.stop();
  });
});
