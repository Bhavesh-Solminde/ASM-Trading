import type { Direction } from "./outcome";

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
