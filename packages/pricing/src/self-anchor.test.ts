import { describe, expect, it } from "vitest";
import { initPriceState, stepPrice, type PriceParams } from "./step";
import { createRng } from "./rng";

/**
 * Phase 2A tests for the L5 self-anchor layer inside `stepPrice`. Pure
 * pricing-side behaviour; the algo package supplies the concrete alpha
 * constants at runtime (`SELF_ANCHOR_ALPHA`, `SELF_ANCHOR_ALPHA_CLOSED`) and
 * this file mirrors their exact numbers to prove they compose sanely with
 * GARCH + drift.
 */

const SELF_ANCHOR_ALPHA = 0.05;
const SELF_ANCHOR_ALPHA_CLOSED = 0.20;

const params: PriceParams = {
  garch: { omega: 0.000001, alpha: 0.08, beta: 0.9 },
  driftPerSec: 0,
  anchorAlpha: 0,
  maxTickMove: 0.01,
};

function runShown(
  ticks: number,
  seed: number,
  opts: {
    driftBias?: number;
    selfAnchorTarget?: number | null;
    selfAnchorAlpha?: number;
    startPrice?: number;
  } = {},
): number {
  const rng = createRng(seed);
  let state = initPriceState(opts.startPrice ?? 1.20, params);
  for (let i = 0; i < ticks; i++) {
    state = stepPrice({
      state,
      params,
      dtSec: 0.1,
      z: rng.normal(),
      driftBias: opts.driftBias ?? 0,
      magnet: 0,
      anchorTarget: null,
      selfAnchorTarget: opts.selfAnchorTarget ?? null,
      selfAnchorAlpha: opts.selfAnchorAlpha ?? 0,
    }).state;
  }
  return state.price;
}

describe("Phase 2A — OTC self-anchor (idle)", () => {
  it("empty book: shown converges toward honest at SELF_ANCHOR_ALPHA", () => {
    // Shown starts drifted 20% above honest, no book pressure. Over enough
    // ticks the self-anchor pull should close most of the gap.
    const honest = 1.00;
    const gap0 = 0.20;
    const shown0 = honest * (1 + gap0);
    const withAnchor = runShown(200, 7, {
      startPrice: shown0,
      selfAnchorTarget: honest,
      selfAnchorAlpha: SELF_ANCHOR_ALPHA,
    });
    const withoutAnchor = runShown(200, 7, {
      startPrice: shown0,
      selfAnchorTarget: honest,
      selfAnchorAlpha: 0,
    });
    // The self-anchor path ends much closer to honest than the free-drift
    // path from the same seed.
    expect(Math.abs(withAnchor - honest)).toBeLessThan(
      Math.abs(withoutAnchor - honest),
    );
    // And the residual gap is small in absolute terms — within a few percent.
    expect(Math.abs(withAnchor - honest) / honest).toBeLessThan(0.05);
  });

  it("closed-market alpha closes a large gap much faster than daytime alpha", () => {
    const honest = 1.00;
    const shown0 = 1.20;
    const daytime = runShown(20, 11, {
      startPrice: shown0,
      selfAnchorTarget: honest,
      selfAnchorAlpha: SELF_ANCHOR_ALPHA,
    });
    const closed = runShown(20, 11, {
      startPrice: shown0,
      selfAnchorTarget: honest,
      selfAnchorAlpha: SELF_ANCHOR_ALPHA_CLOSED,
    });
    // Closed alpha (0.20) is 4× daytime (0.05) — closed path must sit
    // strictly closer to honest.
    expect(Math.abs(closed - honest)).toBeLessThan(
      Math.abs(daytime - honest),
    );
  });
});

describe("Phase 2A — OTC self-anchor (with book pressure)", () => {
  it("large driftBias dominates: shown still drifts against big-money side even with self-anchor active", () => {
    // Big-money side pushes shown UP via positive driftBias. Honest sits
    // below shown. Self-anchor pulls shown DOWN toward honest. The driftBias
    // signal (about 0.002 per tick) should overpower the self-anchor pull
    // for a moderate seed, so shown ends *above* honest even with the
    // anchor active.
    const honest = 1.00;
    const shown0 = 1.00;
    const withAnchor = runShown(50, 13, {
      startPrice: shown0,
      driftBias: 0.002,
      selfAnchorTarget: honest,
      selfAnchorAlpha: SELF_ANCHOR_ALPHA,
    });
    // Shown should have moved upward from 1.00 despite the downward pull.
    expect(withAnchor).toBeGreaterThan(honest);
  });

  it("self-anchor is proportionally weaker with book pressure than without", () => {
    // Same driftBias, one run with anchor, one without. Anchor run must end
    // closer to honest (smaller upward excursion) than no-anchor run.
    const honest = 1.00;
    const shown0 = 1.00;
    const withAnchor = runShown(50, 21, {
      startPrice: shown0,
      driftBias: 0.002,
      selfAnchorTarget: honest,
      selfAnchorAlpha: SELF_ANCHOR_ALPHA,
    });
    const withoutAnchor = runShown(50, 21, {
      startPrice: shown0,
      driftBias: 0.002,
      selfAnchorTarget: honest,
      selfAnchorAlpha: 0,
    });
    expect(Math.abs(withAnchor - honest)).toBeLessThan(
      Math.abs(withoutAnchor - honest),
    );
  });
});
