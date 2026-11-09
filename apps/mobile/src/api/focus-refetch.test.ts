import { describe, expect, it } from "vitest";
import { FOCUS_STALE_MS, shouldRefetchOnFocus } from "./focus-refetch";

describe("shouldRefetchOnFocus", () => {
  const now = 1_000_000;
  it("refetches data older than the stale window, and data never fetched", () => {
    expect(shouldRefetchOnFocus({ live: true, dataUpdatedAt: now - FOCUS_STALE_MS - 1, now })).toBe(true);
    expect(shouldRefetchOnFocus({ live: true, dataUpdatedAt: 0, now })).toBe(true);
  });
  it("leaves fresh data alone (a tab switch is not a reason to re-download every loaded page)", () => {
    expect(shouldRefetchOnFocus({ live: true, dataUpdatedAt: now - 1_000, now })).toBe(false);
    expect(shouldRefetchOnFocus({ live: true, dataUpdatedAt: now - FOCUS_STALE_MS, now })).toBe(false);
  });
  it("never fetches while the session is not live", () => {
    expect(shouldRefetchOnFocus({ live: false, dataUpdatedAt: 0, now })).toBe(false);
  });
});
