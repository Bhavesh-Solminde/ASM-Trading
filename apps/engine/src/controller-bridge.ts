import { desiredWinProb, drawOutcome, type ControllerOutput } from "@asm/algo";
import { loadAccountStats } from "@asm/db";
import { logger } from "@asm/logger";
import type { Rng } from "@asm/pricing";

const CACHE_TTL_MS = 5_000;

interface CachedStats {
  output: ControllerOutput;
  expiresAt: number;
}

export interface WishResult {
  wantWin: boolean;
  urgency: number;
  winProbability: number;
  stage: string;
}

/**
 * Bridges the pure controller (packages/algo) to the live engine.
 *
 * The cache prevents burst queries during periods of high trade open activity.
 * It is invalidated explicitly after each settlement so the controller sees
 * the updated posterior immediately for the NEXT trade.
 *
 * Failure is deliberately non-fatal: if the DB is unreachable when a wish is
 * requested, the trade runs unsteered. An unsteered trade is not a correctness
 * error — it just converges slightly slower. A crash is far worse.
 */
export class ControllerBridge {
  private readonly cache = new Map<string, CachedStats>();

  constructor(
    private readonly rng: Rng,
    private readonly loadStats: typeof loadAccountStats = loadAccountStats,
  ) {}

  async wishFor(accountId: string): Promise<WishResult | null> {
    try {
      let cached = this.cache.get(accountId);
      if (!cached || Date.now() > cached.expiresAt) {
        const stats = await this.loadStats(accountId);
        const output = desiredWinProb(stats);
        cached = { output, expiresAt: Date.now() + CACHE_TTL_MS };
        this.cache.set(accountId, cached);
      }

      const { output } = cached;
      const wantWin = drawOutcome(output.p, this.rng);

      return {
        wantWin,
        urgency: output.urgency,
        winProbability: output.p,
        stage: output.stage,
      };
    } catch (err) {
      logger.warn(
        {
          evt: "controller.wish_failed",
          accountId,
          reason: err instanceof Error ? err.message : "unknown",
        },
        "wish draw failed — trade runs unsteered",
      );
      return null;
    }
  }

  /** Called after settlement so the next trade sees the updated posterior. */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
