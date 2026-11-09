import { describe, expect, it } from "vitest";
import { CHART_OVERLAY_BOTTOM, OVERLAY_ROW_HEIGHT, OVERLAY_TOP } from "./chart-overlay";

describe("chart overlay metrics", () => {
  it("puts the pill row at top 10, 40 high, as the canvas does", () => {
    expect(OVERLAY_TOP).toBe(10);
    expect(OVERLAY_ROW_HEIGHT).toBe(40);
  });

  it("starts the chart readout 8 below the row, at 58", () => {
    expect(CHART_OVERLAY_BOTTOM).toBe(OVERLAY_TOP + OVERLAY_ROW_HEIGHT + 8);
    expect(CHART_OVERLAY_BOTTOM).toBe(58);
  });
});
