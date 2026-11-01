import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { GapTracker } from "./gap";

/**
 * Why this file exists:
 *
 * `GapTracker` lives in RAM. It holds the three-layer magnet's accumulated
 * gap per symbol — up to ±(sigma1h × maxGapMultiple) — and shown price is
 * `real × (1 + gap)`. Before this persistence layer existed, every engine
 * restart dropped the gap back to 0 and the next broadcast tick snapped the
 * shown price by the full pre-restart gap value. The chart then opened a
 * fresh OHLC bucket at that new level, so the user saw a visible vertical
 * step between consecutive candles on every deploy.
 *
 * We now:
 *   1. Snapshot GapTracker to Postgres every `SNAPSHOT_INTERVAL_MS` so even a
 *      hard crash loses at most ~30s of magnet accumulation.
 *   2. Snapshot one last time on SIGTERM for a clean deploy restart.
 *   3. Load the snapshot on boot and seed GapTracker before the first tick.
 */

const SNAPSHOT_INTERVAL_MS = 30_000;

/**
 * Read every stored (symbol, gap) row and seed the tracker. Call AFTER
 * `registerAsset` for every live asset — the tracker's restore() silently
 * skips any symbol it hasn't been told about.
 */
export async function loadGapSnapshot(tracker: GapTracker): Promise<number> {
  try {
    const rows = await prisma.engineAssetState.findMany({ select: { symbol: true, gap: true } });
    const restored = tracker.restore(rows);
    logger.info(
      { evt: "engine.gap_snapshot_loaded", rows: rows.length, restored },
      "GapTracker seeded from persisted snapshot",
    );
    return restored;
  } catch (err) {
    // A missing table on first deploy after this change (migration not run
    // yet) must NOT prevent the engine from starting — the tracker already
    // defaults to zero everywhere, which is correct baseline behavior.
    logger.warn(
      { evt: "engine.gap_snapshot_load_failed", err: String(err) },
      "GapTracker snapshot load failed — starting with zero gap everywhere",
    );
    return 0;
  }
}

/**
 * Write every tracked (symbol, gap) pair into the EngineAssetState table in a
 * single transaction so a half-written set never seeds a stale subset later.
 */
export async function persistGapSnapshot(tracker: GapTracker): Promise<number> {
  const snapshot = tracker.snapshot();
  if (snapshot.length === 0) return 0;
  try {
    await prisma.$transaction(
      snapshot.map(({ symbol, gap }) =>
        prisma.engineAssetState.upsert({
          where: { symbol },
          create: { symbol, gap },
          update: { gap },
        }),
      ),
    );
    return snapshot.length;
  } catch (err) {
    logger.warn(
      { evt: "engine.gap_snapshot_persist_failed", err: String(err) },
      "GapTracker snapshot persist failed — will retry on next tick",
    );
    return 0;
  }
}

/**
 * Fire-and-forget interval snapshotter. Returns a `stop()` that both clears
 * the timer and runs one final persist so a SIGTERM leaves state current.
 */
export function startGapSnapshotLoop(tracker: GapTracker): { stop: () => Promise<void> } {
  const timer = setInterval(() => { void persistGapSnapshot(tracker); }, SNAPSHOT_INTERVAL_MS);
  // Node keeps the event loop alive on a dangling interval; unref so the
  // process can still exit cleanly if the loop is the only remaining handle.
  timer.unref?.();
  return {
    async stop() {
      clearInterval(timer);
      await persistGapSnapshot(tracker);
    },
  };
}
