import { describe, expect, it } from "vitest";
import { stepEase } from "./ease";

describe("stepEase", () => {
  it("moves a fraction of the remaining distance toward the target", () => {
    expect(stepEase(0, 10, 0.5)).toBe(5);
    expect(stepEase(5, 10, 0.5)).toBe(7.5);
  });

  it("snaps fully when k = 1", () => {
    expect(stepEase(0, 10, 1)).toBe(10);
  });

  it("snaps to target when already within epsilon", () => {
    expect(stepEase(9.999, 10, 0.2, 0.01)).toBe(10);
  });

  it("snaps to target when the next step lands within epsilon", () => {
    // distance 0.04, k 0.9 -> next within 0.004 of target, under epsilon 0.01.
    expect(stepEase(9.96, 10, 0.9, 0.01)).toBe(10);
  });

  it("keeps stepping while outside epsilon", () => {
    const next = stepEase(0, 100, 0.1, 0.5);
    expect(next).toBe(10);
    expect(next).not.toBe(100);
  });
});
