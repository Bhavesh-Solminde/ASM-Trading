import { config } from "@asm/config";
import {
  DEMO_VPA,
  createBankCreditIfNew,
  matchCreditToDeposit,
  type BankCredit,
} from "@asm/db";
import { logger } from "@asm/logger";
import { createSimulatedFeed } from "./simulated";
import type { BankFeed } from "./types";

const SIMULATED_DELAY_MS = Number(process.env.SIMULATED_FEED_DELAY_MS ?? 3000);
const SIMULATED_FAILURE_RATE = Number(process.env.SIMULATED_FEED_FAILURE_RATE ?? 0);

/**
 * Starts the configured bank feed and reconciles every credit it delivers
 * against a live deposit, exactly as the SMS ingress route does for a real
 * relayed message. Only `simulated` runs a feed here — `sms`/`email` credits
 * arrive through the web ingress route instead, so this is a no-op for them and
 * the engine never opens a second path to the same table.
 */
export async function startBankFeedRunner(): Promise<{ stop(): Promise<void> }> {
  if (config.bankFeed !== "simulated") {
    logger.info(
      { evt: "bankfeed.runner_idle", feed: config.bankFeed },
      "bank feed runner idle — credits arrive via the web ingress route",
    );
    return { stop: async () => {} };
  }

  const feed: BankFeed = createSimulatedFeed({
    delayMs: SIMULATED_DELAY_MS,
    failureRate: SIMULATED_FAILURE_RATE,
  });

  await feed.start((credit) => {
    void reconcile(credit).catch((err: unknown) => {
      logger.error(
        { evt: "bankfeed.reconcile_failed", reason: err instanceof Error ? err.message : "unknown" },
        "simulated credit failed to reconcile",
      );
    });
  });

  logger.info(
    { evt: "bankfeed.runner_started", feed: "simulated", delayMs: SIMULATED_DELAY_MS },
    "simulated bank feed running",
  );

  return { stop: () => feed.stop() };
}

async function reconcile(credit: {
  amountInr: number;
  utr: string | null;
  receivedAt: Date;
  raw: string;
}): Promise<void> {
  // A synthetic reference when the credit carries none, so the unique index on
  // BankCredit.utr still dedups identical retries.
  const utr = credit.utr ?? `sim-${credit.amountInr}-${credit.receivedAt.getTime()}`;

  const created: BankCredit | null = await createBankCreditIfNew({
    vpa: DEMO_VPA,
    amountInr: credit.amountInr,
    utr,
    receivedAt: credit.receivedAt,
    raw: credit.raw,
  });
  if (!created) return; // Already seen — a duplicate emission, nothing to do.

  const outcome = await matchCreditToDeposit({
    creditId: created.id,
    amountInr: created.amountInr,
    utr: credit.utr,
  });

  logger.info(
    { evt: "bankfeed.matched", outcome: outcome.kind, bankCreditId: created.id },
    "simulated credit reconciled",
  );
}
