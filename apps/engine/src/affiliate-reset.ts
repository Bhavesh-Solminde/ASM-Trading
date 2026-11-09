import {
  istDateOf,
  listAffiliateAccountsNeedingReset,
  prisma,
  resetAffiliateAccountFloat,
  type DbClient,
} from "@asm/db";
import { logger } from "@asm/logger";

export async function resetAffiliateFloats(client: DbClient = prisma) {
  const nowIstDate = istDateOf(new Date());
  const ids = await listAffiliateAccountsNeedingReset({ nowIstDate }, client);
  for (const accountId of ids) {
    try {
      await resetAffiliateAccountFloat({ accountId, nowIstDate }, client);
    } catch (error) {
      logger.error({ evt: "affiliate.reset_failed", accountId, reason: String(error) }, "Affiliate reset will retry");
    }
  }
}

/** Account maintenance stays outside the market worker and never submits orders. */
export function startAffiliateResetRunner(client: DbClient = prisma) {
  let stopping = false;
  let task: Promise<void> | null = null;
  const run = () => {
    if (stopping || task) return;
    task = resetAffiliateFloats(client)
      .catch(error => logger.error({ evt: "affiliate.reset_scan_failed", reason: String(error) }, "Affiliate reset scan will retry"))
      .finally(() => { task = null; });
  };
  const timer = setInterval(run, 60_000);
  timer.unref();
  run();
  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await task;
    },
  };
}
