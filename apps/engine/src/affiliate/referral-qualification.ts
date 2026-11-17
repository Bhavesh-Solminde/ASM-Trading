import { logger } from "@asm/logger";
import { evaluateReferralQualification, listUnqualifiedReferredUserIds } from "@asm/db";

const SWEEP_BATCH = 200;

// Settlement-triggered evaluations share the Prisma pool with settlements, so
// a big drain must not fan out into hundreds of concurrent queries.
const MAX_IN_FLIGHT = 4;
const MAX_QUEUED = 1_000;
const queue: { userId: string; tradeId: string }[] = [];
const pendingUsers = new Set<string>(); // queued or in flight
const botUsers = new Set<string>();
let inFlight = 0;

/** Bot crowd users never qualify; the engine already knows them, so they skip the evaluation entirely. */
export function markBotUser(userId: string): void {
  botUsers.add(userId);
}

/**
 * Fire-and-forget referral qualification check after a LIVE trade settles
 * (Affiliate Program spec, "Triggers"). Callers invoke
 * it only after the settlement committed; it never awaits, never throws, and a
 * failure is only logged. At most MAX_IN_FLIGHT run at once; a user already
 * queued or in flight is not queued again, and beyond MAX_QUEUED it drops —
 * the 5-minute sweep catches up on anything skipped.
 */
export function evaluateReferralAfterSettlement(userId: string, tradeId: string): void {
  if (botUsers.has(userId) || pendingUsers.has(userId)) return;
  if (queue.length >= MAX_QUEUED) {
    logger.debug({ evt: "referral.evaluate_dropped", userId, tradeId }, "referral evaluation queue full — left to the sweep");
    return;
  }
  pendingUsers.add(userId);
  queue.push({ userId, tradeId });
  pump();
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const { userId, tradeId } = queue.shift()!;
    inFlight += 1;
    // Deferred so even a synchronous throw cannot escape into the settlement path.
    void Promise.resolve()
      .then(() => evaluateReferralQualification(userId))
      .then(({ outcome }) => {
        if (outcome === "qualified") {
          logger.info({ evt: "referral.qualified", userId, tradeId }, "referred user qualified after trade settlement");
        }
      })
      .catch((err: unknown) => {
        logger.error(
          { evt: "referral.evaluate_failed", userId, tradeId, reason: err instanceof Error ? err.message : "unknown" },
          "referral qualification check failed after settlement",
        );
      })
      .finally(() => {
        inFlight -= 1;
        pendingUsers.delete(userId);
        pump();
      });
  }
}

export interface ReferralSweepSummary {
  checked: number;
  qualified: number;
  failed: number;
  /** Where the next pass continues; undefined once the end of the list was reached (wraps around). */
  nextAfterId: string | undefined;
}

/**
 * One sweep pass: evaluates one page of unqualified referred users sequentially;
 * one failure never stops the rest. Paged by id so users that never qualify
 * cannot starve the others.
 */
export async function runReferralQualificationSweep(afterId?: string): Promise<ReferralSweepSummary> {
  const ids = await listUnqualifiedReferredUserIds(SWEEP_BATCH, afterId);
  const summary: ReferralSweepSummary = {
    checked: 0, qualified: 0, failed: 0,
    nextAfterId: ids.length === SWEEP_BATCH ? ids[ids.length - 1] : undefined,
  };
  for (const userId of ids) {
    summary.checked += 1;
    try {
      const { outcome } = await evaluateReferralQualification(userId);
      if (outcome === "qualified") summary.qualified += 1;
    } catch (err) {
      summary.failed += 1;
      logger.error(
        { evt: "referral.sweep_evaluate_failed", userId, reason: err instanceof Error ? err.message : "unknown" },
        "referral qualification sweep failed for one user",
      );
    }
  }
  return summary;
}

export interface ReferralQualificationSweep {
  stop(): Promise<void>;
}

/**
 * Starts the referral qualification sweep (catch-up + crash safety for the
 * deposit/settlement triggers). Same shape as startReconciliationRunner:
 * self-rescheduling setTimeout, so one pass can never overlap the next.
 * Kill-switch: REFERRAL_QUALIFICATION_SWEEP_ENABLED=false.
 */
export function startReferralQualificationSweep(): ReferralQualificationSweep {
  if (process.env["REFERRAL_QUALIFICATION_SWEEP_ENABLED"] === "false") {
    logger.info({ evt: "referral.sweep.disabled" }, "referral qualification sweep disabled");
    return { stop: async () => {} };
  }

  const intervalMs = Number(process.env["REFERRAL_QUALIFICATION_SWEEP_INTERVAL_MS"] ?? 300_000);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let afterId: string | undefined;

  async function tick(): Promise<void> {
    try {
      const summary = await runReferralQualificationSweep(afterId);
      afterId = summary.nextAfterId;
      logger.info({ evt: "referral.sweep.run", ...summary }, "referral qualification sweep finished");
    } catch (err) {
      logger.error(
        { evt: "referral.sweep.tick_error", reason: err instanceof Error ? err.message : "unknown" },
        "referral qualification sweep failed",
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
      // An in-flight pass is not awaited: each evaluation is its own idempotent
      // transaction, and main.ts disconnects prisma only after every stop().
      logger.info({ evt: "referral.sweep.stopped" }, "referral qualification sweep stopped");
    },
  };
}
