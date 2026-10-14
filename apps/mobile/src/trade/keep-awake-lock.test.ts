import { describe, expect, it, vi } from "vitest";
import { createKeepAwakeLock, keepAwakePlan, MAX_TIMER_MS } from "./keep-awake-lock";

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
    expect(keepAwakePlan(4_000_000_000, 0)).toEqual({ hold: true, releaseInMs: MAX_TIMER_MS });
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
    await Promise.resolve();
    expect(calls).toEqual(["activate:start"]);
    slow.resolve();
    await lock.idle();
    expect(calls).toEqual(["activate:start", "activate:end", "deactivate"]);
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
