import { advanceSessionPage, closeSession, createChainCreditIfNew, ensureSessionOpen, prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { ChainProvider, RawTrc20Row } from "./types";

export interface IngestConfig {
  network: string;
  tokenContract: string;
  receivingAddress: string;
  /** Safety margin re-scanned on every new session — absorbs any ordering/clock slop right at the committed floor. Re-observing an already-persisted transfer here is a guaranteed no-op (see chain-credit.ts's unique constraint). */
  overlapMs: number;
  /** Bounds how much of a long-idle catch-up one tick attempts; an unfinished session simply continues next tick from its persisted fingerprint. */
  maxPagesPerTick: number;
}

export type IngestStoppedReason =
  | "session_closed" // the whole [min,max] window fully drained this tick
  | "page_budget" // more pages remain; next tick resumes from the persisted fingerprint
  | "provider_error" // fetchTransferPage failed — checkpoint untouched, retried next tick
  | "lost_race"; // a concurrent watcher instance advanced this cursor first — safe no-op

export interface IngestResult {
  pagesFetched: number;
  rowsPersisted: number;
  rowsSkipped: number;
  stoppedReason: IngestStoppedReason;
}

/**
 * One ingestion tick: resumes or opens a pagination session (ChainScanCursor),
 * walks pages from the provider, resolves each transfer's authoritative event
 * index, and persists ChainCredit rows. The cursor only ever advances (either
 * the fingerprint mid-session, or lastCommittedTimestampMs on session close)
 * after the corresponding data is durably persisted — see chain-scan-cursor.ts
 * for exactly how that invariant is enforced at the database level.
 *
 * Never throws on a provider failure — logs and returns "provider_error" so
 * the runner's timer loop keeps going; the checkpoint is left exactly where
 * it was, so the next tick safely retries the same page.
 */
export async function runIngestTick(
  provider: ChainProvider,
  config: IngestConfig,
  nowMs: number = Date.now(),
): Promise<IngestResult> {
  const key = { network: config.network, tokenContract: config.tokenContract, receivingAddress: config.receivingAddress };
  let cursor = await ensureSessionOpen(key, { overlapMs: config.overlapMs, nowMs });

  let rowsPersisted = 0;
  let rowsSkipped = 0;
  let pagesFetched = 0;

  for (; pagesFetched < config.maxPagesPerTick; pagesFetched++) {
    let page;
    try {
      page = await provider.fetchTransferPage({
        receivingAddress: config.receivingAddress,
        tokenContract: config.tokenContract,
        minTimestampMs: Number(cursor.activeSessionMinTimestampMs),
        maxTimestampMs: Number(cursor.activeSessionMaxTimestampMs),
        fingerprint: cursor.activeSessionFingerprint,
      });
    } catch (err) {
      logger.warn(
        {
          evt: "chain.watcher.provider_error",
          op: "ingest.fetchTransferPage",
          reason: err instanceof Error ? err.message : "unknown",
        },
        "ingestion page fetch failed — checkpoint left unchanged, retrying next tick",
      );
      return { pagesFetched, rowsPersisted, rowsSkipped, stoppedReason: "provider_error" };
    }

    for (const row of page.rows) {
      const persisted = await persistRow(provider, config, row);
      if (persisted) rowsPersisted++;
      else rowsSkipped++;
    }

    if (page.nextFingerprint) {
      const advanced = await advanceSessionPage(key, {
        expectedVersion: cursor.version,
        nextFingerprint: page.nextFingerprint,
      });
      if (!advanced) {
        logger.info(
          { evt: "chain.watcher.checkpoint_race", stage: "ingest" },
          "lost the cursor race to a concurrent watcher instance — stopping this tick",
        );
        return { pagesFetched: pagesFetched + 1, rowsPersisted, rowsSkipped, stoppedReason: "lost_race" };
      }
      cursor = { ...cursor, activeSessionFingerprint: page.nextFingerprint, version: cursor.version + 1 };
      continue;
    }

    const sessionMax = cursor.activeSessionMaxTimestampMs;
    if (sessionMax === null) {
      // Should be unreachable — a session in progress always has this set —
      // but never guessed at: treat it as a lost race rather than inventing a value.
      return { pagesFetched: pagesFetched + 1, rowsPersisted, rowsSkipped, stoppedReason: "lost_race" };
    }
    const closed = await closeSession(key, { expectedVersion: cursor.version, sessionMaxTimestampMs: sessionMax });
    if (!closed) {
      return { pagesFetched: pagesFetched + 1, rowsPersisted, rowsSkipped, stoppedReason: "lost_race" };
    }
    logger.info(
      { evt: "chain.watcher.checkpoint_advanced", lastCommittedTimestampMs: sessionMax.toString() },
      "ingestion session fully drained — checkpoint advanced",
    );
    return { pagesFetched: pagesFetched + 1, rowsPersisted, rowsSkipped, stoppedReason: "session_closed" };
  }

  return { pagesFetched, rowsPersisted, rowsSkipped, stoppedReason: "page_budget" };
}

/**
 * Resolves and persists one discovered transfer. Returns false (not an
 * error) for anything that can't yet be turned into a usable ChainCredit row
 * — a transient event-index inconsistency, an unparseable amount, or a
 * wrong-contract row that slipped through the listing filter — all of which
 * are logged and left to the next tick's overlap re-scan rather than
 * guessed at.
 */
async function persistRow(provider: ChainProvider, config: IngestConfig, row: RawTrc20Row): Promise<boolean> {
  // TronGrid's own contract_address/only_to filters should already guarantee
  // both of these; re-verified rather than trusted, per the design doc's
  // "never trust previously stored/returned provider data alone" rule.
  if (row.tokenContract !== config.tokenContract) {
    logger.warn(
      { evt: "chain.credit.wrong_token_contract_at_ingest", txHash: row.transactionId, got: row.tokenContract },
      "discovery returned a row for an unexpected token contract — skipped",
    );
    return false;
  }
  if (row.toAddress !== config.receivingAddress) {
    logger.warn(
      { evt: "chain.credit.wrong_destination_at_ingest", txHash: row.transactionId, got: row.toAddress },
      "discovery returned a row for an unexpected destination address — skipped",
    );
    return false;
  }

  let rawAmount: bigint;
  try {
    rawAmount = BigInt(row.rawValue);
  } catch {
    logger.warn(
      { evt: "chain.credit.malformed_row", reason: "non-integer rawValue", txHash: row.transactionId },
      "skipping a row whose value is not an integer",
    );
    return false;
  }

  const resolution = await provider.resolveTransferEvent({
    txHash: row.transactionId,
    expectedToAddress: config.receivingAddress,
    expectedTokenContract: config.tokenContract,
    expectedRawAmount: rawAmount,
  });

  const basePayload = { ...row, rawAmount: row.rawValue };

  if (resolution.kind === "not_found" || resolution.kind === "provider_error") {
    // Never defaulted to eventIndex 0 — this transfer is simply not
    // persisted yet. The next session's overlap window re-observes the same
    // discovery row and tries again.
    logger.info(
      { evt: "chain.credit.event_resolution_pending", txHash: row.transactionId, kind: resolution.kind },
      "event index not yet resolvable — will retry on the next overlap re-scan",
    );
    return false;
  }

  if (resolution.kind === "ambiguous") {
    // Genuinely ambiguous at the event level — more than one Transfer event
    // in this transaction matches (contract, to, value). Persist ONE
    // ChainCredit row per candidate index (each a real, distinct on-chain
    // event) and flag all of them for manual review; none becomes eligible
    // for automatic matching. See the design doc's event-identity section.
    let anyPersisted = false;
    for (const eventIndex of resolution.candidateEventIndexes) {
      const created = await createChainCreditIfNew({
        network: config.network,
        tokenContract: config.tokenContract,
        txHash: row.transactionId,
        eventIndex,
        fromAddress: row.fromAddress,
        toAddress: row.toAddress,
        rawAmount,
        blockNumber: 0n, // unknown at this branch — the events call didn't resolve a single winner
        blockTimestamp: new Date(row.blockTimestampMs),
        rawPayload: basePayload,
      });
      if (created) {
        anyPersisted = true;
        await markAmbiguousEvent(created.id);
      }
    }
    return anyPersisted;
  }

  const created = await createChainCreditIfNew({
    network: config.network,
    tokenContract: config.tokenContract,
    txHash: row.transactionId,
    eventIndex: resolution.eventIndex,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    rawAmount,
    blockNumber: resolution.blockNumber,
    blockTimestamp: new Date(row.blockTimestampMs),
    rawPayload: basePayload,
  });
  return created !== null;
}

/**
 * Flags a just-created ambiguous-event row for manual review. A small,
 * local, guarded follow-up update — deliberately not a change to
 * createChainCreditIfNew's own signature (packages/db, Phase 2), since the
 * only thing needed here is the same idempotent status-guard idiom already
 * used throughout this codebase.
 */
async function markAmbiguousEvent(chainCreditId: string): Promise<void> {
  await prisma.chainCredit.updateMany({
    where: { id: chainCreditId, processingStatus: "PENDING" },
    data: { processingStatus: "MANUAL_REVIEW", reviewReason: "AMBIGUOUS_EVENT_WITHIN_TRANSACTION" },
  });
}
