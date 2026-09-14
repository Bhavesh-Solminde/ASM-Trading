import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tradeViewFrom } from "@asm/contracts";
import { listAccountsForActor, listTradesForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TradeWorkspace } from "@/components/trade/TradeWorkspace";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [accounts, assets] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findMany({
      where: { isOpen: true },
      orderBy: { symbol: "asc" },
      select: { id: true, symbol: true, displayName: true, precision: true, payoutPct: true },
    }),
  ]);

  const asset = assets.find((a) => a.symbol === "AUDNZD_OTC") ?? assets[0];
  if (!asset) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <p className="text-sm text-[var(--color-ink-2)]">
          No assets seeded. Run <code>pnpm db:seed</code>.
        </p>
      </main>
    );
  }

  // History is server-rendered for the default (demo) account; the workspace
  // fetches it for any other account on switch.
  const defaultAccount = accounts.find((a) => a.type === "DEMO") ?? accounts[0];
  const recent = defaultAccount ? await listTradesForActor(session.userId, defaultAccount.id, 50) : [];
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <TradeWorkspace
        symbol={asset.symbol}
        precision={asset.precision}
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
      />
    </main>
  );
}
