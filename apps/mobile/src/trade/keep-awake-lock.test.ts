import { describe, expect, it, vi } from "vitest";
import { AWAKE_GRACE_SEC } from "./open-trades";
import { createKeepAwakeLock, foregroundAction, keepAwakePlan, MAX_HOLD_MS, MAX_TIMER_MS } from "./keep-awake-lock";

describe("keepAwakePlan", () => {
  it("does not hold when nothing is open", () => {
    expect(keepAwakePlan(null, 1_000_000)).toEqual({ hold: false });
  });

  it("holds until the deadline, in milliseconds from now", () => {
    expect(keepAwakePlan(1_150, 1_000_000)).toEqual({ hold: true, releaseInMs: 150_000 });
  });

  it("does not hold when the deadline has already passed (or is this very instant)", () => {
    expect(keepAwakePlan(1_000, 1_000_000)).toEqual({ hold: false });
    expect(keepAwakePlan(900, 1_000_000)).toEqual({ hold: false });
  });

  it("never asks for a timer longer than a timer can run (a skewed clock must not release at once)", () => {
    expect(MAX_HOLD_MS).toBeLessThanOrEqual(MAX_TIMER_MS);
    expect(keepAwakePlan(4_000_000_000, 0).hold).toBe(true);
  });

  it("never holds longer than the longest trade plus the grace, however far behind the device clock is", () => {
    expect(MAX_HOLD_MS).toBeGreaterThan(AWAKE_GRACE_SEC * 1000);
    const farFuture = 10_000_000_000;
    expect(keepAwakePlan(farFuture, 0)).toEqual({ hold: true, releaseInMs: MAX_HOLD_MS });
    expect(keepAwakePlan(1_150, 1_000_000)).toEqual({ hold: true, releaseInMs: 150_000 });
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createKeepAwakeLock", () => {
  it("runs a release only after a slower activate has finished, so a release can never be overtaken", async () => {
    const calls: string[] = [];
    const slow = deferred();
    const lock = createKeepAwakeLock({
      activate: () => {
        calls.push("activate:start");
        return slow.promise.then(() => void calls.push("activate:end"));
      },
      deactivate: async () => void calls.push("deactivate"),
      onError: () => {},
    });
    lock.hold();
    lock.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["deactivate", "activate:start"]);
    slow.resolve();
    await lock.idle();
    expect(calls).toEqual(["deactivate", "activate:start", "activate:end", "deactivate"]);
  });

  it("reports a rejected activate instead of swallowing it, and keeps working afterwards", async () => {
    const onError = vi.fn();
    const activate = vi.fn().mockRejectedValueOnce(new Error("no activity")).mockResolvedValue(undefined);
    const lock = createKeepAwakeLock({ activate, deactivate: async () => {}, onError });
    lock.hold();
    await lock.idle();
    expect(onError).toHaveBeenCalledWith("activate", expect.objectContaining({ message: "no activity" }));
    lock.hold();
    await lock.idle();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected deactivate too", async () => {
    const onError = vi.fn();
    const lock = createKeepAwakeLock({ activate: async () => {}, deactivate: () => Promise.reject(new Error("boom")), onError });
    lock.release();
    await lock.idle();
    expect(onError).toHaveBeenCalledWith("deactivate", expect.objectContaining({ message: "boom" }));
  });

  it("reassert cycles release then hold, which re-applies the window flag to the current activity", async () => {
    const calls: string[] = [];
    const lock = createKeepAwakeLock({
      activate: async () => void calls.push("activate"),
      deactivate: async () => void calls.push("deactivate"),
      onError: () => {},
    });
    lock.reassert();
    await lock.idle();
    expect(calls).toEqual(["deactivate", "activate"]);
  });
});

describe("hold clears a stale tag first", () => {
  it("queues deactivate then activate, so a tag left behind by a failed release cannot turn the hold into a no-op", async () => {
    const calls: string[] = [];
    const lock = createKeepAwakeLock({
      activate: async () => void calls.push("activate"),
      deactivate: async () => void calls.push("deactivate"),
      onError: () => {},
    });
    lock.hold();
    await lock.idle();
    expect(calls).toEqual(["deactivate", "activate"]);
  });

  it("still activates when the clearing deactivate rejects", async () => {
    const onError = vi.fn();
    const activate = vi.fn().mockResolvedValue(undefined);
    const lock = createKeepAwakeLock({ activate, deactivate: () => Promise.reject(new Error("no activity")), onError });
    lock.hold();
    await lock.idle();
    expect(onError).toHaveBeenCalledWith("deactivate", expect.anything());
    expect(activate).toHaveBeenCalledTimes(1);
  });
});

describe("foregroundAction", () => {
  it("re-asserts the hold when a deadline is still ahead", () => {
    expect(foregroundAction(1_150, 1_000_000)).toBe("reassert");
  });

  it("releases (idempotently dropping a stale tag) when there is nothing to hold", () => {
    expect(foregroundAction(null, 1_000_000)).toBe("release");
    expect(foregroundAction(900, 1_000_000)).toBe("release");
  });
});
