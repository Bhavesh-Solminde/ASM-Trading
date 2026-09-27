import { logger } from "@asm/logger";
import { USDT_RESERVATION_QUARANTINE_MS, expireStaleUsdtDeposits, hasActiveUsdtWork } from "@asm/db";
import { createTronProvider } from "./providers/tron";
import { runIngestTick } from "./ingest";
import { runFinalityTick } from "./finality";
import { runMatchTick } from "./match";
import type { ChainProvider } from "./types";

// Read directly via process.env, not piped through @asm/config's strict
// shared schema — same precedent as SMS_RELAY_SECRET/ADMIN_PANEL_SECRET
// (see .env.example), since these are specific to this one feature.
const USDT_NETWORK = process.env["USDT_NETWORK"] ?? "";
const USDT_TRONGRID_NETWORK = process.env["USDT_TRONGRID_NETWORK"] ?? "";
const USDT_RECEIVING_ADDRESS = process.env["USDT_RECEIVING_ADDRESS"] ?? "";
const USDT_TOKEN_CONTRACT = process.env["USDT_TOKEN_CONTRACT"] ?? "";
const USDT_TRONGRID_API_KEY = process.env["USDT_TRONGRID_API_KEY"];

/**
 * Fixed, verified TronGrid hosts — never a URL built from user input.
 * Verified against developers.tron.network/docs/networks (fetched directly
 * before adding this): mainnet's "HTTP API (TronGrid)" row is
 * https://api.trongrid.io (already this provider's own prior hardcoded
 * default); Nile's "HTTP API (TronGrid)" row is https://nile.trongrid.io —
 * the TronGrid-branded Nile host, not the separate community nileex.io
 * endpoint, for consistency with how the mainnet host is named. Shasta is
 * deliberately not offered — nothing in this implementation requires it.
 */
const TRONGRID_HOSTS = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
} as const;
export type TronGridNetwork = keyof typeof TRONGRID_HOSTS;

/**
 * Resolves USDT_TRONGRID_NETWORK to one of the two fixed hosts above by
 * exact-match lookup only — never string interpolation, never a
 * user-supplied URL. Returns null for anything other than exactly "mainnet"
 * or "nile", including unset/empty/misspelled. The caller MUST treat null as
 * "stay idle," never as "fall back to mainnet" — an unset or invalid value
 * must never be able to silently end up pointed at real mainnet funds.
 */
export function resolveTronGridFullHost(network: string): string | null {
  if (network === "mainnet" || network === "nile") return TRONGRID_HOSTS[network];
  return null;
}
const USDT_TICK_INTERVAL_MS = Number(process.env["USDT_WATCHER_TICK_INTERVAL_MS"] ?? 15_000);
// Adaptive pacing: the watcher wakes every USDT_TICK_INTERVAL_MS but only runs
// a full (TronGrid-calling) tick when hasActiveUsdtWork says someone is
// depositing / a transfer is confirming — otherwise at most once per idle
// interval, which still guarantees late or unexpected payments are found.
const USDT_IDLE_INTERVAL_MS = Number(process.env["USDT_WATCHER_IDLE_INTERVAL_MS"] ?? 120_000);
// How long after a deposit's window closes it still counts as "active" —
// exchange withdrawals and slow wallets routinely land a few minutes late.
const USDT_LATE_PAYMENT_GRACE_MS = 15 * 60_000;
const USDT_OVERLAP_MS = Number(process.env["USDT_OVERLAP_MS"] ?? 600_000);
const USDT_MAX_PAGES_PER_TICK = Number(process.env["USDT_MAX_PAGES_PER_TICK"] ?? 50);
// The production-activation safety gate: ingestion and finality always run
// once configured (they only ever read chain state), but the match/credit
// stage — the only stage that can move money — requires this explicit,
// separate opt-in. Defaults to disabled. This is what "the watcher must not
// automatically run against mainnet production funds merely because it
// exists" means concretely: even a fully-configured, running watcher never
// credits anything until an operator sets this.
const USDT_AUTO_CONFIRM_ENABLED = process.env["USDT_AUTO_CONFIRM_ENABLED"] === "true";
// TRC-20 USDT's own canonical decimals — cross-checked against the live
// contract at getTokenDecimals() time, never assumed.
const EXPECTED_USDT_DECIMALS = 6;

export interface ChainWatcher {
  stop(): Promise<void>;
}

/**
 * Starts the USDT chain watcher, or does nothing at all — mirrors
 * startBankFeedRunner()'s own "idle unless configured" shape exactly. With
 * no USDT_NETWORK/USDT_RECEIVING_ADDRESS/USDT_TOKEN_CONTRACT set (the current
 * state of this deployment — no real TronGrid credentials or receiving
 * address exist yet), this is a genuine no-op: no timer is scheduled, no
 * network call is ever made. Wiring this into main.ts is therefore safe
 * today regardless of the production-activation question.
 */
export async function startChainWatcher(provider?: ChainProvider): Promise<ChainWatcher> {
  // Resolved before anything else: an unset or invalid USDT_TRONGRID_NETWORK
  // must gate the watcher idle exactly like a missing receiving
  // address/contract does — never fall back to a default host. Deliberately
  // computed even when a `provider` was passed explicitly (e.g. in tests),
  // so the idle/active decision itself doesn't depend on whether a caller
  // happened to inject a stub.
  const tronGridFullHost = resolveTronGridFullHost(USDT_TRONGRID_NETWORK);

  if (USDT_NETWORK !== "tron" || !USDT_RECEIVING_ADDRESS || !USDT_TOKEN_CONTRACT || !tronGridFullHost) {
    const reason = !tronGridFullHost
      ? `USDT_TRONGRID_NETWORK is ${USDT_TRONGRID_NETWORK ? `invalid ("${USDT_TRONGRID_NETWORK}")` : "unset"} — must be exactly "mainnet" or "nile"; refusing to guess a host rather than risk silently using mainnet`
      : "not configured (only 'tron' is implemented; USDT_RECEIVING_ADDRESS/USDT_TOKEN_CONTRACT required)";
    logger.info(
      {
        evt: "chain.watcher.idle",
        network: USDT_NETWORK || "(unset)",
        trongridNetwork: USDT_TRONGRID_NETWORK || "(unset)",
      },
      `USDT chain watcher idle — ${reason}`,
    );
    return { stop: async () => {} };
  }

  // Only constructed once we know the watcher is actually going to run —
  // never eagerly built (and never pointed at a host) while still deciding
  // whether to stay idle. A separate `const` (rather than reassigning the
  // `provider` parameter) so TypeScript can narrow it to non-undefined for
  // the tick() closure defined below, which captures it.
  const activeProvider: ChainProvider =
    provider ??
    createTronProvider({
      ...(USDT_TRONGRID_API_KEY ? { apiKey: USDT_TRONGRID_API_KEY } : {}),
      fullHost: tronGridFullHost,
    });

  const matchConfig = {
    expectedNetwork: USDT_NETWORK,
    expectedTokenContract: USDT_TOKEN_CONTRACT,
    expectedReceivingAddress: USDT_RECEIVING_ADDRESS,
  };
  const ingestConfig = {
    network: USDT_NETWORK,
    tokenContract: USDT_TOKEN_CONTRACT,
    receivingAddress: USDT_RECEIVING_ADDRESS,
    overlapMs: USDT_OVERLAP_MS,
    maxPagesPerTick: USDT_MAX_PAGES_PER_TICK,
  };

  let decimalsVerified = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    if (!decimalsVerified) {
      try {
        const decimals = await activeProvider.getTokenDecimals(USDT_TOKEN_CONTRACT);
        if (decimals !== EXPECTED_USDT_DECIMALS) {
          logger.error(
            { evt: "chain.watcher.decimals_mismatch", expected: EXPECTED_USDT_DECIMALS, actual: decimals },
            "configured USDT_TOKEN_CONTRACT's decimals() disagrees with canonical USDT-TRC20 — watcher will keep retrying this check, not proceeding to ingest/finality/match until it's fixed",
          );
          return;
        }
        decimalsVerified = true;
        logger.info(
          {
            evt: "chain.watcher.started",
            network: USDT_NETWORK,
            trongridNetwork: USDT_TRONGRID_NETWORK,
            fullHost: tronGridFullHost,
            autoConfirmEnabled: USDT_AUTO_CONFIRM_ENABLED,
          },
          "USDT chain watcher verified its token contract and started",
        );
      } catch (err) {
        logger.error(
          { evt: "chain.watcher.provider_error", op: "getTokenDecimals", reason: err instanceof Error ? err.message : "unknown" },
          "startup decimals check failed — will retry next tick, not proceeding yet",
        );
        return;
      }
    }

    try {
      const ingestResult = await runIngestTick(activeProvider, ingestConfig);
      if (ingestResult.rowsSkipped > 0 || ingestResult.stoppedReason === "provider_error") {
        logger.info({ evt: "chain.watcher.tick", stage: "ingest", ...ingestResult }, "ingest tick complete");
      }
    } catch (err) {
      // Never let one stage's unexpected failure kill the whole tick, let
      // alone the timer loop — the next tick is still scheduled regardless.
      logger.error({ evt: "chain.watcher.tick_error", stage: "ingest", reason: err instanceof Error ? err.message : "unknown" }, "ingest tick threw");
    }

    try {
      const finalityResult = await runFinalityTick(activeProvider);
      if (finalityResult.checked > 0) {
        logger.info({ evt: "chain.watcher.tick", stage: "finality", ...finalityResult }, "finality tick complete");
      }
    } catch (err) {
      logger.error({ evt: "chain.watcher.tick_error", stage: "finality", reason: err instanceof Error ? err.message : "unknown" }, "finality tick threw");
    }

    // Only frees a reserved amount 48h after its window closed — never credits
    // or rejects anything, so it runs regardless of the auto-confirm gate.
    try {
      const expired = await expireStaleUsdtDeposits(new Date(Date.now() - USDT_RESERVATION_QUARANTINE_MS));
      if (expired > 0) {
        logger.info({ evt: "chain.watcher.tick", stage: "expiry", expired }, "stale USDT deposits marked EXPIRED");
      }
    } catch (err) {
      logger.error({ evt: "chain.watcher.tick_error", stage: "expiry", reason: err instanceof Error ? err.message : "unknown" }, "expiry sweep threw");
    }

    if (USDT_AUTO_CONFIRM_ENABLED) {
      try {
        const matchResult = await runMatchTick(matchConfig);
        if (matchResult.checked > 0) {
          logger.info({ evt: "chain.watcher.tick", stage: "match", ...matchResult }, "match tick complete");
        }
      } catch (err) {
        logger.error({ evt: "chain.watcher.tick_error", stage: "match", reason: err instanceof Error ? err.message : "unknown" }, "match tick threw");
      }
    }
  }

  let lastFullTickAt = 0;
  let mode: "active" | "idle" | null = null;

  async function wake(): Promise<void> {
    const now = Date.now();
    // Fail toward doing the work: if the cheap DB check itself errors, run the
    // full tick rather than risk silently skipping detection.
    let active = true;
    try {
      active = await hasActiveUsdtWork({
        network: USDT_NETWORK,
        tokenContract: USDT_TOKEN_CONTRACT,
        receivingAddress: USDT_RECEIVING_ADDRESS,
        now: new Date(now),
        lateGraceMs: USDT_LATE_PAYMENT_GRACE_MS,
        includePendingMatches: USDT_AUTO_CONFIRM_ENABLED,
      });
    } catch (err) {
      logger.error(
        { evt: "chain.watcher.tick_error", stage: "activity_check", reason: err instanceof Error ? err.message : "unknown" },
        "activity check failed — running a full tick anyway",
      );
    }

    const nextMode = active ? "active" : "idle";
    if (nextMode !== mode) {
      mode = nextMode;
      logger.info(
        { evt: "chain.watcher.mode", mode, intervalMs: active ? USDT_TICK_INTERVAL_MS : USDT_IDLE_INTERVAL_MS },
        active ? "USDT watcher: deposit activity — checking the chain every tick" : "USDT watcher: no deposit activity — slowing down",
      );
    }

    if (!active && now - lastFullTickAt < USDT_IDLE_INTERVAL_MS) return;
    lastFullTickAt = now;
    await tick();
  }

  // Self-rescheduling via setTimeout (never setInterval), and the next timer
  // is only ever armed after the current wake's promise settles — this is
  // both "one execution cannot overlap another" (in-process) and "no
  // uncontrolled tight loop" in one mechanism, same shape as
  // bank-feed/simulated.ts's existing schedule().
  const schedule = (): void => {
    timer = setTimeout(() => {
      void wake()
        .catch((err: unknown) => {
          logger.error(
            { evt: "chain.watcher.tick_error", stage: "unknown", reason: err instanceof Error ? err.message : "unknown" },
            "chain watcher tick failed unexpectedly",
          );
        })
        .finally(() => {
          if (!stopped) schedule();
        });
    }, USDT_TICK_INTERVAL_MS);
  };
  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // Deliberately does not await an in-flight tick — its own DB
      // transactions are already atomic and safe to leave running to
      // completion; the process shutdown sequence elsewhere (main.ts)
      // disconnects prisma only after every stop() has been awaited, which
      // in practice gives the in-flight tick time to finish. Mirrors
      // bank-feed's own stop() semantics (no in-flight-tick join there either).
      logger.info({ evt: "chain.watcher.stopped" }, "USDT chain watcher stopped");
    },
  };
}
