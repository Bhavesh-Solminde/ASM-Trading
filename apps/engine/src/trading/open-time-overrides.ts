/**
 * Open-time verdict overrides.
 *
 * When a new LIVE trade is being opened, two rules may re-stamp earlier
 * trades in the same bucket BEFORE the magnet starts steering, so that
 * the chart's steering direction matches the FINAL verdict for the whole
 * trade duration. This preserves the chart-as-source-of-truth invariant
 * from PR #49: the chart's close at expiry equals the settled outcome.
 *
 * Rules in order:
 *
 *   (A) Heavy-side cascade — any WIN stamp on the direction with the
 *       larger total stake in the bucket flips to LOSS. Iterate until
 *       stable (a flip can shift the heavier side).
 *
 *   (B) LIVE batch rule — group the user's trades expiring in the same
 *       TICK_DT_SEC window; if that batch has >= 5 trades and fewer
 *       than 60% carry WIN stamps, flip every WIN in the batch to LOSS.
 *
 * Demos are excluded from both rules. Demo outcomes are decided in the
 * settlement-side inverted-majority rule inside TradeDesk.preSettle,
 * which never touches the chart.
 */

import { pickStyle, type PathStyle } from "@asm/algo";
import { TICK_DT_SEC } from "@asm/pricing";
import type { Position } from "@asm/trading";

export type Verdict = "WIN" | "LOSS" | "HONEST";
export type Direction = "UP" | "DOWN";

export interface PendingTrade {
  readonly direction: Direction;
  readonly stake: number;
  readonly durationSec: number;
  readonly entryPrice: number;
  readonly expirySec: number;
  readonly isDemo: boolean;
  readonly accountId: string;
  verdict: Verdict;
  pathStyle: PathStyle;
  targetPrice: number;
}

export interface Flip {
  readonly verdict: Verdict;
  readonly pathStyle: PathStyle;
  readonly targetPrice: number;
}

/** Minimum batch size at which the LIVE batch rule fires. */
export const BATCH_RULE_MIN_SIZE = 5;

/** WIN-stamp fraction required to keep a batch's trades as-is. */
export const BATCH_RULE_WIN_THRESHOLD = 0.6;

/**
 * Compute the targetPrice for a given (verdict, direction) pair.
 *
 * WIN  → user's side (chart moves user's way).
 * LOSS → house side  (chart moves against the user).
 * HONEST → entryPrice (no steering).
 */
export function targetPriceFor(
  verdict: Verdict,
  direction: Direction,
  entryPrice: number,
  tickSize: number,
): number {
  if (verdict === "HONEST") return entryPrice;
  const userWins = verdict === "WIN";
  if (direction === "UP") {
    return userWins ? entryPrice + tickSize : entryPrice - tickSize;
  }
  return userWins ? entryPrice - tickSize : entryPrice + tickSize;
}

/** Expiry-tick bucket (floor of expirySec to TICK_DT_SEC grid). */
export function expiryTickBucket(expirySec: number): number {
  return Math.floor(expirySec / TICK_DT_SEC) * TICK_DT_SEC;
}

interface EffectiveStamp {
  verdict: Verdict | undefined;
  direction: Direction;
  stake: number;
  entryPrice: number;
  expirySec: number;
  entrySec: number | undefined;
  tradeId: string;
  isDemo: boolean;
}

function toEffective(p: Position): EffectiveStamp {
  return {
    verdict: p.verdict,
    direction: p.direction,
    stake: p.stake,
    entryPrice: p.entryPrice,
    expirySec: p.expirySec,
    entrySec: p.entrySec,
    tradeId: p.tradeId,
    isDemo: p.isDemo,
  };
}

/**
 * Apply the heavy-side cascade and the LIVE batch rule to a pending trade
 * against the current state of the (asset, expirySec) bucket and the
 * user's open positions on the asset.
 *
 * Returns a map of tradeId → Flip for existing positions that must be
 * re-stamped, and mutates `pending` in place for the new trade.
 */
export function applyOpenTimeOverrides(input: {
  pending: PendingTrade;
  bucketPositions: readonly Position[];
  userPositionsOnAsset: readonly Position[];
  tickSize: number;
  rng?: () => number;
}): Map<string, Flip> {
  const { pending, bucketPositions, userPositionsOnAsset, tickSize } = input;
  const rng = input.rng ?? Math.random;
  const flipped = new Map<string, Flip>();

  // Demos never enter either rule.
  if (pending.isDemo) return flipped;

  const effectiveFor = (tradeId: string, fallback: EffectiveStamp): EffectiveStamp => {
    const flip = flipped.get(tradeId);
    if (!flip) return fallback;
    return { ...fallback, verdict: flip.verdict };
  };

  // --- (A) Heavy-side cascade -------------------------------------------
  // Iterate until no WIN remains on the heavier-stake side.
  const bucketEff = bucketPositions.filter((p) => !p.isDemo).map(toEffective);

  for (let guard = 0; guard < 8; guard++) {
    let upStake = 0;
    let downStake = 0;
    for (const e of bucketEff) {
      const v = effectiveFor(e.tradeId, e).verdict;
      if (v == null || v === "HONEST") continue;
      if (e.direction === "UP") upStake += e.stake;
      else downStake += e.stake;
    }
    if (pending.verdict !== "HONEST") {
      if (pending.direction === "UP") upStake += pending.stake;
      else downStake += pending.stake;
    }
    const heavy: Direction | null =
      upStake > downStake ? "UP" : upStake < downStake ? "DOWN" : null;
    if (heavy === null) break;
    const lightStake = heavy === "UP" ? downStake : upStake;
    if (lightStake === 0) break;

    let changed = false;
    for (const e of bucketEff) {
      if (e.direction !== heavy) continue;
      const v = effectiveFor(e.tradeId, e).verdict;
      if (v !== "WIN") continue;
      const duration = e.entrySec !== undefined ? e.expirySec - e.entrySec : 60;
      const newStyle = pickStyle(Math.max(1, duration), "LOSS", rng);
      flipped.set(e.tradeId, {
        verdict: "LOSS",
        pathStyle: newStyle,
        targetPrice: targetPriceFor("LOSS", e.direction, e.entryPrice, tickSize),
      });
      changed = true;
    }
    if (pending.verdict === "WIN" && pending.direction === heavy) {
      pending.verdict = "LOSS";
      pending.pathStyle = pickStyle(pending.durationSec, "LOSS", rng);
      pending.targetPrice = targetPriceFor(
        "LOSS",
        pending.direction,
        pending.entryPrice,
        tickSize,
      );
      changed = true;
    }
    if (!changed) break;
  }

  // --- (B) LIVE batch rule ----------------------------------------------
  const bucket = expiryTickBucket(pending.expirySec);
  const bucketStart = bucket;
  const bucketEnd = bucket + TICK_DT_SEC;

  const userBatch = userPositionsOnAsset.filter(
    (p) =>
      !p.isDemo &&
      p.accountId === pending.accountId &&
      p.expirySec >= bucketStart &&
      p.expirySec < bucketEnd,
  );

  const batchTotal = userBatch.length + 1; // includes the pending trade
  if (batchTotal < BATCH_RULE_MIN_SIZE) return flipped;

  let winCount = 0;
  for (const p of userBatch) {
    const effV = effectiveFor(p.tradeId, toEffective(p)).verdict;
    if (effV === "WIN") winCount += 1;
  }
  if (pending.verdict === "WIN") winCount += 1;

  const winRatio = winCount / batchTotal;
  if (winRatio >= BATCH_RULE_WIN_THRESHOLD) return flipped;

  // Threshold not met → every WIN in the batch flips to LOSS.
  for (const p of userBatch) {
    const effV = effectiveFor(p.tradeId, toEffective(p)).verdict;
    if (effV !== "WIN") continue;
    const duration = p.entrySec !== undefined ? p.expirySec - p.entrySec : 60;
    const newStyle = pickStyle(Math.max(1, duration), "LOSS", rng);
    flipped.set(p.tradeId, {
      verdict: "LOSS",
      pathStyle: newStyle,
      targetPrice: targetPriceFor("LOSS", p.direction, p.entryPrice, tickSize),
    });
  }
  if (pending.verdict === "WIN") {
    pending.verdict = "LOSS";
    pending.pathStyle = pickStyle(pending.durationSec, "LOSS", rng);
    pending.targetPrice = targetPriceFor(
      "LOSS",
      pending.direction,
      pending.entryPrice,
      tickSize,
    );
  }

  return flipped;
}
