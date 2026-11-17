import { logger } from "@asm/logger";
import { closeDueProgramDays } from "@asm/db";

export interface ProgramDayClose {
  stop(): Promise<void>;
}

/**
 * Starts the Affiliate Program daily close (Affiliate Program spec,
 * "Engine"). Same shape as startReferralQualificationSweep: self-rescheduling
 * setTimeout, so one run can never overlap the next. closeDueProgramDays is
 * idempotent and takes its own advisory locks, so both engine modes may run it.
 * Kill-switch: PROGRAM_DAY_CLOSE_ENABLED=false.
 */
export function startProgramDayClose(): ProgramDayClose {
  if (process.env["PROGRAM_DAY_CLOSE_ENABLED"] === "false") {
    logger.info({ evt: "program.day_close.disabled" }, "program day close disabled");
    return { stop: async () => {} };
  }

  const intervalMs = Number(process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"] ?? 300_000);
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    try {
      const { closedDays } = await closeDueProgramDays(new Date());
      logger.info({ evt: "program.day_close.run", closedDays }, "program day close finished");
    } catch (err) {
      logger.error(
        { evt: "program.day_close.tick_error", reason: err instanceof Error ? err.message : "unknown" },
        "program day close failed",
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
      // An in-flight close is not awaited: each day closes in its own idempotent
      // transaction, and main.ts disconnects prisma only after every stop().
      logger.info({ evt: "program.day_close.stopped" }, "program day close stopped");
    },
  };
}
