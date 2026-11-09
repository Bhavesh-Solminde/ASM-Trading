import { describe, expect, it } from "vitest";
import { tabBarHidden } from "./tab-bar";

describe("tabBarHidden", () => {
  it("hides only the trading tab during fullscreen, preserving navigation on other hubs", () => {
    expect(tabBarHidden({ name: "trade" }, true)).toBe(true);
    expect(tabBarHidden({ name: "trade" }, false)).toBe(false);
    for (const name of ["payments", "account", "history"]) {
      expect(tabBarHidden({ name, state: { index: 0 } }, true)).toBe(false);
    }
    expect(tabBarHidden({ name: "payments", state: { index: 1 } }, true)).toBe(true);
  });
  it("shows the bar on a tab's index screen", () => {
    expect(tabBarHidden({ state: { index: 0 } })).toBe(false);
  });
  it("hides it on a pushed flow screen", () => {
    expect(tabBarHidden({ state: { index: 1 } })).toBe(true);
    expect(tabBarHidden({ state: { index: 3 } })).toBe(true);
  });
  it("shows it when the tab has no nested navigator state yet (never visited, or a plain screen)", () => {
    expect(tabBarHidden({})).toBe(false);
    expect(tabBarHidden({ state: {} })).toBe(false);
  });
});
