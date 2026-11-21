import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { usdtProviderFor } from "@asm/tatum";
import { startBankFeedRunner } from "./bank-feed/runner";
import { startChainWatcher } from "./chain-watcher/runner";
import { startBscWatcher } from "./chain-watcher/bsc-runner";
import { startReconciliationRunner } from "./chain-watcher/reconciliation-runner";
import { startTatumRunner } from "./tatum-runner";
import { startReferralQualificationSweep } from "./affiliate/referral-qualification";
import { startProgramDayClose } from "./affiliate/program-day-close";
import { startHeldWithdrawalRelease } from "./withdrawals/held-release";

/**
 * The background jobs process (compose service `jobs`): deposit detection
 * (bank feed, USDT chain watchers, Tatum gateway, reconciliation), affiliate
 * sweeps and held-withdrawal release. They work only through the database, so
 * they run apart from the trading engine: a slow or crashing job can't stall
 * trades, and either process can restart without the other. Each job keeps
 * its own schedule and idempotency (unique deposit keys, advisory locks).
 */
async function startJobs(): Promise<void> {
  const idle = { stop: async () => {} };
  const jobs: { stop(): Promise<void> }[] = [];
  jobs.push(await startBankFeedRunner());
  jobs.push(usdtProviderFor("tron") === "manual" ? await startChainWatcher() : idle);
  jobs.push(usdtProviderFor("bsc") === "manual" ? await startBscWatcher() : idle);
  jobs.push(startTatumRunner(), startReconciliationRunner());
  jobs.push(startReferralQualificationSweep(), startProgramDayClose(), startHeldWithdrawalRelease());

  let stopping = false;
  async function shutdown(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    for (const job of jobs.reverse()) {
      await job.stop().catch((err: unknown) =>
        logger.error({ evt: "jobs.shutdown_error", reason: String(err) }, "job failed to stop"));
    }
    await prisma.$disconnect();
    process.exit(code);
  }
  const fatal = (err: unknown) => {
    logger.error({ evt: "jobs.fatal", reason: err instanceof Error ? err.message : String(err) }, "jobs process failed");
    void shutdown(1);
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  process.on("unhandledRejection", fatal);
  process.on("uncaughtException", fatal);
  logger.info({ evt: "jobs.started" }, "background jobs running");
}

void startJobs().catch((err: unknown) => {
  logger.error(
    { evt: "jobs.start_failed", reason: err instanceof Error ? err.message : "unknown" },
    "jobs failed to start",
  );
  process.exit(1);
});
