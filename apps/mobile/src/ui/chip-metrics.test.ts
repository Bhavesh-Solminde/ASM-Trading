import { describe, expect, it } from "vitest";
import { chipA11yState, chipHitSlop, MIN_TOUCH } from "./chip-metrics";

describe("chipHitSlop", () => {
  it("pads a 40pt pill by 2pt a side so the target is 44pt", () => {
    expect(chipHitSlop(40)).toBe(2);
  });

  it("rounds up when the gap is odd", () => {
    expect(chipHitSlop(41)).toBe(2);
    expect(chipHitSlop(33)).toBe(6);
  });

  it("adds nothing at or above 44pt", () => {
    expect(chipHitSlop(44)).toBe(0);
    expect(chipHitSlop(56)).toBe(0);
  });

  it("always reaches the minimum touch target", () => {
    for (const h of [24, 30, 32, 36, 38, 40, 43, 44, 48]) {
      expect(h + 2 * chipHitSlop(h)).toBeGreaterThanOrEqual(MIN_TOUCH);
    }
  });
});

describe("chipA11yState", () => {
  it("reports a button or tab as selected only", () => {
    expect(chipA11yState("button", true, false)).toEqual({ selected: true, disabled: false });
    expect(chipA11yState("tab", false, true)).toEqual({ selected: false, disabled: true });
  });

  it("reports a radio as checked as well, so TalkBack says checked", () => {
    expect(chipA11yState("radio", true, false)).toEqual({ selected: true, checked: true, disabled: false });
    expect(chipA11yState("radio", false, false)).toEqual({ selected: false, checked: false, disabled: false });
  });
});
