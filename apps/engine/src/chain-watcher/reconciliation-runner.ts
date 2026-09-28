import { logger } from "@asm/logger";
import { runUsdtReconciliation } from "@asm/db";
import { resolveTronGridFullHost } from "./runner";
import { resolveBscConfig } from "./bsc-runner";

// Read directly via process.env at module scope — same precedent as
// runner.ts/bsc-runner.ts (see the comment at the top of runner.ts): these
// are specific to this one feature, not piped through @asm/config's strict
// shared schema.
const USDT_NETWORK = process.env["USDT_NETWORK"] ?? "";
const USDT_TRONGRID_NETWORK = process.env["USDT_TRONGRID_NETWORK"] ?? "";
const USDT_RECEIVING_ADDRESS = process.env["USDT_RECEIVING_ADDRESS"] ?? "";
const USDT_TOKEN_CONTRACT = process.env["USDT_TOKEN_CONTRACT"] ?? "";

/** The "network" value this runner logs under — it isn't itself a chain, it watches both. */
const RECONCILIATION_NETWORK = "reconciliation";

/**
 * Would the TRON watcher actually be configured? Mirrors runner.ts's own
 * idle branch exactly (runner.ts's `startChainWatcher`, the
 * `if (USDT_NETWORK !== "tron" || !USDT_RECEIVING_ADDRESS || !USDT_TOKEN_CONTRACT || !tronGridFullHost)`
 * check) rather than re-implementing env parsing by hand — runner.ts doesn't
 * expose that check as its own function, so this reads the same four env
 * vars the same way and calls the same exported `resolveTronGridFullHost`.
 */
function isTronConfigured(): boolean {
  const tronGridFullHost = resolveTronGridFullHost(USDT_TRONGRID_NETWORK);
  return USDT_NETWORK === "tron" && !!USDT_RECEIVING_ADDRESS && !!USDT_TOKEN_CONTRACT && !!tronGridFullHost;
}

/** Would the BSC watcher actually be configured? Reuses bsc-runner.ts's own exported check directly. */
function isBscConfigured(): boolean {
  return resolveBscConfig().ok;
}

export interface ReconciliationRunner {
  stop(): Promise<void>;
}

/**
 * Starts the read-only USDT reconciliation runner, or does nothing at all
 * when neither USDT network would actually be configured — mirrors
 * startChainWatcher()/startBscWatcher()'s own "idle unless configured" shape.
 * Self-rescheduling via setTimeout (never setInterval): the next timer is
 * only armed after the current tick's promise settles, so one execution can
 * never overlap another — same safety shape as
 * chain-watcher/watch-loop.ts's startAdaptiveWatchLoop. Unlike the two real
 * watchers this runs on a single fixed interval (no idle/active pacing) since
 * a reconciliation pass is cheap and doesn't need to react to deposit
 * activity.
 */
export function startReconciliationRunner(): ReconciliationRunner {
  if (!isTronConfigured() && !isBscConfigured()) {
    logger.info(
      { evt: "chain.watcher.idle", network: RECONCILIATION_NETWORK },
      "USDT reconciliation runner idle — neither TRON nor BSC is configured",
    );
    return { stop: async () => {} };
  }

  const intervalMs = Number(process.env["USDT_RECONCILIATION_INTERVAL_MS"] ?? 300_000);

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    // The whole tick is wrapped so a reconciliation failure can never crash
    // the process or affect the two real chain watchers — same reasoning as
    // every stage in runner.ts/bsc-runner.ts via runStage().
    try {
      const summary = await runUsdtReconciliation();

      for (const finding of summary.findings) {
        const log = finding.severity === "P1" ? logger.error : logger.warn;
        log.call(
          logger,
          {
            evt: "chain.reconciliation.finding",
            checkName: finding.checkName,
            network: finding.network,
            subjectType: finding.subjectType,
            subjectId: finding.subjectId,
            message: finding.message,
          },
          finding.message,
        );
      }

      // Only log a summary line when something actually changed — a clean run
      // (the expected steady state) stays completely silent to avoid log spam
      // every USDT_RECONCILIATION_INTERVAL_MS.
      if (summary.opened > 0 || summary.resolved > 0) {
        logger.info(
          {
            evt: "chain.reconciliation.run",
            opened: summary.opened,
            stillOpen: summary.stillOpen,
            resolved: summary.resolved,
          },
          "USDT reconciliation run changed open issue counts",
        );
      }
    } catch (err) {
      logger.error(
        {
          evt: "chain.watcher.tick_error",
          network: RECONCILIATION_NETWORK,
          stage: "reconciliation",
          reason: err instanceof Error ? err.message : "unknown",
        },
        "USDT reconciliation tick failed unexpectedly",
      );
    }
  }

  const schedule = (): void => {
    timer = setTimeout(() => {
      void tick().finally(() => {
        if (!stopped) schedule();
      });
    }, intervalMs);
  };
  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // Deliberately does not await an in-flight tick — its own DB reads are
      // read-only and safe to let finish; main.ts disconnects prisma only
      // after every stop() has been awaited.
      logger.info({ evt: "chain.watcher.stopped", network: RECONCILIATION_NETWORK }, "USDT reconciliation runner stopped");
    },
  };
}
