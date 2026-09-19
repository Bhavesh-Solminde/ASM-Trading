import { describe, expect, it } from "vitest";
import { simulate } from "./harness";

function runsZScore(sequence: boolean[]): number {
  const n1 = sequence.filter((v) => v).length;
  const n2 = sequence.length - n1;
  if (n1 === 0 || n2 === 0) return 0;

  let runs = 1;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] !== sequence[i - 1]) runs++;
  }

  const n = n1 + n2;
  const expected = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));

  return (runs - expected) / Math.sqrt(variance);
}

describe("sequence randomness", () => {
  for (const stage of ["PRE_DEPOSIT", "DEPOSITED", "HIGH_VALUE"] as const) {
    it(`produces a ${stage} sequence indistinguishable from a biased coin`, () => {
      const r = simulate({ stage, trades: 20_000, seed: 1234 });
      const sequence = r.outcomes
        .filter((o) => o !== "REFUNDED")
        .map((o) => o === "WON");

      const z = Math.abs(runsZScore(sequence));
      expect(z).toBeLessThan(4);
    });
  }

  it("is far from the z-score a deterministic controller would produce", () => {
    const deterministic = Array.from({ length: 20_000 }, (_, i) => i % 2 === 0);
    expect(Math.abs(runsZScore(deterministic))).toBeGreaterThan(50);
  });
});
