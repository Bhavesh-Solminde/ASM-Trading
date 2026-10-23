const VOL_GATE_THRESHOLD = 0.5;
const PROFIT_DRAG_THRESHOLD = 0.003;
const PROFIT_DRAG_STRENGTH = 0.15;
const SL_GRAVITY_STRENGTH = 0.08;
const SL_CLUSTER_MIN = 3;

export function adaptiveAggression(activeUsers: number): number {
  if (activeUsers < 20) return 3.5;
  if (activeUsers < 50) return 3.0;
  if (activeUsers < 100) return 2.7;
  return 2.5;
}

export interface MagnetPosition {
  direction: "UP" | "DOWN";
  stake: number;
  stopLoss: number | null;
  pnlFrac: number;
}

export interface MagnetInput {
  positions: MagnetPosition[];
  realMoveSign: number;
  volatility: number;
  sigma: number;
  activeUsers: number;
}

export function computeMagnetPull(input: MagnetInput): number {
  const { positions, realMoveSign, volatility, sigma, activeUsers } = input;
  if (positions.length === 0 || sigma <= 0) return 0;

  const aggression = adaptiveAggression(activeUsers);

  const volRatio = volatility / sigma;
  const volGate = Math.min(
    1,
    Math.max(0, (volRatio - VOL_GATE_THRESHOLD) / (1 - VOL_GATE_THRESHOLD)),
  );

  // Layer 1: Anti-Crowd Bias
  let netExposure = 0;
  let totalStake = 0;
  for (const p of positions) {
    const sign = p.direction === "UP" ? 1 : -1;
    netExposure += sign * p.stake;
    totalStake += p.stake;
  }

  const exposureRatio = totalStake > 0 ? netExposure / totalStake : 0;
  let antiCrowdPull = -exposureRatio * sigma * 0.1 * aggression * volGate;

  // Never fight the trend: zero out pull that opposes real market direction.
  // Anti-crowd wants to push opposite to crowd. If that push opposes the
  // real market direction, suppress it (we only dampen or amplify).
  if (realMoveSign !== 0 && antiCrowdPull !== 0) {
    const pullOpposesReal =
      (realMoveSign > 0 && antiCrowdPull > 0) ||
      (realMoveSign < 0 && antiCrowdPull < 0);
    // Wait: if real is going UP and anti-crowd pushes UP too, that AMPLIFIES
    // the move — which is allowed (we amplify moves that hurt the crowd).
    // If real is going UP and anti-crowd pushes DOWN, that DAMPENS — also ok.
    // The rule is: the SHOWN price must still move in the same direction as real.
    // That constraint is enforced at the tick loop (shown = real + gap delta).
    // Here we allow all pulls; the tick loop clamps final direction.
  }

  // Layer 2: SL Gravity
  let slGravity = 0;
  const longSlCount = positions.filter(
    (p) => p.direction === "UP" && p.stopLoss != null,
  ).length;
  const shortSlCount = positions.filter(
    (p) => p.direction === "DOWN" && p.stopLoss != null,
  ).length;

  if (longSlCount >= SL_CLUSTER_MIN && realMoveSign <= 0) {
    slGravity -= SL_GRAVITY_STRENGTH * sigma * aggression * volGate;
  }
  if (shortSlCount >= SL_CLUSTER_MIN && realMoveSign >= 0) {
    slGravity += SL_GRAVITY_STRENGTH * sigma * aggression * volGate;
  }

  // Layer 3: Profit Drag
  let profitDrag = 0;
  for (const p of positions) {
    if (p.pnlFrac > PROFIT_DRAG_THRESHOLD) {
      const dragSign = p.direction === "UP" ? -1 : 1;
      const excess = p.pnlFrac - PROFIT_DRAG_THRESHOLD;
      profitDrag += dragSign * excess * PROFIT_DRAG_STRENGTH * sigma * p.stake;
    }
  }
  if (totalStake > 0) profitDrag /= totalStake;
  profitDrag *= aggression * volGate;

  return antiCrowdPull + slGravity + profitDrag;
}
