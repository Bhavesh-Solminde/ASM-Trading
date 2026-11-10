import type { CandleDto } from "@asm/contracts";
export const DRAWING_TOOLS = ["select", "horizontal", "trend", "channel", "fib", "brush", "text", "measure"] as const;
export type DrawingTool = typeof DRAWING_TOOLS[number];
export interface Anchor { time: number; price: number; }
export interface Drawing { id: string; tool: Exclude<DrawingTool, "select">; points: Anchor[]; text?: string; }
export function readDrawings(raw: string | null): Drawing[] {
  try {
    const rows: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(rows) || rows.length > 64) return [];
    return rows.filter((d): d is Drawing => !!d && typeof d === "object" && typeof d.id === "string" && d.id.length < 100 && DRAWING_TOOLS.includes(d.tool) && d.tool !== "select" && Array.isArray(d.points) && d.points.length > 0 && d.points.length <= 256 && d.points.every((p: Anchor) => Number.isFinite(p.time) && p.time > 0 && Number.isFinite(p.price) && p.price > 0) && (d.text === undefined || typeof d.text === "string" && d.text.length <= 120));
  } catch { return []; }
}
export type Indicator = "SMA" | "EMA" | "RSI";
export const INDICATORS: readonly Indicator[] = ["SMA", "EMA", "RSI"];
type State = { count: number; close: number | null; ema: number; gain: number; loss: number; window: number[] };
const initial = (): State => ({ count: 0, close: null, ema: 0, gain: 0, loss: 0, window: [] });
/** Saves the state before the forming bar, so revising that bar never compounds it. */
export class IndicatorAccumulator {
  private state = initial();
  private before = initial();
  lastTime = 0;
  constructor(readonly kind: Indicator, readonly period = 14) {}
  update(time: number, close: number): number | null {
    if (time < this.lastTime) return null;
    const s = time === this.lastTime ? this.before : this.state;
    this.before = s; this.lastTime = time;
    const count = s.count + 1;
    const window = [...s.window, close].slice(-this.period);
    const ema = s.count === 0 ? close : close * (2 / (this.period + 1)) + s.ema * (1 - 2 / (this.period + 1));
    const delta = s.close === null ? 0 : close - s.close;
    const gain = s.count <= this.period ? s.gain + Math.max(0, delta) / this.period : (s.gain * (this.period - 1) + Math.max(0, delta)) / this.period;
    const loss = s.count <= this.period ? s.loss + Math.max(0, -delta) / this.period : (s.loss * (this.period - 1) + Math.max(0, -delta)) / this.period;
    this.state = { count, close, ema, gain, loss, window };
    if (this.kind === "RSI") return count <= this.period ? null : loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
    if (count < this.period) return null;
    return this.kind === "EMA" ? ema : window.reduce((a, b) => a + b, 0) / this.period;
  }
}
export function indicatorValues(candles: readonly CandleDto[], kind: Indicator) {
  const accumulator = new IndicatorAccumulator(kind);
  return candles.flatMap(c => { const value = accumulator.update(c.openTs, c.c); return value === null ? [] : [{ time: c.openTs, value }]; });
}
