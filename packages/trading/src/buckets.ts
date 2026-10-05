import type { Direction } from "./outcome";

/**
 * House-governor path style. See packages/algo/src/path-style.ts. Kept as a
 * string literal here so @asm/trading (the schema-package) does not need to
 * depend on @asm/algo (the decision-package).
 */
export type PositionPathStyle = "DIRECT" | "OSCILLATE" | "FEINT";

/** House-governor verdict stamped at trade open. */
export type PositionVerdict = "WIN" | "LOSS" | "HONEST";

export interface Position {
  readonly tradeId: string;
  readonly accountId: string;
  readonly assetId: string;
  readonly direction: Direction;
  readonly stake: number;
  readonly payoutPct: number;
  readonly entryPrice: number;
  /** Epoch seconds. */
  readonly expirySec: number;
  /** Entry epoch seconds. Needed by the per-trade magnet to compute elapsedFrac. */
  readonly entrySec?: number;
  readonly isDemo: boolean;
  /**
   * House-governor stamps. Present only for trades opened while
   * USE_HOUSE_GOVERNOR was on. Undefined = pre-existing trade / flag off /
   * demo grandfathered = treat as HONEST with no target.
   */
  readonly verdict?: PositionVerdict;
  readonly pathStyle?: PositionPathStyle;
  readonly targetPrice?: number;
}

export interface ExpiryBucket {
  readonly assetId: string;
  readonly expirySec: number;
  readonly positions: Position[];
}

function keyOf(assetId: string, expirySec: number): string {
  return `${assetId}|${expirySec}`;
}

/**
 * In-memory index of open positions, grouped by (asset, expiry second).
 *
 * Bucketing matters for correctness, not just convenience: every position
 * expiring in the same second must settle against ONE captured price, or two
 * accounts receive inconsistent outcomes from the same moment.
 */
export class BucketRegistry {
  private buckets = new Map<string, Position[]>();
  private index = new Map<string, string>();

  add(position: Position): void {
    const key = keyOf(position.assetId, position.expirySec);
    const existing = this.buckets.get(key);
    if (existing) {
      existing.push(position);
    } else {
      this.buckets.set(key, [position]);
    }
    this.index.set(position.tradeId, key);
  }

  /**
   * Non-destructive bucket peek by exact key. Returns the positions already
   * sitting in (assetId, expirySec) — empty array if the bucket has no
   * trades yet. Used by the open-time value-imbalance override to decide
   * whether a new trade would tip its direction into the heavier side of
   * the contest, so its verdict can be forced to LOSS before the per-trade
   * magnet starts steering toward a WIN target.
   */
  positionsAt(assetId: string, expirySec: number): readonly Position[] {
    return this.buckets.get(keyOf(assetId, expirySec)) ?? [];
  }

  /**
   * Non-destructive peek. Returns every bucket whose expirySec is in the
   * inclusive range [fromSec, toSec]. Used by the pre-settle pass to look
   * one tick ahead so the chart can snap to the resolver's picked exit
   * price *before* the user's expiry countdown reaches zero.
   */
  peekRange(fromSec: number, toSec: number): ExpiryBucket[] {
    const out: ExpiryBucket[] = [];
    for (const [key, positions] of this.buckets) {
      const expirySec = Number(key.slice(key.indexOf("|") + 1));
      if (expirySec < fromSec || expirySec > toSec) continue;
      out.push({
        assetId: key.slice(0, key.indexOf("|")),
        expirySec,
        positions,
      });
    }
    return out.sort((a, b) => a.expirySec - b.expirySec);
  }

  /**
   * Returns every bucket at or before `nowSec`, removing them.
   * Overdue buckets are included deliberately — if the loop stalled, those
   * trades must still settle rather than being silently stranded.
   */
  due(nowSec: number): ExpiryBucket[] {
    const out: ExpiryBucket[] = [];

    for (const [key, positions] of this.buckets) {
      const expirySec = Number(key.slice(key.indexOf("|") + 1));
      if (expirySec > nowSec) continue;
      out.push({
        assetId: key.slice(0, key.indexOf("|")),
        expirySec,
        positions,
      });
    }

    for (const bucket of out) {
      const key = keyOf(bucket.assetId, bucket.expirySec);
      this.buckets.delete(key);
      for (const position of bucket.positions) this.index.delete(position.tradeId);
    }

    return out.sort((a, b) => a.expirySec - b.expirySec);
  }

  /** Every open position on one asset. Plan 04's imbalance calculation reads this. */
  openFor(assetId: string): Position[] {
    const out: Position[] = [];
    for (const [key, positions] of this.buckets) {
      if (key.slice(0, key.indexOf("|")) === assetId) out.push(...positions);
    }
    return out;
  }

  size(): number {
    return this.index.size;
  }

  remove(tradeId: string): boolean {
    const key = this.index.get(tradeId);
    if (!key) return false;

    const positions = this.buckets.get(key);
    if (!positions) {
      this.index.delete(tradeId);
      return false;
    }

    const next = positions.filter((p) => p.tradeId !== tradeId);
    if (next.length === 0) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, next);
    }
    this.index.delete(tradeId);
    return true;
  }
}
