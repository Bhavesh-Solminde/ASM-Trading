import { logger } from "@asm/logger";

/**
 * How long after a deposit's window closes it still counts as "active" —
 * exchange withdrawals and slow wallets routinely land a few minutes late.
 */
export const USDT_LATE_PAYMENT_GRACE_MS = 15 * 60_000;

export interface AdaptiveWatchLoop {
  stop(): void;
}

/**
 * The adaptive timer loop shared by every network's USDT watcher (TRON's
 * runner.ts, BSC's bsc-runner.ts). It wakes every `tickIntervalMs` but only
 * runs a full (chain-calling) tick when `isActive` says someone is depositing
 * / a transfer is confirming — otherwise at most once per `idleIntervalMs`,
 * which still guarantees late or unexpected payments are found. The very
 * first wake always runs a full tick.
 *
 * Self-rescheduling via setTimeout (never setInterval), and the next timer is
 * only armed after the current wake's promise settles — both "one execution
 * cannot overlap another" and "no uncontrolled tight loop" in one mechanism.
 */
export function startAdaptiveWatchLoop(opts: {
  network: string;
  tickIntervalMs: number;
  idleIntervalMs: number;
  isActive: (now: Date) => Promise<boolean>;
  tick: () => Promise<void>;
}): AdaptiveWatchLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let lastFullTickAt = 0;
  let mode: "active" | "idle" | null = null;

  async function wake(): Promise<void> {
    const now = Date.now();
    // Fail toward doing the work: if the cheap DB check itself errors, run the
    // full tick rather than risk silently skipping detection.
    let active = true;
    try {
      active = await opts.isActive(new Date(now));
    } catch (err) {
      logger.error(
        {
          evt: "chain.watcher.tick_error",
          network: opts.network,
          stage: "activity_check",
          reason: err instanceof Error ? err.message : "unknown",
        },
        "activity check failed — running a full tick anyway",
      );
    }

    const nextMode = active ? "active" : "idle";
    if (nextMode !== mode) {
      mode = nextMode;
      logger.info(
        {
          evt: "chain.watcher.mode",
          network: opts.network,
          mode,
          intervalMs: active ? opts.tickIntervalMs : opts.idleIntervalMs,
        },
        active
          ? `USDT watcher (${opts.network}): deposit activity — checking the chain every tick`
          : `USDT watcher (${opts.network}): no deposit activity — slowing down`,
      );
    }

    if (!active && now - lastFullTickAt < opts.idleIntervalMs) return;
    lastFullTickAt = now;
    await opts.tick();
  }

  const schedule = (): void => {
    timer = setTimeout(() => {
      void wake()
        .catch((err: unknown) => {
          logger.error(
            {
              evt: "chain.watcher.tick_error",
              network: opts.network,
              stage: "unknown",
              reason: err instanceof Error ? err.message : "unknown",
            },
            "chain watcher tick failed unexpectedly",
          );
        })
        .finally(() => {
          if (!stopped) schedule();
        });
    }, opts.tickIntervalMs);
  };
  schedule();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // Deliberately does not await an in-flight tick — its own DB
      // transactions are atomic and safe to run to completion; main.ts
      // disconnects prisma only after every stop() has been awaited.
    },
  };
}

/** Runs one watcher stage, logging (never rethrowing) its failure so one stage can't kill the tick or the loop. */
export async function runStage(network: string, stage: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(
      { evt: "chain.watcher.tick_error", network, stage, reason: err instanceof Error ? err.message : "unknown" },
      `${stage} stage threw`,
    );
  }
}
