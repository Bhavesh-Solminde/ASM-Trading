import { describe, expect, it } from "vitest";
import type { ITimeScaleApi, Time } from "lightweight-charts";
import { channelOffset, drawingTimeline } from "./drawing-coordinates";

function scale(times: number[], origin: number, spacing: number) {
  return {
    logicalToCoordinate: (index: number) => Number.isInteger(index) ? origin + index * spacing : 0,
    coordinateToTime: (x: number) => times[Math.round((x - origin) / spacing)] ?? null,
    timeToIndex: (time: number) => {
      const index = times.findIndex(t => t >= time);
      return index === -1 ? times.length - 1 : index;
    },
  } as unknown as ITimeScaleApi<Time>;
}

describe("drawing coordinates", () => {
  it("round-trips fractional positions on bars, in data gaps, and beyond the history edges", () => {
    const timeline = drawingTimeline(scale([600, 660, 900], 3, 20), 60)!;
    for (const [x, timestamp] of [[-2, 585], [3, 600], [13, 630], [28, 720], [43, 900], [53, 930]] as const) {
      expect(timeline.timeAtX(x)).toBe(timestamp);
      expect(timeline.xAtTime(timestamp)).toBe(x);
    }
    const zoomed = drawingTimeline(scale([540, 600, 660, 900], -20, 40), 60)!;
    expect(zoomed.xAtTime(720)).toBe(70);
  });

  it("uses both dimensions of the width anchor and allows both sides of the channel", () => {
    const a = { x: 10, y: 20 }, b = { x: 50, y: 40 };
    expect(channelOffset(a, b, { x: 30, y: 15 })).toEqual({ x: 0, y: -15 });
    expect(channelOffset(a, b, { x: 40, y: 50 })).toEqual({ x: 0, y: 15 });
    expect(channelOffset(a, { x: 10, y: 40 }, { x: 2, y: 32 })).toEqual({ x: -8, y: 0 });
    expect(channelOffset(a, b, { x: a.x, y: 10 })).toEqual({ x: 0, y: -10 });
  });
});
