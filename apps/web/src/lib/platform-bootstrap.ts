import { tradeViewFrom, type TradeView } from "@asm/contracts";
import { countCompletedDeposits, listAccountsForActor, listTradesForActor, prisma } from "@asm/db";

export interface PlatformBootstrap {
  assets: { symbol: string; displayName: string; payoutPct: number; precision: number; assetClass: string }[];
  accounts: { id: string; type: "LIVE" | "DEMO"; currency: string; realBalance: number; bonusBalance: number }[];
  recentTrades: TradeView[];
  defaultSymbol: string;
  liveAccess: boolean;
  completedDeposits: number;
}

/** Everything the trading shell needs on first paint — web layout and app bootstrap share it. */
export async function loadPlatformBootstrap(userId: string): Promise<PlatformBootstrap> {
  const [accounts, assets, user, completedDeposits] = await Promise.all([
    listAccountsForActor(userId),
    prisma.asset.findMany({
      where: { isOpen: true },
      orderBy: { symbol: "asc" },
      select: { id: true, symbol: true, displayName: true, precision: true, payoutPct: true, assetClass: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { liveAccess: true } }),
    countCompletedDeposits(userId),
  ]);

  const defaultAccount = accounts.find((a) => a.type === "DEMO") ?? accounts[0];
  const recent = defaultAccount ? await listTradesForActor(userId, defaultAccount.id, 50) : [];
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));
  const defaultSymbol = (assets.find((a) => a.symbol === "NIFTY50") ?? assets[0])?.symbol ?? "";

  return {
    assets: assets.map((a) => ({
      symbol: a.symbol,
      displayName: a.displayName,
      payoutPct: a.payoutPct,
      precision: a.precision,
      assetClass: String(a.assetClass),
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type as "LIVE" | "DEMO",
      currency: a.currency,
      realBalance: a.realBalance,
      bonusBalance: a.bonusBalance,
    })),
    recentTrades: recent.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN")),
    defaultSymbol,
    liveAccess: user?.liveAccess ?? false,
    completedDeposits,
  };
}
