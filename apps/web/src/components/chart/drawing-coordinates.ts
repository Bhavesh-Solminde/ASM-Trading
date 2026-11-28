import type { ITimeScaleApi, Logical, Time, UTCTimestamp } from "lightweight-charts";

export type XY = { x: number; y: number };

/** lightweight-charts 5.2.1 rounds x to a bar index and only projects integer indexes. */
export function drawingTimeline(scale: ITimeScaleApi<Time>, timeframeSeconds: number) {
  const origin = scale.logicalToCoordinate(0 as Logical);
  const next = scale.logicalToCoordinate(1 as Logical);
  const last = scale.timeToIndex(Number.MAX_SAFE_INTEGER as UTCTimestamp, true);
  if (origin === null || next === null || next === origin || last === null) return null;
  const spacing = next - origin;
  const times = new Map<number, number>();
  function timeAt(index: number): number {
    const edge = Math.min(last!, Math.max(0, index));
    let time = times.get(edge);
    if (time === undefined) {
      const center = scale.logicalToCoordinate(edge as Logical);
      const value = center === null ? null : scale.coordinateToTime(center);
      time = typeof value === "number" ? value : NaN;
      times.set(edge, time);
    }
    return time + (index - edge) * timeframeSeconds;
  }
  return {
    timeAtX(x: number) {
      const index = (x - origin) / spacing;
      const left = Math.floor(index);
      const start = timeAt(left);
      return start + (index - left) * (timeAt(left + 1) - start);
    },
    xAtTime(time: number) {
      const index = scale.timeToIndex(time as UTCTimestamp, true);
      if (index === null) return NaN;
      const nearest = timeAt(index);
      if (nearest === time) return origin + index * spacing;
      const edge = time < nearest ? index - 1 : index;
      const start = timeAt(edge);
      return origin + (edge + (time - start) / (timeAt(edge + 1) - start)) * spacing;
    },
  };
}

export function channelOffset(a: XY, b: XY, width?: XY): XY {
  if (!width) return { x: 0, y: -35 }; // Preserve legacy channels saved without a width anchor.
  if (a.x === b.x) return { x: width.x - a.x, y: 0 };
  const baseY = a.y + (b.y - a.y) * ((width.x - a.x) / (b.x - a.x));
  return { x: 0, y: width.y - baseY };
}
