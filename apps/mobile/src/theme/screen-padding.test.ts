import { describe, expect, it } from "vitest";
import { screenTopPadding } from "./screen-padding";

describe("screenTopPadding", () => {
  it("adds nothing while the offline strip is hidden", () => {
    expect(screenTopPadding({ padding: 16 }, false, 28)).toBe(16);
    expect(screenTopPadding(undefined, false, 28)).toBe(0);
  });

  it("pushes content below the strip while it shows, on top of the screen's own top padding", () => {
    expect(screenTopPadding(undefined, true, 28)).toBe(28);
    expect(screenTopPadding({ padding: 16 }, true, 28)).toBe(44);
    expect(screenTopPadding({ padding: 16, paddingTop: 4 }, true, 28)).toBe(32);
  });

  it("falls back from paddingTop to paddingVertical to padding", () => {
    expect(screenTopPadding({ paddingVertical: 12 }, true, 28)).toBe(40);
    expect(screenTopPadding({ paddingVertical: 12, padding: 16 }, false, 28)).toBe(12);
    expect(screenTopPadding({ paddingTop: 4, paddingVertical: 12 }, false, 28)).toBe(4);
  });

  it("ignores a non-numeric (percentage) padding rather than producing NaN", () => {
    expect(screenTopPadding({ paddingTop: "10%" }, true, 28)).toBe(28);
  });
});
