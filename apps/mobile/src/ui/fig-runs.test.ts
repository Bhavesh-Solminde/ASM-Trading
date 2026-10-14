import { describe, expect, it } from "vitest";
import { figLineHeight, splitFigRuns } from "./fig-runs";

describe("splitFigRuns", () => {
  it("puts the rupee sign in its own ui run", () => {
    expect(splitFigRuns("₹1,930")).toEqual([
      { text: "₹", ui: true },
      { text: "1,930", ui: false },
    ]);
  });

  it("splits Devanagari words, signs and symbols", () => {
    expect(splitFigRuns("आज +₹93")).toEqual([
      { text: "आज ", ui: true },
      { text: "+", ui: false },
      { text: "₹", ui: true },
      { text: "93", ui: false },
    ]);
  });

  it("keeps ASCII-only strings in one fig run", () => {
    expect(splitFigRuns("$12.00")).toEqual([{ text: "$12.00", ui: false }]);
    expect(splitFigRuns("12:30")).toEqual([{ text: "12:30", ui: false }]);
    expect(splitFigRuns("94,553.62")).toEqual([{ text: "94,553.62", ui: false }]);
  });

  it("treats the true minus and middle dot as ui glyphs and merges them with a neighbouring ui run", () => {
    expect(splitFigRuns("−₹93")).toEqual([
      { text: "−₹", ui: true },
      { text: "93", ui: false },
    ]);
    expect(splitFigRuns("12:30 · 5")).toEqual([
      { text: "12:30 ", ui: false },
      { text: "· ", ui: true },
      { text: "5", ui: false },
    ]);
  });

  it("joins whitespace to the run before it, and a leading space to the first run", () => {
    expect(splitFigRuns("win  ₹5")).toEqual([
      { text: "win  ", ui: false },
      { text: "₹", ui: true },
      { text: "5", ui: false },
    ]);
    expect(splitFigRuns(" ₹5")).toEqual([
      { text: " ₹", ui: true },
      { text: "5", ui: false },
    ]);
  });

  it("returns no runs for an empty string and one fig run for whitespace only", () => {
    expect(splitFigRuns("")).toEqual([]);
    expect(splitFigRuns("  ")).toEqual([{ text: "  ", ui: false }]);
  });

  it("never splits a surrogate pair", () => {
    expect(splitFigRuns("a😀b")).toEqual([
      { text: "a", ui: false },
      { text: "😀", ui: true },
      { text: "b", ui: false },
    ]);
  });

  it("reassembles to the input", () => {
    for (const s of ["₹ 2,500", "जीत ₹1,930", "−$4.50", "a b  c", " x "]) {
      expect(splitFigRuns(s).map((r) => r.text).join("")).toBe(s);
    }
  });
});

describe("figLineHeight", () => {
  it("uses 1.3x for Latin and symbol-only strings", () => {
    expect(figLineHeight(splitFigRuns("₹1,930"), 20)).toBe(26);
    expect(figLineHeight(splitFigRuns("12:30"), 10)).toBe(13);
  });

  it("uses 1.5x only when Devanagari is actually present, so matras are not clipped", () => {
    expect(figLineHeight(splitFigRuns("आज +₹93"), 12)).toBe(18);
    expect(figLineHeight(splitFigRuns("जीत ₹1,930"), 14)).toBe(21);
  });
});
