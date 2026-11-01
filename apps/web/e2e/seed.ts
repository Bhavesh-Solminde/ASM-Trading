import { prisma } from "@asm/db";

/** Every row the suite creates carries this tag so teardown can find it. */
export const TAG = "e2e-lb";
export const VIEWER_EMAIL = `${TAG}-viewer@test.local`;
export const VIEWER_PASSWORD = "e2e-Viewer-Passw0rd!";

/**
 * Leaderboard fixtures, one settled LIVE trade each, expiring "now" so they
 * count for today:
 *  - dollar:  $1,108.00 on a USD account (raw 110_800) — must outrank rupee
 *  - rupee:   ₹2,039.52 on an INR account (raw 203_952)
 *  - abroad:  ₹9,000 from the Philippines — must not appear at all
 *  - nowhere: ₹8,000 with no known country — must not appear at all
 */
export const TRADERS = [
  { key: "dollar", nickname: "E2E Dollar", country: "India", currency: "USD", pnl: 110_800 },
  { key: "rupee", nickname: "E2E Rupee", country: "BD", currency: "INR", pnl: 203_952 },
  { key: "abroad", nickname: "E2E Abroad", country: "PH", currency: "INR", pnl: 900_000 },
  { key: "nowhere", nickname: "E2E Nowhere", country: null, currency: "INR", pnl: 800_000 },
] as const;

export async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const accounts = await prisma.account.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const accountIds = accounts.map((a) => a.id);
  await prisma.trade.deleteMany({ where: { accountId: { in: accountIds } } });
  // Accounts, sessions and the rest cascade from the (tagged, test-only) users.
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function seedLeaderboard(): Promise<void> {
  const asset = await prisma.asset.findFirstOrThrow({ where: { isOpen: true } });
  const now = Date.now();
  for (const t of TRADERS) {
    const user = await prisma.user.create({
      data: { email: `${TAG}-${t.key}@test.local`, passwordHash: "x", nickname: t.nickname, country: t.country },
    });
    const account = await prisma.account.create({
      data: { userId: user.id, type: "LIVE", currency: t.currency, realBalance: 0 },
    });
    await prisma.trade.create({
      data: {
        accountId: account.id,
        assetId: asset.id,
        direction: "UP",
        stake: 10_000,
        payoutPct: 90,
        entryPrice: 1,
        entryTs: new Date(now - 60_000),
        expiryTs: new Date(now - 1_000),
        exitPrice: 1.1,
        status: "WON",
        pnl: t.pnl,
      },
    });
  }
}
