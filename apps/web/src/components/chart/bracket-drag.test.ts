import { describe, expect, it } from "vitest";
import { draggedBracketPrice, expandedBracketRange } from "./bracket-drag";
describe("continuous price dragging", () => {
  it("moves by the original price per pixel regardless of subsequent zoom", () => {
    expect(draggedBracketPrice(743.79,-1,.01,.01,2)).toBe(743.8);
    expect(draggedBracketPrice(743.79,-2,.01,.01,2)).toBe(743.81);
  });
  it("never turns a small price move into a large one at the top or bottom", () => {
    for (const anchor of [738.15,743.79,900]) {
      let range = {from:737,to:744};
      for(let pixels=0;pixels>-500;pixels--) {
        const price = draggedBracketPrice(anchor,pixels,.01,.01,2);
        const next = draggedBracketPrice(anchor,pixels-1,.01,.01,2);
        expect(next-price).toBeCloseTo(.01,8);
        range = expandedBracketRange(range,price,.01);
        expect(range.to).toBeGreaterThan(price);
        expect(range.from).toBeLessThan(price);
      }
    }
  });
  it("preserves the current range unless an exit needs room", () => {
    expect(expandedBracketRange({from:730,to:750},740,.01)).toEqual({from:730,to:750});
    expect(expandedBracketRange({from:730,to:750},760,.01).to).toBeGreaterThan(760);
    expect(expandedBracketRange({from:730,to:750},720,.01).from).toBeLessThan(720);
  });
  it("snaps to the asset tick and cannot create zero or a negative price", () => {
    expect(draggedBracketPrice(1,100,.1,.05,2)).toBe(.05);
    expect(draggedBracketPrice(743.79,-1,.013,.05,2)).toBe(743.8);
  });
});
