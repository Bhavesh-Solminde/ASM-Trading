import { desiredWinProb, drawOutcome, type ControllerOutput } from "@asm/algo";
import { createRng, type Rng } from "@asm/pricing";
import { loadAccountStats } from "@asm/db";
import { logger } from "@asm/logger";

interface Cached {
  output: ControllerOutput;
  loadedAtMs: number;
}

const CACHE_TTL_MS = 5_000;

/**
 * Owns the account -> desired-win-probability path. Caches the controller's
 * output per account for CACHE_TTL_MS so a burst of settlements for the same
 * account doesn't hammer the database, then draws an independent outcome per
 * call — the cached `p` is reused, but every wish is its own coin flip.
 */
export class ControllerBridge {
  private cache = new Map<string, Cached>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  async wishFor(accountId: string): Promise<{
    wantWin: boolean;
    urgency: number;
    output: ControllerOutput;
  }> {
    const cached = this.cache.get(accountId);
    let output: ControllerOutput;

    if (cached && Date.now() - cached.loadedAtMs < CACHE_TTL_MS) {
      output = cached.output;
    } else {
      const stats = await loadAccountStats(accountId);
      output = desiredWinProb(stats);
      this.cache.set(accountId, { output, loadedAtMs: Date.now() });
    }

    const wantWin = drawOutcome(output.p, this.rng);

    if (output.ceilingActive) {
      logger.info(
        {
          evt: "algo.ceiling_engaged",
          accountId,
          posteriorShort: Number(output.posteriorShort.toFixed(4)),
          posteriorLife: Number(output.posteriorLife.toFixed(4)),
          p: Number(output.p.toFixed(4)),
        },
        "hard ceiling engaged",
      );
    }

    return { wantWin, urgency: output.urgency, output };
  }
}
