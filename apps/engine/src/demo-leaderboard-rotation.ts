import { addIstDays, istDay, istDayStart, seedDemoLeaderboardProfiles } from "@asm/db";
import { logger } from "@asm/logger";

export function startDemoLeaderboardRotation(): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let work: Promise<void>;

  function run() {
    const now = new Date();
    const nextMidnight = istDayStart(addIstDays(istDay(now), 1)).getTime();
    let nextRun = nextMidnight;
    work = seedDemoLeaderboardProfiles(now).catch((err: unknown) => {
      logger.error({ evt: "demo_leaderboard.rotation_error", err }, "demo leaderboard rotation failed");
      nextRun = Math.min(Date.now() + 60_000, nextMidnight);
    }).finally(() => {
      if (!stopped) timer = setTimeout(run, Math.max(0, nextRun - Date.now()));
    });
  }

  run();
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await work;
    },
  };
}
