import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor, prisma } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { LiveChart } from "@/components/chart/LiveChart";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  // Scoped by actor — this page cannot render another user's accounts.
  const [accounts, asset] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findUnique({
      where: { symbol: "AUDNZD_OTC" },
      select: { symbol: true, displayName: true, precision: true },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">ASM Trade</h1>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            Simulated
          </span>
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
          >
            Log out
          </button>
        </form>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_240px]">
        <section className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
          {asset ? (
            <LiveChart symbol={asset.symbol} displayName={asset.displayName} precision={asset.precision} />
          ) : (
            <p className="text-sm text-[var(--color-ink-2)]">
              No assets seeded. Run <code>pnpm db:seed</code>.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <AccountSwitcher
            accounts={accounts.map((a) => ({
              id: a.id,
              type: a.type,
              balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
            }))}
          />
          <p className="text-xs text-[var(--color-ink-2)]">Trade ticket arrives in Plan 03.</p>
        </aside>
      </div>
    </main>
  );
}
