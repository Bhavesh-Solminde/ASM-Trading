import { describe, expect, it, vi } from "vitest";
import { configurePushCleanup, unregisterPushDevice } from "./cleanup";
describe("push cleanup deadline", () => {
  it("bounds a hung cleanup so remote logout can proceed", async () => {
    vi.useFakeTimers();
    try {
      configurePushCleanup(() => new Promise<void>(() => {}));
      let done = false; const pending = unregisterPushDevice("old").then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(29_999); expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1); await pending; expect(done).toBe(true);
    } finally { configurePushCleanup(async () => {}); vi.useRealTimers(); }
  });
});
