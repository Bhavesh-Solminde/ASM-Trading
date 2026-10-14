import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parsePersisted, prefsFor, withPrefs } from "./prefs-model";

describe("per-user trade prefs", () => {
  it("gives defaults to a user with no saved prefs, and to nobody", () => {
    expect(prefsFor({}, "u1")).toEqual(DEFAULT_PREFS);
    expect(prefsFor({}, null)).toEqual(DEFAULT_PREFS);
  });

  it("keeps each user's choices apart", () => {
    let all = withPrefs({}, "u1", { chartType: "line", symbol: "EURUSD" });
    all = withPrefs(all, "u2", { chartType: "area" });
    expect(prefsFor(all, "u1").chartType).toBe("line");
    expect(prefsFor(all, "u1").symbol).toBe("EURUSD");
    expect(prefsFor(all, "u2").chartType).toBe("area");
    expect(prefsFor(all, "u2").symbol).toBeNull();
  });

  it("merges a partial update into what the user already had", () => {
    let all = withPrefs({}, "u1", { chartType: "bars", favourites: ["A"] });
    all = withPrefs(all, "u1", { timeframe: "5m" });
    expect(prefsFor(all, "u1")).toMatchObject({ chartType: "bars", favourites: ["A"], timeframe: "5m" });
  });

  it("does not mutate the previous map", () => {
    const before = withPrefs({}, "u1", { chartType: "line" });
    withPrefs(before, "u1", { chartType: "area" });
    expect(prefsFor(before, "u1").chartType).toBe("line");
  });

  it("returns the same object for an unchanged user so selectors stay stable", () => {
    const all = withPrefs({}, "u1", { chartType: "line" });
    expect(prefsFor(all, "u1")).toBe(prefsFor(all, "u1"));
    expect(prefsFor({}, "x")).toBe(prefsFor({}, "y"));
  });
});

describe("parsePersisted", () => {
  it("accepts a well-formed map", () => {
    const raw = { u1: { ...DEFAULT_PREFS, chartType: "line", favourites: ["A", "B"], expirySec: 300 } };
    expect(parsePersisted(raw).u1?.chartType).toBe("line");
    expect(parsePersisted(raw).u1?.favourites).toEqual(["A", "B"]);
    expect(parsePersisted(raw).u1?.expirySec).toBe(300);
  });

  it("falls back to defaults field by field instead of dropping the user", () => {
    const out = parsePersisted({ u1: { chartType: "pie", timeframe: "7m", favourites: "nope", expirySec: -4, symbol: "EURUSD" } });
    expect(out.u1).toMatchObject({ chartType: "candles", timeframe: "1m", favourites: [], expirySec: 60, symbol: "EURUSD" });
  });

  it("returns an empty map for junk", () => {
    expect(parsePersisted(null)).toEqual({});
    expect(parsePersisted("x")).toEqual({});
    expect(parsePersisted([1, 2])).toEqual({});
    expect(parsePersisted({ u1: 5 })).toEqual({});
  });
});
