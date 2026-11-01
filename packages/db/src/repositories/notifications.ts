import { randomUUID } from "node:crypto";
import type { NotificationOutbox, Prisma, PushDevice } from "../../generated/prisma/client";
import { prisma, type DbTransaction } from "../client";

export type OutboxKind =
  | "deposit_credited"
  | "withdrawal_approved"
  | "withdrawal_paid"
  | "withdrawal_rejected"
  | "kyc_verified"
  | "kyc_rejected";

type Db = DbTransaction | typeof prisma;

/** Call inside the same transaction as the status change it announces. */
export async function enqueueOutbox(db: Db, userId: string, kind: OutboxKind, payload: Record<string, unknown>): Promise<void> {
  await db.notificationOutbox.create({ data: { userId, kind, payload: payload as Prisma.InputJsonValue } });
}

export async function upsertPushDevice(input: {
  userId: string;
  platform: "ANDROID" | "WEBPUSH";
  token: string;
  p256dh?: string | null;
  auth?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Serialize registration with preference changes and cap fan-out per user.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { locale: true } });
    const data = {
      userId: input.userId, platform: input.platform, p256dh: input.p256dh ?? null,
      auth: input.auth ?? null, locale: user.locale, lastSeenAt: new Date(),
    };
    await tx.pushDevice.upsert({ where: { token: input.token }, create: { ...data, token: input.token }, update: data });
    const older = await tx.pushDevice.findMany({ where: { userId: input.userId }, orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }], skip: 20, select: { id: true } });
    if (older.length) await tx.pushDevice.deleteMany({ where: { id: { in: older.map((d) => d.id) } } });
  });
}

export async function deletePushDevice(userId: string, token: string): Promise<number> {
  return (await prisma.pushDevice.deleteMany({ where: { userId, token } })).count;
}

export async function deletePushDeviceByToken(token: string): Promise<void> {
  await prisma.pushDevice.deleteMany({ where: { token } });
}

export function listPushDevices(userId: string): Promise<PushDevice[]> {
  return prisma.pushDevice.findMany({ where: { userId } });
}

/** Leases up to `limit` unsent rows; a row whose lease expired is claimable again. */
export async function claimOutbox(limit: number, leaseMs: number): Promise<NotificationOutbox[]> {
  const claimToken = randomUUID();
  return prisma.$queryRaw<NotificationOutbox[]>`
    UPDATE "NotificationOutbox"
       SET "attempts" = "attempts" + 1, "claimedAt" = now(), "claimToken" = ${claimToken}
     WHERE "id" IN (
       SELECT "id" FROM "NotificationOutbox"
        WHERE "sentAt" IS NULL
          AND ("claimedAt" IS NULL OR "claimedAt" < now() - (${leaseMs} * interval '1 millisecond'))
        ORDER BY "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

export type OutboxClaim = Pick<NotificationOutbox, "id" | "claimToken">;
export async function markOutboxSent(claims: readonly OutboxClaim[]): Promise<void> {
  if (!claims.length) return;
  await prisma.notificationOutbox.updateMany({
    where: { sentAt: null, OR: claims.filter((c) => c.claimToken !== null).map((c) => ({ id: c.id, claimToken: c.claimToken })) },
    data: { sentAt: new Date() },
  });
}
/** Configuration is absent: retain the row and retry after the lease, without spending its delivery budget. */
export async function deferOutbox(claim: OutboxClaim): Promise<void> {
  if (!claim.claimToken) return;
  await prisma.notificationOutbox.updateMany({
    where: { id: claim.id, claimToken: claim.claimToken, sentAt: null },
    data: { attempts: { decrement: 1 }, claimToken: null },
  });
}

export async function pruneOutbox(olderThan: Date): Promise<number> {
  return (await prisma.notificationOutbox.deleteMany({ where: { sentAt: { lt: olderThan } } })).count;
}

export async function notifyPrefs(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { notifyTrades: true, notifyPayments: true, notifyAccount: true, isBot: true },
  });
}

export async function setNotifyPrefs(
  userId: string,
  prefs: Partial<{ notifyTrades: boolean; notifyPayments: boolean; notifyAccount: boolean }>,
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: prefs });
}

export async function liveAccountCurrencies(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.account.findMany({ where: { id: { in: ids }, type: "LIVE" }, select: { id: true, currency: true } });
  return new Map(rows.map((r) => [r.id, r.currency]));
}

/** Read amounts and their units from one database snapshot after any currency switch. */
export async function liveTradeResults(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string; symbol: string; displayName: string; pnl: bigint; stake: bigint; currency: string }>>`
    SELECT t."id", a."symbol", a."displayName", t."pnl", t."stake", c."currency"
    FROM "Trade" t JOIN "Account" c ON c."id" = t."accountId" JOIN "Asset" a ON a."id" = t."assetId"
    WHERE t."id" = ANY(${ids}::text[]) AND c."type" = 'LIVE' AND t."status" != 'OPEN'`;
  return rows.map((r) => ({ ...r, pnl: Number(r.pnl), stake: Number(r.stake) }));
}
