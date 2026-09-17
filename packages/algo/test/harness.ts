import {
  desiredWinProb,
  drawOutcome,
  tradeWeight,
  WINDOW_SIZE,
  type AccountStats,
  type LifecycleStage,
  type WindowEntry,
} from "../src/index";

export function seededRng(seed: number): { next(): number } {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export interface SimulateOpts {
  stage: LifecycleStage;
  trades: number;
  seed: number;
  stake?: number;
  stakes?: number[];
  forceWin?: boolean;
  tieEvery?: number;
  initial?: AccountStats;
}

export interface SimulateResult {
  outcomes: ("WON" | "LOST" | "REFUNDED")[];
  realisedRate: number;
  longestWinRun: number;
  longestLossRun: number;
  posteriors: number[];
  ceilingActiveTrajectory: boolean[];
  finalStats: AccountStats;
}

export function simulate(opts: SimulateOpts): SimulateResult {
  const rng = seededRng(opts.seed);

  let window: WindowEntry[] = opts.initial ? [...opts.initial.shortWindow] : [];
  let lifetimeWonWeight = opts.initial?.lifetimeWonWeight ?? 0;
  let lifetimeTotalWeight = opts.initial?.lifetimeTotalWeight ?? 0;
  let lossStreak = opts.initial?.lossStreak ?? 0;
  let winStreak = opts.initial?.winStreak ?? 0;
  const medianStake =
    opts.initial?.medianStake ??
    (opts.stakes
      ? [...opts.stakes].sort((a, b) => a - b)[Math.floor(opts.stakes.length / 2)]!
      : (opts.stake ?? 10_000));

  const outcomes: SimulateResult["outcomes"] = [];
  const posteriors: number[] = [];
  const ceilingActiveTrajectory: boolean[] = [];

  let longestWinRun = 0;
  let longestLossRun = 0;

  for (let i = 0; i < opts.trades; i++) {
    const stats: AccountStats = {
      stage: opts.stage,
      shortWindow: window,
      lifetimeWonWeight,
      lifetimeTotalWeight,
      lossStreak,
      winStreak,
      medianStake,
    };

    const out = desiredWinProb(stats);
    posteriors.push(out.posteriorShort);
    ceilingActiveTrajectory.push(out.ceilingActive);

    const stake = opts.stakes
      ? opts.stakes[i % opts.stakes.length]!
      : (opts.stake ?? 10_000);

    const isTie = opts.tieEvery !== undefined && (i + 1) % opts.tieEvery === 0;

    if (isTie) {
      outcomes.push("REFUNDED");
      continue;
    }

    const won = opts.forceWin ?? drawOutcome(out.p, rng);
    outcomes.push(won ? "WON" : "LOST");

    const weight = tradeWeight(stake, medianStake);
    window = [...window, { weight, won }].slice(-WINDOW_SIZE);
    lifetimeTotalWeight += weight;
    if (won) lifetimeWonWeight += weight;

    if (won) {
      winStreak += 1;
      lossStreak = 0;
      longestWinRun = Math.max(longestWinRun, winStreak);
    } else {
      lossStreak += 1;
      winStreak = 0;
      longestLossRun = Math.max(longestLossRun, lossStreak);
    }
  }

  const settled = outcomes.filter((o) => o !== "REFUNDED");
  const wins = settled.filter((o) => o === "WON").length;

  return {
    outcomes,
    realisedRate: settled.length === 0 ? 0 : wins / settled.length,
    longestWinRun,
    longestLossRun,
    posteriors,
    ceilingActiveTrajectory,
    finalStats: {
      stage: opts.stage,
      shortWindow: window,
      lifetimeWonWeight,
      lifetimeTotalWeight,
      lossStreak,
      winStreak,
      medianStake,
    },
  };
}
