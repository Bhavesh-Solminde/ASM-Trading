import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledSaver } from "./throttled-saver";

describe("createThrottledSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst into one save after the interval, built from the newest builder", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<string>({ intervalMs: 5_000, save });
    saver.schedule(() => "a");
    saver.schedule(() => "b");
    saver.schedule(() => "c");
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c");
  });

  it("builds at fire time, not at schedule time", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<number>({ intervalMs: 1_000, save });
    let n = 1;
    saver.schedule(() => n);
    n = 2;
    vi.advanceTimersByTime(1_000);
    expect(save).toHaveBeenCalledWith(2);
  });

  it("skips the save when the builder has nothing to save", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<string>({ intervalMs: 1_000, save });
    saver.schedule(() => null);
    vi.advanceTimersByTime(1_000);
    expect(save).not.toHaveBeenCalled();
  });

  it("starts a fresh window after a save", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<string>({ intervalMs: 1_000, save });
    saver.schedule(() => "a");
    vi.advanceTimersByTime(1_000);
    saver.schedule(() => "b");
    vi.advanceTimersByTime(1_000);
    expect(save.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("drops a pending save on cancel (sign-out)", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<string>({ intervalMs: 1_000, save });
    saver.schedule(() => "a");
    saver.cancel();
    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();
    saver.schedule(() => "b");
    vi.advanceTimersByTime(1_000);
    expect(save).toHaveBeenCalledWith("b");
  });

  it("flushes immediately and leaves nothing pending", () => {
    const save = vi.fn();
    const saver = createThrottledSaver<string>({ intervalMs: 1_000, save });
    saver.schedule(() => "a");
    saver.flush(() => "now");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("now");
    vi.advanceTimersByTime(5_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing save break the caller", () => {
    const saver = createThrottledSaver<string>({
      intervalMs: 1_000,
      save: () => {
        throw new Error("disk full");
      },
    });
    saver.schedule(() => "a");
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(() => saver.flush(() => "b")).not.toThrow();
  });
});
