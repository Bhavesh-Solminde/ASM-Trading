import { logger } from "@asm/logger";
import { autoPromoteHeldWithdrawals } from "@asm/db";

export interface HeldWithdrawalRelease {
  stop(): Promise<void>;
}

/**
 * Moves HELD withdrawals whose holdUntil has passed to REQUESTED, so the admin
 * review queue picks them up. The legacy tick loop used to do this once a
 * minute; the OTC engine never ran that loop, so without this job a hold would
 * never end on its own. Same shape as startProgramDayClose: self-rescheduling
 * setTimeout, so one run can never overlap the next. The update is a single
 * idempotent statement.
 */
export function startHeldWithdrawalRelease(): HeldWithdrawalRelease {
  const intervalMs = Number(process.env["WITHDRAWAL_HOLD_RELEASE_INTERVAL_MS"] ?? 60_000);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    try {
      const promoted = await autoPromoteHeldWithdrawals(new Date());
      if (promoted > 0) {
        logger.info({ evt: "withdrawal.hold_auto_promoted", count: promoted }, "promoted held withdrawals to requested");
      }
    } catch (err) {
      logger.error(
        { evt: "withdrawal.hold_auto_promote_failed", reason: err instanceof Error ? err.message : "unknown" },
        "held withdrawal release failed",
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
    },
  };
}
