import { describe, expect, it, vi } from "vitest";
import { createReplayFeed } from "./replay";
import type { Quote } from "./types";

describe("createReplayFeed", () => {
  it("emits quotes for every requested symbol", async () => {
    vi.useFakeTimers();
    const seen: Quote[] = [];
    const feed = createReplayFeed({
      symbols: ["USDJPY", "AUDNZD_OTC"],
      intervalMs: 1000,
    });
    await feed.start((q) => seen.push(q));

    await vi.advanceTimersByTimeAsync(5000);
    await feed.stop();
    vi.useRealTimers();

    const symbols = new Set(seen.map((q) => q.symbol));
    expect(symbols.has("USDJPY")).toBe(true);
    expect(symbols.has("AUDNZD_OTC")).toBe(true);
  });

  it("emits positive prices with epoch-second timestamps", async () => {
    vi.useFakeTimers();
    const seen: Quote[] = [];
    const feed = createReplayFeed({ symbols: ["USDJPY"], intervalMs: 500 });
    await feed.start((q) => seen.push(q));
    await vi.advanceTimersByTimeAsync(2000);
    await feed.stop();
    vi.useRealTimers();

    expect(seen.length).toBeGreaterThan(0);
    for (const q of seen) {
      expect(q.price).toBeGreaterThan(0);
      expect(Number.isInteger(q.ts)).toBe(true);
    }
  });

  it("stops emitting after stop()", async () => {
    vi.useFakeTimers();
    let count = 0;
    const feed = createReplayFeed({ symbols: ["USDJPY"], intervalMs: 500 });
    await feed.start(() => count++);
    await vi.advanceTimersByTimeAsync(1500);
    const atStop = count;
    await feed.stop();
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();

    expect(count).toBe(atStop);
  });

  it("throws for a symbol absent from the dataset", async () => {
    const feed = createReplayFeed({ symbols: ["NOPE"], intervalMs: 500 });
    await expect(feed.start(() => {})).rejects.toThrow(/NOPE/);
  });
});
