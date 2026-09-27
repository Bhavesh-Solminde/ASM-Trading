import { prisma } from "../client";
import type { ChainScanCursor } from "../../generated/prisma/client";

type CursorKey = { network: string; tokenContract: string; receivingAddress: string };

function whereKey(key: CursorKey) {
  return {
    network_tokenContract_receivingAddress: {
      network: key.network,
      tokenContract: key.tokenContract,
      receivingAddress: key.receivingAddress,
    },
  };
}

/**
 * Reads the durable pagination cursor for one (network, tokenContract,
 * receivingAddress), creating it (at `initialTimestampMs`) if this is the
 * watcher's first-ever run for that key. `version` is the same
 * optimistic-concurrency idiom Account.version already uses elsewhere in
 * this codebase — every mutation below is guarded by it, so two concurrent
 * watcher instances racing the same cursor row resolve to "one proceeds, one
 * safely no-ops," never a corrupted/lost update.
 */
export async function getOrCreateCursor(
  key: CursorKey,
  initialTimestampMs: number,
): Promise<ChainScanCursor> {
  const existing = await prisma.chainScanCursor.findUnique({ where: whereKey(key) });
  if (existing) return existing;

  try {
    return await prisma.chainScanCursor.create({
      data: { ...key, lastCommittedTimestampMs: BigInt(initialTimestampMs) },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      // Lost a creation race to a concurrent watcher instance — its row is
      // just as valid as the one this call would have created.
      return await prisma.chainScanCursor.findUniqueOrThrow({ where: whereKey(key) });
    }
    throw err;
  }
}

/**
 * Opens a new pagination session if none is in progress. If a session is
 * already open (this call's own earlier attempt this tick, an interrupted
 * previous tick, or a concurrent instance), this is a no-op — the caller
 * resumes the EXISTING session's exact bounds/fingerprint, which is the
 * mechanism that makes resumption after a crash safe regardless of which
 * records share a block_timestamp (see the design doc's pagination section).
 *
 * Returns the current cursor row either way (freshly opened, already open,
 * or lost the race to open one — always the latest DB state).
 */
export async function ensureSessionOpen(
  key: CursorKey,
  params: { overlapMs: number; nowMs: number },
): Promise<ChainScanCursor> {
  const cursor = await getOrCreateCursor(key, params.nowMs);
  if (cursor.activeSessionMinTimestampMs !== null) return cursor;

  const sessionMin = cursor.lastCommittedTimestampMs - BigInt(params.overlapMs);
  const sessionMax = BigInt(params.nowMs);

  await prisma.chainScanCursor.updateMany({
    where: { ...key, version: cursor.version, activeSessionMinTimestampMs: null },
    data: {
      activeSessionMinTimestampMs: sessionMin < 0n ? 0n : sessionMin,
      activeSessionMaxTimestampMs: sessionMax,
      activeSessionFingerprint: null,
      version: { increment: 1 },
    },
  });

  // Whether this call won the race or lost it to a concurrent opener, a
  // fresh read reflects whichever session is now actually in progress —
  // resuming that (rather than the locally-computed sessionMin/Max above) is
  // what makes a lost race safe rather than a silent divergence.
  return prisma.chainScanCursor.findUniqueOrThrow({ where: whereKey(key) });
}

/**
 * Advances an in-progress session to the next page's fingerprint. Guarded by
 * `expectedVersion` — the caller must have just read the cursor (or received
 * it from ensureSessionOpen/a prior advanceSessionPage) to know the version
 * it's advancing from. Returns false if the guard failed (a concurrent
 * instance already moved this cursor); the caller must stop this tick rather
 * than proceed on stale assumptions — never advance past data the winner may
 * not have persisted yet.
 */
export async function advanceSessionPage(
  key: CursorKey,
  params: { expectedVersion: number; nextFingerprint: string },
): Promise<boolean> {
  const result = await prisma.chainScanCursor.updateMany({
    where: { ...key, version: params.expectedVersion },
    data: { activeSessionFingerprint: params.nextFingerprint, version: { increment: 1 } },
  });
  return result.count === 1;
}

/**
 * Closes a fully-drained session: the durable floor
 * (lastCommittedTimestampMs) only advances here, after every page of the
 * session has already been persisted — this is the literal mechanism behind
 * "a checkpoint must never advance past data not yet persisted."
 */
export async function closeSession(
  key: CursorKey,
  params: { expectedVersion: number; sessionMaxTimestampMs: bigint },
): Promise<boolean> {
  const result = await prisma.chainScanCursor.updateMany({
    where: { ...key, version: params.expectedVersion },
    data: {
      lastCommittedTimestampMs: params.sessionMaxTimestampMs,
      activeSessionMinTimestampMs: null,
      activeSessionMaxTimestampMs: null,
      activeSessionFingerprint: null,
      version: { increment: 1 },
    },
  });
  return result.count === 1;
}
