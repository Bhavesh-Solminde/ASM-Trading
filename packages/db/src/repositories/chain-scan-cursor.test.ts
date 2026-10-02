import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  advanceEvmCursor,
  advanceSessionPage,
  closeSession,
  ensureSessionOpen,
  getOrCreateCursor,
  getOrCreateEvmCursor,
} from "./chain-scan-cursor";

function key() {
  return { network: `test-${randomUUID()}`, tokenContract: "TContract", receivingAddress: "TReceiving" };
}

afterEach(async () => {
  await prisma.chainScanCursor.deleteMany({ where: { network: { startsWith: "test-" } } });
});

describe("getOrCreateCursor", () => {
  it("creates a new cursor at the given initial timestamp on first use", async () => {
    const k = key();
    const cursor = await getOrCreateCursor(k, 1_700_000_000_000);
    expect(cursor.lastCommittedTimestampMs).toBe(1_700_000_000_000n);
    expect(cursor.activeSessionMinTimestampMs).toBeNull();
    expect(cursor.version).toBe(0);
  });

  it("returns the existing row on a second call rather than resetting it", async () => {
    const k = key();
    const first = await getOrCreateCursor(k, 1_700_000_000_000);
    await prisma.chainScanCursor.update({
      where: { network_tokenContract_receivingAddress: k },
      data: { lastCommittedTimestampMs: 1_800_000_000_000n },
    });
    const second = await getOrCreateCursor(k, 999);
    expect(second.lastCommittedTimestampMs).toBe(1_800_000_000_000n);
    expect(first.network).toBe(k.network);
  });
});

describe("ensureSessionOpen / advanceSessionPage / closeSession", () => {
  it("opens a session with the overlap window subtracted from the committed floor", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const opened = await ensureSessionOpen(k, { overlapMs: 100_000, nowMs: 2_000_000 });
    expect(opened.activeSessionMinTimestampMs).toBe(900_000n);
    expect(opened.activeSessionMaxTimestampMs).toBe(2_000_000n);
    expect(opened.activeSessionFingerprint).toBeNull();
  });

  it("floors the session window at 0 rather than going negative", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000);
    const opened = await ensureSessionOpen(k, { overlapMs: 100_000, nowMs: 2_000 });
    expect(opened.activeSessionMinTimestampMs).toBe(0n);
  });

  it("is a no-op — resumes the existing session — when one is already in progress", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const first = await ensureSessionOpen(k, { overlapMs: 100_000, nowMs: 2_000_000 });
    const second = await ensureSessionOpen(k, { overlapMs: 999_999_999, nowMs: 3_000_000 });
    expect(second.activeSessionMinTimestampMs).toBe(first.activeSessionMinTimestampMs);
    expect(second.activeSessionMaxTimestampMs).toBe(first.activeSessionMaxTimestampMs);
    expect(second.version).toBe(first.version);
  });

  it("advanceSessionPage moves the fingerprint but never touches lastCommittedTimestampMs", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const opened = await ensureSessionOpen(k, { overlapMs: 0, nowMs: 2_000_000 });
    const ok = await advanceSessionPage(k, { expectedVersion: opened.version, nextFingerprint: "page-2" });
    expect(ok).toBe(true);

    const cursor = await getOrCreateCursor(k, 0);
    expect(cursor.activeSessionFingerprint).toBe("page-2");
    expect(cursor.lastCommittedTimestampMs).toBe(1_000_000n);
    expect(cursor.version).toBe(opened.version + 1);
  });

  it("advanceSessionPage fails (returns false) on a stale version — never advances past unpersisted data", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const opened = await ensureSessionOpen(k, { overlapMs: 0, nowMs: 2_000_000 });
    const ok = await advanceSessionPage(k, { expectedVersion: opened.version + 5, nextFingerprint: "page-2" });
    expect(ok).toBe(false);

    const cursor = await getOrCreateCursor(k, 0);
    expect(cursor.activeSessionFingerprint).toBeNull();
  });

  it("closeSession advances lastCommittedTimestampMs to the session max and clears session fields", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const opened = await ensureSessionOpen(k, { overlapMs: 0, nowMs: 2_000_000 });
    const ok = await closeSession(k, { expectedVersion: opened.version, sessionMaxTimestampMs: 2_000_000n });
    expect(ok).toBe(true);

    const cursor = await getOrCreateCursor(k, 0);
    expect(cursor.lastCommittedTimestampMs).toBe(2_000_000n);
    expect(cursor.activeSessionMinTimestampMs).toBeNull();
    expect(cursor.activeSessionMaxTimestampMs).toBeNull();
    expect(cursor.activeSessionFingerprint).toBeNull();
  });

  it("a fresh tick after a closed session opens a NEW session relative to the new floor", async () => {
    const k = key();
    await getOrCreateCursor(k, 1_000_000);
    const first = await ensureSessionOpen(k, { overlapMs: 0, nowMs: 2_000_000 });
    await closeSession(k, { expectedVersion: first.version, sessionMaxTimestampMs: 2_000_000n });

    const second = await ensureSessionOpen(k, { overlapMs: 500_000, nowMs: 3_000_000 });
    expect(second.activeSessionMinTimestampMs).toBe(1_500_000n);
    expect(second.activeSessionMaxTimestampMs).toBe(3_000_000n);
  });
});

describe("getOrCreateEvmCursor / advanceEvmCursor", () => {
  it("creates at the initial block with lastCommittedTimestampMs 0, and returns the existing row on a second call", async () => {
    const k = key();
    const created = await getOrCreateEvmCursor(k, 50_000_000n);
    expect(created.lastScannedBlock).toBe(50_000_000n);
    expect(created.lastCommittedTimestampMs).toBe(0n);
    expect(created.activeSessionMinTimestampMs).toBeNull();
    expect(created.version).toBe(0);

    const again = await getOrCreateEvmCursor(k, 1n);
    expect(again.lastScannedBlock).toBe(50_000_000n);
    expect(again.version).toBe(created.version);
  });

  it("advances with the current version (bumping it), and refuses a stale version", async () => {
    const k = key();
    const c = await getOrCreateEvmCursor(k, 100n);

    expect(await advanceEvmCursor(k, c.version, 2_100n)).toBe(true);
    const after = await getOrCreateEvmCursor(k, 0n);
    expect(after.lastScannedBlock).toBe(2_100n);
    expect(after.version).toBe(c.version + 1);

    // The version we read before the advance is now stale.
    expect(await advanceEvmCursor(k, c.version, 9_999n)).toBe(false);
    const unchanged = await getOrCreateEvmCursor(k, 0n);
    expect(unchanged.lastScannedBlock).toBe(2_100n);
    expect(unchanged.version).toBe(after.version);
  });

  it("holds block numbers beyond 2^53 exactly", async () => {
    const k = key();
    const big = 2n ** 60n + 7n;
    const c = await getOrCreateEvmCursor(k, big);
    expect(c.lastScannedBlock).toBe(big);
  });
});
