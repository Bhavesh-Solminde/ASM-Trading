import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOVERNOR_CONFIG,
  decideVerdict,
  ladder,
  type GovernorInput,
} from "./governor";

// Pinned RNGs: alwaysLow makes rng() < pWin whenever pWin > 0 (verdict WIN),
// alwaysHigh makes rng() >= pWin whenever pWin < 1 (verdict LOSS).
const alwaysLow = () => 0.0;
const alwaysHigh = () => 0.999999;

function baseInput(overrides: Partial<GovernorInput> = {}): GovernorInput {
  return {
    isDemo: false,
    dailyTargetMinor: 1_000_000,
    realizedTodayMinor: 0,
    userLossStreak: 0,
    userIsHighValue: false,
    tradeStakeMinor: 10_000,
    tradePayoutPct: 85,
    ...overrides,
  };
}

describe("ladder", () => {
  it("clamps below the first x", () => {
    expect(ladder(-1)).toBe(DEFAULT_GOVERNOR_CONFIG.ladder[0]![1]);
  });

  it("clamps above the last x", () => {
    const last = DEFAULT_GOVERNOR_CONFIG.ladder.at(-1)!;
    expect(ladder(9999)).toBe(last[1]);
  });

  it("interpolates linearly between anchor points", () => {
    // Between (0.5, 0.15) and (1.0, 0.4): at x=0.75, y = 0.15 + 0.5*0.25 = 0.275
    expect(ladder(0.75)).toBeCloseTo(0.275, 6);
  });

  it("hits anchor points exactly", () => {
    expect(ladder(0.1)).toBeCloseTo(0.05, 6);
    expect(ladder(0.5)).toBeCloseTo(0.15, 6);
    expect(ladder(1.0)).toBeCloseTo(0.4, 6);
  });

  it("returns 0 for an empty points array", () => {
    expect(ladder(0.5, [])).toBe(0);
  });
});

describe("decideVerdict — demo short-circuit", () => {
  it("returns HONEST for demo regardless of ledger state or RNG", () => {
    const out = decideVerdict(
      baseInput({ isDemo: true, realizedTodayMinor: 999_999_999 }),
      alwaysLow,
    );
    expect(out).toBe("HONEST");
  });
});

describe("decideVerdict — RNG monotonicity", () => {
  it("returns LOSS when RNG rolls high and pWin is low", () => {
    const out = decideVerdict(
      baseInput({ realizedTodayMinor: 0 }),
      alwaysHigh,
    );
    expect(out).toBe("LOSS");
  });

  it("returns WIN when RNG rolls low and pWin is high", () => {
    const out = decideVerdict(
      baseInput({
        realizedTodayMinor: 1_500_000,
        dailyTargetMinor: 1_000_000,
      }),
      alwaysLow,
    );
    expect(out).toBe("WIN");
  });
});

describe("decideVerdict — mercy floor", () => {
  it("streak 4 forces the pWin floor to 0.55", () => {
    // Base pWin at progress 0 is 0.05; mercy lifts to 0.55.
    const out = decideVerdict(
      baseInput({ userLossStreak: 4 }),
      () => 0.5,
    );
    expect(out).toBe("WIN");
  });

  it("streak 6 forces the pWin floor to 0.80", () => {
    const out = decideVerdict(
      baseInput({ userLossStreak: 6 }),
      () => 0.79,
    );
    expect(out).toBe("WIN");
  });

  it("streak 6 uses the higher 0.80 floor, not the 0.55 floor", () => {
    // rng=0.6 fails 0.55 but passes 0.80.
    const out = decideVerdict(
      baseInput({ userLossStreak: 6 }),
      () => 0.6,
    );
    expect(out).toBe("WIN");
  });

  it("streak below the first threshold: no mercy applied", () => {
    // Streak 3 < 4 → base pWin (0.05). rng=0.1 → LOSS.
    const out = decideVerdict(
      baseInput({ userLossStreak: 3 }),
      () => 0.1,
    );
    expect(out).toBe("LOSS");
  });
});

describe("decideVerdict — giveback clamp", () => {
  it("caps pWin at the giveback clamp when a WIN would break the target floor", () => {
    // progress 1.01 (over), but a WIN would push realized below target.
    // Clamp = 0.25. rng = 0.3 → LOSS despite being past target.
    const out = decideVerdict(
      baseInput({
        realizedTodayMinor: 1_010_000,
        dailyTargetMinor: 1_000_000,
        tradeStakeMinor: 20_000,
        tradePayoutPct: 100,
      }),
      () => 0.3,
    );
    expect(out).toBe("LOSS");
  });

  it("does not clamp when a WIN would still leave realized above target", () => {
    // progress 1.1; win cost small enough that realized stays above target.
    // ladder(1.1) ≈ 0.44. rng = 0.2 → WIN.
    const out = decideVerdict(
      baseInput({
        realizedTodayMinor: 1_100_000,
        dailyTargetMinor: 1_000_000,
      }),
      () => 0.2,
    );
    expect(out).toBe("WIN");
  });
});

describe("decideVerdict — degenerate configs", () => {
  it("target=0 is treated as fully covered (progress=1)", () => {
    // ladder(1) = 0.4. rng = 0.3 → WIN.
    const out = decideVerdict(
      baseInput({ dailyTargetMinor: 0, realizedTodayMinor: 0 }),
      () => 0.3,
    );
    expect(out).toBe("WIN");
  });
});

describe("decideVerdict — empirical rate matches ladder", () => {
  it("progress=0.5 gives about 0.15 win rate over many samples", () => {
    // mulberry32-style deterministic RNG.
    let state = 0xdeadbeef;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let wins = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const v = decideVerdict(
        baseInput({
          realizedTodayMinor: 500_000,
          dailyTargetMinor: 1_000_000,
        }),
        rng,
      );
      if (v === "WIN") wins++;
    }
    const empirical = wins / N;
    expect(empirical).toBeGreaterThan(0.12);
    expect(empirical).toBeLessThan(0.18);
  });
});
