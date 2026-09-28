import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLG_CONFIG,
  decideVerdictGLG,
  ladder,
  perAssetPwinCeiling,
  treasuryHealth,
  type GlgInput,
} from "./glg";

const alwaysLow = () => 0.0;
const alwaysHigh = () => 0.999999;

function baseInput(overrides: Partial<GlgInput> = {}): GlgInput {
  return {
    isDemo: false,
    treasuryMinor: 0,
    treasuryTargetMinor: 1_000_000,
    tradeStakeMinor: 10_000,
    tradePayoutPct: 85,
    ...overrides,
  };
}

describe("treasuryHealth", () => {
  it("returns 0 at empty treasury", () => {
    expect(treasuryHealth(0, 1_000_000)).toBe(0);
  });

  it("returns 1 at target", () => {
    expect(treasuryHealth(1_000_000, 1_000_000)).toBe(1);
  });

  it("clamps at 3", () => {
    expect(treasuryHealth(10_000_000, 1_000_000)).toBe(3);
  });

  it("clamps at 0 for negative treasury", () => {
    expect(treasuryHealth(-500_000, 1_000_000)).toBe(0);
  });

  it("returns 3 for a zero or negative target (degenerate)", () => {
    expect(treasuryHealth(0, 0)).toBe(3);
    expect(treasuryHealth(1_000_000, -1)).toBe(3);
  });
});

describe("ladder", () => {
  it("interpolates linearly", () => {
    // Between (0.5, 0.35) and (1.0, 0.45): at x=0.75, y = 0.35 + 0.5*0.10 = 0.40
    expect(ladder(0.75, DEFAULT_GLG_CONFIG.basePwinLadder)).toBeCloseTo(0.4, 6);
  });

  it("hits anchors", () => {
    expect(ladder(0.0, DEFAULT_GLG_CONFIG.basePwinLadder)).toBe(0.2);
    expect(ladder(1.0, DEFAULT_GLG_CONFIG.basePwinLadder)).toBe(0.45);
    expect(ladder(3.0, DEFAULT_GLG_CONFIG.basePwinLadder)).toBe(0.5);
  });

  it("clamps outside range", () => {
    expect(ladder(-1, DEFAULT_GLG_CONFIG.basePwinLadder)).toBe(0.2);
    expect(ladder(99, DEFAULT_GLG_CONFIG.basePwinLadder)).toBe(0.5);
  });
});

describe("perAssetPwinCeiling", () => {
  it("returns break-even minus safety margin", () => {
    // 85% payout: break-even = 100/185 = 0.5405; minus 0.05 margin = 0.4905
    expect(perAssetPwinCeiling(85)).toBeCloseTo(0.4905, 3);
  });

  it("tightens as payout rises", () => {
    // Higher payout → tighter break-even → tighter cap
    expect(perAssetPwinCeiling(100)).toBeLessThan(perAssetPwinCeiling(50));
  });

  it("falls back to global ceiling for zero payout", () => {
    expect(perAssetPwinCeiling(0)).toBe(DEFAULT_GLG_CONFIG.pwinCeiling);
  });
});

describe("decideVerdictGLG — demo short-circuit", () => {
  it("returns HONEST for demo regardless of state", () => {
    const out = decideVerdictGLG(
      baseInput({ isDemo: true, treasuryMinor: 5_000_000 }),
      alwaysLow,
    );
    expect(out).toBe("HONEST");
  });
});

describe("decideVerdictGLG — treasury drives pWin", () => {
  it("returns LOSS at empty treasury when RNG is high", () => {
    // health=0 → pWin=0.20; alwaysHigh → LOSS
    expect(decideVerdictGLG(baseInput(), alwaysHigh)).toBe("LOSS");
  });

  it("returns WIN at empty treasury when RNG is under 0.20", () => {
    expect(decideVerdictGLG(baseInput(), () => 0.1)).toBe("WIN");
    expect(decideVerdictGLG(baseInput(), () => 0.19)).toBe("WIN");
  });

  it("returns LOSS at empty treasury when RNG is over 0.20", () => {
    expect(decideVerdictGLG(baseInput(), () => 0.21)).toBe("LOSS");
  });

  it("returns WIN at max treasury health when RNG is under ceiling", () => {
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 5_000_000 }),
      () => 0.48,
    );
    expect(out).toBe("WIN");
  });
});

describe("decideVerdictGLG — invariant I1 (per-asset edge)", () => {
  it("never returns WIN when RNG >= per-asset ceiling for 85% payout", () => {
    // break-even 0.5405, margin 0.05 → ceiling ~0.4905. RNG 0.4906 → LOSS.
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 5_000_000 }),
      () => 0.4906,
    );
    expect(out).toBe("LOSS");
  });

  it("never returns WIN when RNG >= per-asset ceiling for 90% payout", () => {
    // break-even 100/190 = 0.5263; margin 0.05 → ceiling ~0.4763.
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 5_000_000, tradePayoutPct: 90 }),
      () => 0.48,
    );
    expect(out).toBe("LOSS");
  });
});

describe("decideVerdictGLG — invariant I2 (global ceiling)", () => {
  it("no config path produces pWin > pwinCeiling", () => {
    // At any RNG >= 0.5 the verdict is LOSS at max treasury (ceiling = 0.5).
    // A low-payout asset would allow per-asset ceiling above 0.5 (e.g. payout
    // 10 → break-even 0.909 → per-asset cap 0.859), but the GLOBAL cap
    // clamps it back.
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 5_000_000, tradePayoutPct: 10 }),
      () => 0.5,
    );
    expect(out).toBe("LOSS");
  });
});

describe("decideVerdictGLG — invariant I3 (giveback protection)", () => {
  it("clamps pWin when a WIN would drop treasury below the cushion", () => {
    // treasury just above the cushion floor; a payout would drop it below.
    // cushion = 0.9 × 1_000_000 = 900_000. A win pays 8_500 (10_000 × 85%).
    // So treasury just at 908_400 (which is above cushion by 8_400 < payout).
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 908_400 }),
      () => 0.16, // above clamp (0.15) → LOSS
    );
    expect(out).toBe("LOSS");
  });

  it("does not clamp when treasury has room to give back", () => {
    // treasury well above cushion + payout → normal ladder pWin applies.
    // health = 2_000_000 / 1_000_000 = 2.0 → ladder = 0.48.
    // Global ceiling clamps to 0.50, per-asset (85%) to ~0.4905. Actual pWin = min(0.48, 0.5, 0.4905) = 0.48
    const out = decideVerdictGLG(
      baseInput({ treasuryMinor: 2_000_000 }),
      () => 0.47,
    );
    expect(out).toBe("WIN");
  });
});

describe("decideVerdictGLG — house-edge property test", () => {
  it("E[house PnL] > 0 across every ladder anchor and payout in {50, 85, 95}", () => {
    // Property: E[house per unit stake] = 1 - pWin * payoutPct/100. Must be > 0.
    // Simulate many trials at each anchor; empirical win rate must produce
    // positive house EV.
    let state = 0x12345678;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (const health of [0.0, 0.5, 1.0, 2.0, 3.0]) {
      const treasuryMinor = health * 1_000_000;
      for (const payoutPct of [50, 85, 95]) {
        let wins = 0;
        const N = 5000;
        for (let i = 0; i < N; i++) {
          const v = decideVerdictGLG(
            baseInput({ treasuryMinor, tradePayoutPct: payoutPct }),
            rng,
          );
          if (v === "WIN") wins++;
        }
        const empiricalPwin = wins / N;
        const houseEvPerUnit = 1 - (empiricalPwin * payoutPct) / 100;
        // Must be strictly positive (house edge) at every state. Allow small
        // sampling noise; expect edge > 1% at all anchors.
        expect(houseEvPerUnit).toBeGreaterThan(0.01);
      }
    }
  });
});

describe("decideVerdictGLG — fresh-day-start comparison to v1", () => {
  it("gives ~20% pWin at treasury=0 (vs v1's 5%)", () => {
    let state = 0xcafebabe;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let wins = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const v = decideVerdictGLG(baseInput({ treasuryMinor: 0 }), rng);
      if (v === "WIN") wins++;
    }
    const empirical = wins / N;
    // Expect ~0.20, tolerate 0.18 – 0.22
    expect(empirical).toBeGreaterThan(0.18);
    expect(empirical).toBeLessThan(0.22);
  });
});
