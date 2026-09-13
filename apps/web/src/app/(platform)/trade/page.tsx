import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, listAccountsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { AccountSwitcher } from "@/components/AccountSwitcher";

export default async function TradePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  // Scoped by actor — this page cannot render another user's accounts.
  const accounts = await listAccountsForActor(session.userId);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">ASM Trade</h1>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          Simulated
        </span>
      </div>

      <AccountSwitcher
        accounts={accounts.map((a) => ({
          id: a.id,
          type: a.type,
          balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
        }))}
      />

      <p className="text-sm text-[var(--color-ink-2)]">
        Chart and trading arrive in Plan 02.
      </p>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
