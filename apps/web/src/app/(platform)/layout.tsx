import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tradeViewFrom } from "@asm/contracts";
import { listAccountsForActor, listTradesForActor, prisma } from "@asm/db";
import { PlatformProvider } from "@/components/shell/PlatformProvider";
import { PlatformShell } from "@/components/shell/PlatformShell";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [accounts, assets, user] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findMany({
      where: { isOpen: true },
      orderBy: { symbol: "asc" },
      select: { id: true, symbol: true, displayName: true, precision: true, payoutPct: true },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { liveAccess: true } }),
  ]);

  // History is server-rendered for the default (demo) account; the provider
  // fetches it for any other account on switch.
  const defaultAccount = accounts.find((a) => a.type === "DEMO") ?? accounts[0];
  const recent = defaultAccount ? await listTradesForActor(session.userId, defaultAccount.id, 50) : [];
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));
  const defaultSymbol = (assets.find((a) => a.symbol === "AUDNZD_OTC") ?? assets[0])?.symbol ?? "";

  return (
    <PlatformProvider
      assets={assets.map((a) => ({
        symbol: a.symbol,
        displayName: a.displayName,
        payoutPct: a.payoutPct,
        precision: a.precision,
      }))}
      accounts={accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency }))}
      initialBalances={Object.fromEntries(
        accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }]),
      )}
      initialTrades={recent.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN"))}
      defaultSymbol={defaultSymbol}
      liveAccess={user?.liveAccess ?? false}
    >
      <PlatformShell>{children}</PlatformShell>
    </PlatformProvider>
  );
}
