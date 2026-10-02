import { logger } from "@asm/logger";
import { USDT_RESERVATION_QUARANTINE_MS, expireStaleUsdtDeposits, hasActiveUsdtWork } from "@asm/db";
import { createBscProvider } from "./providers/bsc";
import { runEvmIngestTick } from "./evm-ingest";
import { runEvmFinalityTick } from "./evm-finality";
import { runMatchTick } from "./match";
import { USDT_LATE_PAYMENT_GRACE_MS, runStage, startAdaptiveWatchLoop } from "./watch-loop";
import type { EvmChainProvider } from "./types";
import type { ChainWatcher } from "./runner";

export const BSC_NETWORK = "bsc";
/** Bounds one tick's catch-up: at the default 2000-block range, ~50k blocks (~6h of BSC) per tick. */
const MAX_CHUNKS_PER_TICK = 25;
const DEFAULT_MAX_BLOCK_RANGE = 2000;
const DEFAULT_INITIAL_LOOKBACK_BLOCKS = 2000;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface BscWatcherConfig {
  chainId: 56 | 97;
  rpcUrl: string;
  receivingAddress: string;
  tokenContract: string;
  tokenDecimals: number;
  maxBlockRange: number;
  initialLookbackBlocks: number;
}

/**
 * Resolves the USDT_BSC_* environment. BSC is "configured" only when EVERY
 * required value is present and valid — anything else is a reason to stay
 * fully idle, never a reason to fall back to a default (in particular, never
 * to mainnet).
 */
export function resolveBscConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: BscWatcherConfig } | { ok: false; reason: string } {
  const chainIdRaw = env["USDT_BSC_CHAIN_ID"] ?? "";
  const rpcUrl = env["USDT_BSC_RPC_URL"] ?? "";
  const receiving = env["USDT_BSC_RECEIVING_ADDRESS"] ?? "";
  const contract = env["USDT_BSC_TOKEN_CONTRACT"] ?? "";
  const decimalsRaw = env["USDT_BSC_TOKEN_DECIMALS"] ?? "";

  if (chainIdRaw !== "56" && chainIdRaw !== "97") {
    return { ok: false, reason: `USDT_BSC_CHAIN_ID is ${chainIdRaw ? `invalid ("${chainIdRaw}")` : "unset"} — must be exactly "97" (testnet) or "56" (mainnet)` };
  }
  if (!isHttpsUrl(rpcUrl)) return { ok: false, reason: "USDT_BSC_RPC_URL must be a non-empty https URL" };
  if (!EVM_ADDRESS.test(receiving)) return { ok: false, reason: "USDT_BSC_RECEIVING_ADDRESS must be 0x + 40 hex characters" };
  if (!EVM_ADDRESS.test(contract)) return { ok: false, reason: "USDT_BSC_TOKEN_CONTRACT must be 0x + 40 hex characters" };
  if (!/^\d{1,2}$/.test(decimalsRaw) || Number(decimalsRaw) < 2 || Number(decimalsRaw) > 36) {
    return { ok: false, reason: "USDT_BSC_TOKEN_DECIMALS must be an integer 2..36 (no default)" };
  }

  const maxBlockRange = optionalInt(env["USDT_BSC_MAX_BLOCK_RANGE"], DEFAULT_MAX_BLOCK_RANGE, 1);
  if (maxBlockRange === null) return { ok: false, reason: "USDT_BSC_MAX_BLOCK_RANGE must be a positive integer" };
  const initialLookbackBlocks = optionalInt(env["USDT_BSC_INITIAL_LOOKBACK_BLOCKS"], DEFAULT_INITIAL_LOOKBACK_BLOCKS, 0);
  if (initialLookbackBlocks === null) return { ok: false, reason: "USDT_BSC_INITIAL_LOOKBACK_BLOCKS must be a non-negative integer" };

  return {
    ok: true,
    config: {
      chainId: chainIdRaw === "56" ? 56 : 97,
      rpcUrl,
      receivingAddress: receiving.toLowerCase(),
      tokenContract: contract.toLowerCase(),
      tokenDecimals: Number(decimalsRaw),
      maxBlockRange,
      initialLookbackBlocks,
    },
  };
}

function isHttpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Unset/empty → fallback; set → must be an integer >= min, else null (invalid, stay idle). */
function optionalInt(raw: string | undefined, fallback: number, min: number): number | null {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min ? n : null;
}

/** Only the host is ever logged — a provider URL often carries an API key in its path or query. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid)";
  }
}

/**
 * Starts the USDT-on-BSC watcher next to the TRON one, or does nothing at all
 * when USDT_BSC_* is not fully valid. Stages per tick, after a startup
 * verification (eth_chainId === USDT_BSC_CHAIN_ID and decimals() ===
 * USDT_BSC_TOKEN_DECIMALS, retried every tick until it passes — never
 * proceeding on a mismatch): ingest → finality → expiry sweep → match (the
 * last only with USDT_AUTO_CONFIRM_ENABLED=true).
 */
export async function startBscWatcher(provider?: EvmChainProvider): Promise<ChainWatcher> {
  const resolved = resolveBscConfig();
  if (!resolved.ok) {
    logger.info({ evt: "chain.watcher.idle", network: BSC_NETWORK }, `USDT BSC watcher idle — ${resolved.reason}`);
    return { stop: async () => {} };
  }
  const cfg = resolved.config;

  // Shared with the TRON watcher (same semantics as runner.ts).
  const tickIntervalMs = Number(process.env["USDT_WATCHER_TICK_INTERVAL_MS"] ?? 15_000);
  const idleIntervalMs = Number(process.env["USDT_WATCHER_IDLE_INTERVAL_MS"] ?? 120_000);
  const autoConfirmEnabled = process.env["USDT_AUTO_CONFIRM_ENABLED"] === "true";

  const activeProvider: EvmChainProvider = provider ?? createBscProvider({ rpcUrl: cfg.rpcUrl });

  const scope = { network: BSC_NETWORK, tokenContract: cfg.tokenContract };
  const ingestConfig = {
    network: BSC_NETWORK,
    tokenContract: cfg.tokenContract,
    receivingAddress: cfg.receivingAddress,
    tokenDecimals: cfg.tokenDecimals,
    maxBlockRange: cfg.maxBlockRange,
    initialLookbackBlocks: cfg.initialLookbackBlocks,
    maxChunksPerTick: MAX_CHUNKS_PER_TICK,
  };
  const matchConfig = {
    expectedNetwork: BSC_NETWORK,
    expectedTokenContract: cfg.tokenContract,
    expectedReceivingAddress: cfg.receivingAddress,
  };

  let verified = false;
  // Set when the last ingest stopped on its chunk budget — keeps the loop in
  // fast mode until the backlog is scanned (hasActiveUsdtWork has no notion
  // of an EVM block backlog).
  let catchingUp = false;

  async function verify(): Promise<boolean> {
    try {
      const chainId = await activeProvider.getChainId();
      if (chainId !== cfg.chainId) {
        logger.error(
          { evt: "chain.watcher.chain_id_mismatch", network: BSC_NETWORK, expected: cfg.chainId, actual: chainId },
          "USDT_BSC_RPC_URL answers for a different chain than USDT_BSC_CHAIN_ID — retrying this check every tick, not ingesting",
        );
        return false;
      }
      const decimals = await activeProvider.getTokenDecimals(cfg.tokenContract);
      if (decimals !== cfg.tokenDecimals) {
        logger.error(
          { evt: "chain.watcher.decimals_mismatch", network: BSC_NETWORK, expected: cfg.tokenDecimals, actual: decimals },
          "USDT_BSC_TOKEN_CONTRACT's decimals() disagrees with USDT_BSC_TOKEN_DECIMALS — retrying this check every tick, not ingesting",
        );
        return false;
      }
    } catch (err) {
      logger.error(
        { evt: "chain.watcher.provider_error", network: BSC_NETWORK, op: "startupVerification", reason: err instanceof Error ? err.message : "unknown" },
        "BSC startup verification failed — will retry next tick, not proceeding yet",
      );
      return false;
    }
    logger.info(
      {
        evt: "chain.watcher.started",
        network: BSC_NETWORK,
        chainId: cfg.chainId,
        rpcHost: safeHost(cfg.rpcUrl),
        tokenContract: cfg.tokenContract,
        autoConfirmEnabled,
      },
      "USDT BSC watcher verified its chain id and token contract and started",
    );
    return true;
  }

  async function tick(): Promise<void> {
    if (!verified) {
      verified = await verify();
      if (!verified) return;
    }

    await runStage(BSC_NETWORK, "ingest", async () => {
      const r = await runEvmIngestTick(activeProvider, ingestConfig);
      catchingUp = r.stoppedReason === "chunk_budget";
      if (r.rowsPersisted > 0 || r.rowsSkipped > 0 || r.stoppedReason !== "caught_up") {
        logger.info(
          {
            evt: "chain.watcher.tick",
            network: BSC_NETWORK,
            stage: "ingest",
            ...r,
            scannedTo: r.scannedTo?.toString() ?? null,
            cursorBlock: r.cursorBlock?.toString() ?? null,
          },
          "BSC ingest tick complete",
        );
      }
    });

    await runStage(BSC_NETWORK, "finality", async () => {
      const r = await runEvmFinalityTick(activeProvider, scope);
      if (r.checked > 0) logger.info({ evt: "chain.watcher.tick", network: BSC_NETWORK, stage: "finality", ...r }, "BSC finality tick complete");
    });

    // Only frees reservations 48h after their window closed — never credits
    // or rejects anything, so it runs regardless of the auto-confirm gate.
    await runStage(BSC_NETWORK, "expiry", async () => {
      const expired = await expireStaleUsdtDeposits(new Date(Date.now() - USDT_RESERVATION_QUARANTINE_MS));
      if (expired > 0) logger.info({ evt: "chain.watcher.tick", network: BSC_NETWORK, stage: "expiry", expired }, "stale USDT deposits marked EXPIRED");
    });

    if (autoConfirmEnabled) {
      await runStage(BSC_NETWORK, "match", async () => {
        const r = await runMatchTick(matchConfig);
        if (r.checked > 0) logger.info({ evt: "chain.watcher.tick", network: BSC_NETWORK, stage: "match", ...r }, "BSC match tick complete");
      });
    }
  }

  const loop = startAdaptiveWatchLoop({
    network: BSC_NETWORK,
    tickIntervalMs,
    idleIntervalMs,
    isActive: async (now) =>
      catchingUp ||
      (await hasActiveUsdtWork({
        network: BSC_NETWORK,
        tokenContract: cfg.tokenContract,
        receivingAddress: cfg.receivingAddress,
        now,
        lateGraceMs: USDT_LATE_PAYMENT_GRACE_MS,
        includePendingMatches: autoConfirmEnabled,
      })),
    tick,
  });

  return {
    async stop(): Promise<void> {
      loop.stop();
      logger.info({ evt: "chain.watcher.stopped", network: BSC_NETWORK }, "USDT BSC watcher stopped");
    },
  };
}
