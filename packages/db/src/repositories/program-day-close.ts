import { prisma, type DbTransaction } from "../client";
import { addIstDays, earningHoldReasons, istDay, istDayStart, makeEarningAvailable } from "./program-wallet";
import { computeRevenueShareDay, lockProgramDay } from "./revenue-share";

// §10 daily close (Affiliate Program spec, "Daily close").

export interface ProgramDayCloseResult {
  day: string;
  /** False when the day was already closed, or was deferred. */
  closed: boolean;
  /** True when an OPEN fixed-expiry trade that expired in the day has not settled yet: retry later. */
  deferred: boolean;
  revenueShareRows: number;
  releasedEarnings: number;
}

/** A day is closed no sooner than this after its end, so settlements of trades expiring at midnight land first. */
export const PROGRAM_DAY_CLOSE_GRACE_MS = 15 * 60_000;
const RELEASE_BATCH = 200;

type ReleaseRow = {
  id: string;
  beneficiaryUserId: string;
  amountMinor: number;
  adminReleasedAt: Date | null;
  relatedUserIds: string[];
  qualification: { referredUserId: string } | null;
};

/**
 * Release step for rows read earlier: AVAILABLE, or HELD when a hold reason
 * stands. Each row is claimed conditionally (still PENDING), so a row voided
 * or held since it was read is left alone. Returns how many became AVAILABLE.
 */
export async function releasePendingEarnings(tx: DbTransaction, rows: readonly ReleaseRow[]): Promise<number> {
  let released = 0;
  for (const e of rows) {
    // An admin release (HELD → PENDING) is a decision on this earning: no automatic re-hold.
    const hold = e.adminReleasedAt ? [] : await earningHoldReasons(tx, e.beneficiaryUserId, e.qualification?.referredUserId ?? null, true, e.relatedUserIds);
    if (hold.length) {
      await tx.programEarning.updateMany({ where: { id: e.id, status: "PENDING" }, data: { status: "HELD", holdReason: hold.join("; ") } });
    } else if (await makeEarningAvailable(tx, e)) {
      released++;
    }
  }
  return released;
}

/**
 * Auto-release step: every HELD earning (any kind, any earnedAt) whose hold
 * reasons have all cleared moves HELD → PENDING, conditionally (still HELD),
 * with an audit row; the release step then makes it AVAILABLE. Never touches
 * affiliate or flag status. Batches of 200 under the day lock, no wallet locks.
 * Returns how many moved.
 */
export async function autoReleaseHeldEarnings(day: string): Promise<number> {
  let moved = 0;
  for (let afterId = ""; ; ) {
    const batch = await prisma.$transaction(async (tx) => {
      await lockProgramDay(tx, day);
      const rows = await tx.programEarning.findMany({
        where: { status: "HELD", id: { gt: afterId } },
        orderBy: { id: "asc" },
        take: RELEASE_BATCH,
        select: { id: true, beneficiaryUserId: true, holdReason: true, relatedUserIds: true, qualification: { select: { referredUserId: true } } },
      });
      for (const e of rows) {
        const hold = await earningHoldReasons(tx, e.beneficiaryUserId, e.qualification?.referredUserId ?? null, true, e.relatedUserIds);
        if (hold.length) continue;
        const done = await tx.programEarning.updateMany({ where: { id: e.id, status: "HELD" }, data: { status: "PENDING", holdReason: null } });
        if (done.count !== 1) continue;
        moved++;
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "program.earning_auto_released",
            targetType: "ProgramEarning",
            targetId: e.id,
            before: { status: "HELD", holdReason: e.holdReason },
            after: { status: "PENDING", reason: `hold cleared: ${e.holdReason ?? "no reason recorded"}`, day },
          },
        });
      }
      return rows;
    });
    if (batch.length < RELEASE_BATCH) break;
    afterId = batch[batch.length - 1]!.id;
  }
  return moved;
}

/** An OPEN LIVE fixed-expiry (non-CFD) trade of a qualified referral that expired before `close` and is not settled yet. */
async function hasUnsettledTrades(close: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ x: number }[]>`
    SELECT 1 AS x FROM "Trade" t
    JOIN "Account" a ON a.id = t."accountId" AND a.type = 'LIVE'
    JOIN "ReferralQualification" q ON q."referredUserId" = a."userId" AND q.status = 'QUALIFIED'
    WHERE t.status = 'OPEN' AND t.mode <> 'CFD' AND t."expiryTs" < ${close}
    LIMIT 1`;
  return rows.length > 0;
}

/**
 * Closes IST day `day` ("YYYY-MM-DD"): Revenue Share (one transaction per
 * affiliate), HELD earnings whose hold reasons all cleared back to PENDING, release of PENDING earnings earned before the close (batches of
 * 200, holds re-checked, rows claimed conditionally), then the ProgramDayClose
 * marker. Every step takes the per-day advisory lock and is idempotent, so a
 * concurrent or repeated call never double-applies; the marker is written
 * last, after all steps of this call ran. Throws before close + 15 minutes;
 * returns `deferred` while a fixed-expiry trade that expired in the day is
 * still OPEN (CFD positions are decided by their closedAt, never waited for).
 */
export async function closeProgramDay(day: string, now: Date = new Date()): Promise<ProgramDayCloseResult> {
  const close = new Date(istDayStart(day).getTime() + 86_400_000); // validates `day`; IST has no DST
  if (close.getTime() + PROGRAM_DAY_CLOSE_GRACE_MS > now.getTime()) throw new Error(`IST day ${day} has not ended yet.`);
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const result = (closed: boolean, deferred: boolean, revenueShareRows = 0, releasedEarnings = 0) =>
    ({ day, closed, deferred, revenueShareRows, releasedEarnings });

  const done = await prisma.programDayClose.findUnique({ where: { day: dayDate } });
  if (done) return result(false, false, done.revenueShareRows, done.releasedEarnings);
  if (await hasUnsettledTrades(close)) return result(false, true);

  const revenueShareRows = await computeRevenueShareDay(day);
  await autoReleaseHeldEarnings(day);

  let releasedEarnings = 0;
  for (let afterId = ""; ; ) {
    const batch = await prisma.$transaction(async (tx) => {
      await lockProgramDay(tx, day);
      const rows = await tx.programEarning.findMany({
        where: { status: "PENDING", earnedAt: { lt: close }, id: { gt: afterId } },
        orderBy: { id: "asc" },
        take: RELEASE_BATCH,
        select: { id: true, beneficiaryUserId: true, amountMinor: true, adminReleasedAt: true, relatedUserIds: true, qualification: { select: { referredUserId: true } } },
      });
      releasedEarnings += await releasePendingEarnings(tx, rows);
      return rows;
    });
    if (batch.length < RELEASE_BATCH) break;
    afterId = batch[batch.length - 1]!.id;
  }

  return prisma.$transaction(async (tx) => {
    await lockProgramDay(tx, day);
    const again = await tx.programDayClose.findUnique({ where: { day: dayDate } });
    if (again) return result(false, false, again.revenueShareRows, again.releasedEarnings);
    // Counts are this call's work; a concurrent closer may have done part of it.
    await tx.programDayClose.create({ data: { day: dayDate, revenueShareRows, releasedEarnings } });
    return result(true, false, revenueShareRows, releasedEarnings);
  });
}

/**
 * Closes every not-yet-closed IST day before today, in order: from the day
 * after the last closed day, but never before the earliest earning or
 * qualification day (nothing to close earlier). Safe to run from several
 * processes at once — each day closes under its own advisory lock.
 */
export async function closeDueProgramDays(now: Date): Promise<{ closedDays: string[] }> {
  const today = istDay(now);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const [last, firstEarning, firstQualification] = await Promise.all([
    prisma.programDayClose.findFirst({ where: { day: { lt: todayDate } }, orderBy: { day: "desc" }, select: { day: true } }),
    prisma.programEarning.findFirst({ orderBy: { earnedAt: "asc" }, select: { earnedAt: true } }),
    prisma.referralQualification.findFirst({ orderBy: { qualifiedAt: "asc" }, select: { qualifiedAt: true } }),
  ]);
  const firsts = [firstEarning?.earnedAt, firstQualification?.qualifiedAt].filter((d): d is Date => !!d).map(istDay).sort();
  if (!firsts[0]) return { closedDays: [] };
  let day = firsts[0];
  if (last) {
    const afterLast = addIstDays(last.day.toISOString().slice(0, 10), 1);
    if (afterLast > day) day = afterLast;
  }
  const closedDays: string[] = [];
  for (; day < today; day = addIstDays(day, 1)) {
    // Days close in order: stop at the first one that is not ready yet.
    if (istDayStart(addIstDays(day, 1)).getTime() + PROGRAM_DAY_CLOSE_GRACE_MS > now.getTime()) break;
    const r = await closeProgramDay(day, now);
    if (r.deferred) break;
    if (r.closed) closedDays.push(day);
  }
  return { closedDays };
}
