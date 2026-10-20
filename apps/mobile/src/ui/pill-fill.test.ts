import { describe, expect, it } from "vitest";
import { pillRadius } from "./pill-fill";

describe("pillRadius", () => {
  it("caps a pill radius at half the height so the ends are round", () => {
    expect(pillRadius(30, 999)).toBe(15);
  });

  it("keeps a smaller radius as is", () => {
    expect(pillRadius(30, 8)).toBe(8);
  });

  it("never goes negative", () => {
    expect(pillRadius(0, 12)).toBe(0);
    expect(pillRadius(-4, 12)).toBe(0);
  });
});
