import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BONUS_PERCENT,
  TURNOVER_MULTIPLE,
  formatMoney,
  listAccountsForActor,
  withdrawableBalance,
} from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";

export default async function WithdrawalPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const accounts = await listAccountsForActor(session.userId);
  const live = accounts.find((a) => a.type === "LIVE");
  if (!live) redirect("/trade");

  const balance = await withdrawableBalance(live.id);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
      <PlatformTabs />
      <h1 className="text-lg font-bold tracking-tight">Withdrawal</h1>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
          <h2 className="text-sm font-semibold">Account</h2>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              In the account
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(live.realBalance + live.bonusBalance, live.currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              Available for withdrawal
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(balance.withdrawable, live.currency)}
            </p>
          </div>

          {balance.lockedBonus > 0 ? (
            <div className="rounded bg-[var(--color-tile)] p-3">
              <p className="text-xs font-semibold">
                {formatMoney(balance.lockedBonus, live.currency)} bonus locked
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                A {BONUS_PERCENT}% bonus requires {TURNOVER_MULTIPLE}× turnover before it can be
                withdrawn. {formatMoney(balance.turnoverRemaining, live.currency)} of trading volume
                remaining.
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Withdraw</h2>
          <WithdrawForm accountId={live.id} withdrawableMinor={balance.withdrawable} />
        </section>
      </div>
    </main>
  );
}
