import { describe, expect, it } from "vitest";
import { shouldShowOffline } from "./offline";

describe("shouldShowOffline", () => {
  it("stays hidden for the first failure and before NetInfo has reported", () => {
    expect(shouldShowOffline(0, true)).toBe(false);
    expect(shouldShowOffline(1, true)).toBe(false);
    expect(shouldShowOffline(0, null)).toBe(false);
    expect(shouldShowOffline(1, null)).toBe(false);
  });
  it("shows after the second consecutive failure", () => {
    expect(shouldShowOffline(2, true)).toBe(true);
    expect(shouldShowOffline(5, null)).toBe(true);
  });
  it("shows as soon as NetInfo says offline", () => {
    expect(shouldShowOffline(0, false)).toBe(true);
  });
});
