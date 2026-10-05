import { logger } from "@asm/logger";
import {
  GATEWAY_TATUM,
  expireGatewayDeposit,
  listGatewayDepositsToExpire,
  listGatewayDepositsToWatch,
  prisma,
} from "@asm/db";
import {
  closedDepositIds,
  createGatewayChain,
  isTatumProvider,
  listTatumEnabledNetworks,
  readTatumConfig,
  recheckDetectedCredits,
  releaseDepositAlert,
  scanGatewayDeposit,
  type GatewayChain,
  type TatumNetworkConfig,
} from "@asm/tatum";
import { USDT_LATE_PAYMENT_GRACE_MS, runStage, startAdaptiveWatchLoop } from "./chain-watcher/watch-loop";

const TICK_INTERVAL_MS = Number(process.env["USDT_WATCHER_TICK_INTERVAL_MS"] ?? 15_000);
const IDLE_INTERVAL_MS = Number(process.env["USDT_WATCHER_IDLE_INTERVAL_MS"] ?? 120_000);
/**
 * Addresses whose window closed (plus the late-payment grace) are still
 * scanned so a late payment reaches admin review — but only this often, since
 * every scan is a billed Tatum call.
 */
const STALE_ADDRESS_SCAN_MS = 10 * 60_000;

export interface TatumRunner {
  stop(): Promise<void>;
}

/**
 * The Tatum gateway's poller — the safety net under the webhook, and the only
 * detector when no public webhook URL exists (localhost). Idle (no timer, no
 * network call) unless the provider is "tatum" and at least one network is
 * fully configured; the manual watchers are started instead otherwise.
 *
 * Each full tick: scan watched deposit addresses for incoming transfers,
 * advance not-yet-final credits to FINAL and settle them, then expire
 * deposits past the grace window and release their Tatum alerts.
 */
export function startTatumRunner(): TatumRunner {
  if (!isTatumProvider()) return { stop: async () => {} };
  const configs = new Map<string, TatumNetworkConfig>();
  for (const n of listTatumEnabledNetworks()) {
    const cfg = readTatumConfig(n);
    if (cfg) configs.set(n, cfg);
  }
  if (configs.size === 0) {
    logger.info({ evt: "tatum.runner_idle" }, "Tatum gateway not configured — runner idle");
    return { stop: async () => {} };
  }

  const chains = new Map<string, GatewayChain>([...configs].map(([n, cfg]) => [n, createGatewayChain(cfg)]));
  const lastScanned = new Map<string, number>();
  const log = logger.child({ component: "tatum-runner" });

  async function tick(): Promise<void> {
    const now = new Date();
    const closed: { network: string; depositId: string }[] = [];

    await runStage("tatum", "scan", async () => {
      for (const deposit of await listGatewayDepositsToWatch(now)) {
        const chain = deposit.network ? chains.get(deposit.network) : undefined;
        if (!chain) continue;
        const live =
          (deposit.status === "AWAITING_PAYMENT" || deposit.status === "PENDING_CONFIRMATION") &&
          now.getTime() < deposit.expiresAt.getTime() + USDT_LATE_PAYMENT_GRACE_MS;
        const last = lastScanned.get(deposit.id) ?? 0;
        if (!live && now.getTime() - last < STALE_ADDRESS_SCAN_MS) continue;
        lastScanned.set(deposit.id, now.getTime());
        try {
          await scanGatewayDeposit(chain, deposit, log);
        } catch (err) {
          log.warn({ evt: "tatum.scan_failed", depositId: deposit.id, err: (err as Error).message }, "address scan failed");
        }
      }
    });

    await runStage("tatum", "settle", async () => {
      const settled = await recheckDetectedCredits(chains, log);
      for (const depositId of closedDepositIds(settled)) {
        const d = await prisma.deposit.findUnique({ where: { id: depositId }, select: { network: true } });
        if (d?.network) closed.push({ network: d.network, depositId });
      }
    });

    await runStage("tatum", "expire", async () => {
      for (const deposit of await listGatewayDepositsToExpire(now)) {
        if (await expireGatewayDeposit(deposit.id)) {
          log.info({ evt: "tatum.deposit_expired", depositId: deposit.id }, "gateway deposit expired");
          if (deposit.network) closed.push({ network: deposit.network, depositId: deposit.id });
        }
      }
    });

    for (const { network, depositId } of closed) {
      const cfg = configs.get(network);
      if (cfg) await releaseDepositAlert(cfg, depositId, log);
    }

    // Forget scan timestamps of deposits no longer watched.
    if (lastScanned.size > 2_000) lastScanned.clear();
  }

  const loop = startAdaptiveWatchLoop({
    network: "tatum",
    tickIntervalMs: TICK_INTERVAL_MS,
    idleIntervalMs: IDLE_INTERVAL_MS,
    isActive: async () =>
      (await prisma.deposit.count({
        where: { gateway: GATEWAY_TATUM, status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] } },
      })) > 0,
    tick,
  });

  log.info({ evt: "tatum.runner_started", networks: [...configs.keys()] }, "Tatum gateway runner started");
  return {
    stop: async () => {
      loop.stop();
    },
  };
}
