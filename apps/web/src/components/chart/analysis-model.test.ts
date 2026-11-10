import { describe, expect, it } from "vitest";
import { IndicatorAccumulator, readDrawings } from "./analysis-model";
describe("chart analysis", () => {
  it("revises a forming SMA without counting the bar twice", () => {
    const a = new IndicatorAccumulator("SMA", 3);
    expect(a.update(1, 10)).toBeNull(); a.update(2, 20);
    expect(a.update(3, 30)).toBe(20); expect(a.update(3, 60)).toBe(30);
    expect(a.update(4, 40)).toBe(40);
  });
  it("handles increasing, decreasing, and flat RSI", () => {
    for (const [delta, result] of [[1,100],[-1,0],[0,50]]) {
      const a = new IndicatorAccumulator("RSI", 3); let value: number | null = null;
      for (let i=1; i<=8; i++) value=a.update(i,100+i*delta!);
      expect(value).toBe(result);
    }
  });
  it("validates persisted drawings before rendering", () => {
    expect(readDrawings('{oops')).toEqual([]);
    expect(readDrawings(JSON.stringify([{id:'x',tool:'text',points:[{time:1,price:2}],text:'Gold'}]))).toHaveLength(1);
    expect(readDrawings(JSON.stringify([{id:'x',tool:'trend',points:[{time:1,price:-2}]}]))).toEqual([]);
  });
});
