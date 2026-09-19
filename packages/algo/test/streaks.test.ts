import { describe, expect, it } from "vitest";
import { MAX_LOSS_STREAK, MAX_WIN_STREAK } from "../src/index";
import { simulate } from "./harness";

describe("streak bounds", () => {
  it("keeps loss runs within a small margin of the configured maximum", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 100_000, seed: 555 });
    expect(r.longestLossRun).toBeLessThanOrEqual(MAX_LOSS_STREAK + 3);
  });

  it("keeps win runs within a small margin of the configured maximum", () => {
    const r = simulate({ stage: "PRE_DEPOSIT", trades: 100_000, seed: 666 });
    expect(r.longestWinRun).toBeLessThanOrEqual(MAX_WIN_STREAK + 3);
  });

  it("bounds streaks at the punitive target too", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 50_000, seed: 777 });
    expect(r.longestLossRun).toBeLessThanOrEqual(MAX_LOSS_STREAK + 3);
  });

  it("does not produce a perfectly alternating sequence", () => {
    const r = simulate({ stage: "DEPOSITED", trades: 2_000, seed: 888 });
    const settled = r.outcomes.filter((o) => o !== "REFUNDED");
    let alternations = 0;
    for (let i = 1; i < settled.length; i++) {
      if (settled[i] !== settled[i - 1]) alternations++;
    }
    const ratio = alternations / (settled.length - 1);
    expect(ratio).toBeLessThan(0.9);
  });
});
