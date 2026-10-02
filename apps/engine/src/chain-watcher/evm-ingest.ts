import { advanceEvmCursor, createChainCreditIfNew, getOrCreateEvmCursor } from "@asm/db";
import { logger } from "@asm/logger";
import type { EvmChainProvider, EvmTransferLog } from "./types";

export interface EvmIngestConfig {
  network: string;
  /** Lowercase 0x address. */
  tokenContract: string;
  /** Lowercase 0x address. */
  receivingAddress: string;
  /** Verified against the contract's decimals() at watcher startup. */
  tokenDecimals: number;
  /** Max blocks per eth_getLogs request (inclusive range size). */
  maxBlockRange: number;
  /** Where the very first scan starts: latest - this. */
  initialLookbackBlocks: number;
  /** Bounds a long catch-up; the rest continues next tick from the persisted cursor. */
  maxChunksPerTick: number;
}

export type EvmIngestStoppedReason =
  | "caught_up" // scanned through the latest block
  | "chunk_budget" // more blocks remain; the next tick continues from the cursor
  | "provider_error" // a chunk failed — cursor never advanced past it
  | "lost_race"; // a concurrent watcher instance moved the cursor first — safe no-op

export interface EvmIngestResult {
  chunksScanned: number;
  logsSeen: number;
  rowsPersisted: number;
  rowsSkipped: number;
  /** Highest block whose logs were fully processed this tick (null if none). */
  scannedTo: bigint | null;
  /** The durable cursor after this tick (only ever <= the finalized block). */
  cursorBlock: bigint | null;
  stoppedReason: EvmIngestStoppedReason;
}

/**
 * One EVM ingestion tick. Scans [cursor.lastScannedBlock + 1, latest] in
 * chunks of `maxBlockRange`, persists one ChainCredit per Transfer log
 * (idempotent via the unique (network, tokenContract, txHash, eventIndex)
 * key), then advances the durable cursor ONLY to min(scannedTo, finalized).
 * The not-yet-finalized tail is therefore re-scanned every tick, so a reorg
 * that moves a transfer to a different block/log index is still discovered
 * (the stale row is caught as REORGED by evm-finality).
 *
 * Never throws on a provider failure — returns "provider_error" with the
 * cursor at most advanced over the chunks that fully succeeded before it.
 */
export async function runEvmIngestTick(provider: EvmChainProvider, config: EvmIngestConfig): Promise<EvmIngestResult> {
  const result: EvmIngestResult = {
    chunksScanned: 0,
    logsSeen: 0,
    rowsPersisted: 0,
    rowsSkipped: 0,
    scannedTo: null,
    cursorBlock: null,
    stoppedReason: "caught_up",
  };

  let latest: bigint;
  let finalized: bigint;
  try {
    latest = await provider.getLatestBlockNumber();
    finalized = await provider.getFinalizedBlockNumber();
  } catch (err) {
    logProviderError(config.network, "ingest.blockHeads", err);
    return { ...result, stoppedReason: "provider_error" };
  }
  // A load-balanced RPC can answer the two calls from nodes at slightly
  // different heights — never treat anything past `latest` as finalized.
  if (finalized > latest) finalized = latest;

  const key = { network: config.network, tokenContract: config.tokenContract, receivingAddress: config.receivingAddress };
  const lookback = BigInt(config.initialLookbackBlocks);
  const initialBlock = latest > lookback ? latest - lookback : 0n;
  const cursor = await getOrCreateEvmCursor(key, initialBlock);
  if (cursor.lastScannedBlock === null) {
    // Should be unreachable for an EVM cursor — never guessed at.
    logger.error({ evt: "chain.watcher.cursor_invalid", network: config.network }, "EVM cursor has no lastScannedBlock — not scanning");
    return { ...result, stoppedReason: "lost_race" };
  }
  result.cursorBlock = cursor.lastScannedBlock;

  const range = BigInt(config.maxBlockRange);
  const timestampCache = new Map<bigint, number>();
  let from = cursor.lastScannedBlock + 1n;

  while (from <= latest) {
    if (result.chunksScanned >= config.maxChunksPerTick) {
      result.stoppedReason = "chunk_budget";
      break;
    }
    const to = from + range - 1n < latest ? from + range - 1n : latest;

    try {
      const logs = await provider.getTransferLogs({
        tokenContract: config.tokenContract,
        toAddress: config.receivingAddress,
        fromBlock: from,
        toBlock: to,
      });
      result.logsSeen += logs.length;
      for (const log of logs) {
        if (await persistLog(provider, config, log, timestampCache)) result.rowsPersisted++;
        else result.rowsSkipped++;
      }
    } catch (err) {
      logProviderError(config.network, "ingest.chunk", err, { fromBlock: from.toString(), toBlock: to.toString() });
      result.stoppedReason = "provider_error";
      break;
    }

    result.chunksScanned++;
    result.scannedTo = to;
    from = to + 1n;
  }

  if (result.scannedTo !== null) {
    const target = result.scannedTo < finalized ? result.scannedTo : finalized;
    if (target > cursor.lastScannedBlock) {
      const advanced = await advanceEvmCursor(key, cursor.version, target);
      if (!advanced) {
        logger.info(
          { evt: "chain.watcher.checkpoint_race", network: config.network, stage: "ingest" },
          "lost the EVM cursor race to a concurrent watcher instance — its scan is just as valid",
        );
        return { ...result, stoppedReason: "lost_race" };
      }
      result.cursorBlock = target;
    }
  }

  return result;
}

/**
 * Persists one Transfer log. Returns false (not an error) for a log that is
 * deliberately not persisted. Throws on a provider failure (block timestamp),
 * which fails the whole chunk so the cursor never moves past it.
 */
async function persistLog(
  provider: EvmChainProvider,
  config: EvmIngestConfig,
  log: EvmTransferLog,
  timestampCache: Map<bigint, number>,
): Promise<boolean> {
  if (log.removed) {
    // Belonged to a block that was reorged out. The transfer (if re-mined)
    // shows up again as a separate, non-removed log on a later re-scan.
    logger.info({ evt: "chain.credit.removed_log_skipped", network: config.network, txHash: log.txHash }, "skipping a removed (reorged-out) log");
    return false;
  }
  // The eth_getLogs topic filter should already guarantee this; re-verified rather than trusted.
  if (log.toAddress !== config.receivingAddress) {
    logger.warn(
      { evt: "chain.credit.wrong_destination_at_ingest", network: config.network, txHash: log.txHash, got: log.toAddress },
      "eth_getLogs returned a log for an unexpected destination address — skipped",
    );
    return false;
  }
  if (log.rawValue === 0n) {
    // A zero-value Transfer moves no money — on BSC these are overwhelmingly
    // address-poisoning spam. Persisting them would only flood manual review.
    logger.info({ evt: "chain.credit.zero_value_skipped", network: config.network, txHash: log.txHash }, "skipping a zero-value transfer");
    return false;
  }

  let timestampMs = timestampCache.get(log.blockNumber);
  if (timestampMs === undefined) {
    timestampMs = await provider.getBlockTimestampMs(log.blockNumber);
    timestampCache.set(log.blockNumber, timestampMs);
  }

  // A value with sub-cent precision still gets persisted: createChainCreditIfNew
  // stores a null normalized amount and routes the row to manual review.
  const created = await createChainCreditIfNew({
    network: config.network,
    tokenContract: config.tokenContract,
    txHash: log.txHash,
    eventIndex: log.logIndex,
    fromAddress: log.fromAddress,
    toAddress: log.toAddress,
    rawAmount: log.rawValue,
    tokenDecimals: config.tokenDecimals,
    blockNumber: log.blockNumber,
    blockTimestamp: new Date(timestampMs),
    // JSON-safe evidence (bigint is not JSON-serializable).
    rawPayload: {
      txHash: log.txHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber.toString(),
      fromAddress: log.fromAddress,
      toAddress: log.toAddress,
      rawValue: log.rawValue.toString(),
      blockTimestampMs: timestampMs,
    },
  });
  return created !== null;
}

function logProviderError(network: string, op: string, err: unknown, extra: Record<string, unknown> = {}): void {
  logger.warn(
    { evt: "chain.watcher.provider_error", network, op, ...extra, reason: err instanceof Error ? err.message : "unknown" },
    "EVM ingestion call failed — cursor not advanced past it, retrying next tick",
  );
}
