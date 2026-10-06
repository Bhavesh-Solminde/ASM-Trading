import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BONUS_PERCENT,
  formatMoney,
  listAccountsForActor,
  listWithdrawalsForActor,
  loadProfile,
  withdrawableBalance,
} from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { WithdrawForm } from "./WithdrawForm";
import { HeldWithdrawalCard } from "./HeldWithdrawalCard";

export const dynamic = "force-dynamic";

export default async function WithdrawalPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [accounts, profile] = await Promise.all([
    listAccountsForActor(session.userId),
    loadProfile(session.userId),
  ]);
  const live = accounts.find((a) => a.type === "LIVE");
  if (!live) redirect("/trade");

  const balance = await withdrawableBalance(live.id);
  const recent = await listWithdrawalsForActor(session.userId, 20);
  const heldWithdrawals = recent.filter((w) => w.status === "HELD");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8 phone:px-4 phone:py-5">
      <PlatformTabs />
      <h1 className="text-lg font-bold tracking-tight">Withdrawal</h1>

      {heldWithdrawals.map((w) => (
        <HeldWithdrawalCard
          key={w.id}
          id={w.id}
          amountLabel={formatMoney(w.amount, live.currency)}
          holdUntilIso={w.holdUntil?.toISOString() ?? null}
          cancelableUntilIso={w.cancelableUntil?.toISOString() ?? null}
        />
      ))}

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
                {formatMoney(balance.lockedBonus, live.currency)} bonus — not withdrawable
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                Your {BONUS_PERCENT}% first-deposit bonus is for trading only and can&apos;t be
                cashed out. Only your real balance above is available to withdraw.
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Withdraw</h2>
          {profile.kycStatus === "VERIFIED" ? (
            <WithdrawForm accountId={live.id} withdrawableMinor={balance.withdrawable} />
          ) : (
            <VerifyFirst kycStatus={profile.kycStatus} />
          )}
        </section>
      </div>
    </main>
  );
}

const VERIFY_COPY: Record<string, { title: string; body: string; cta: string | null }> = {
  PENDING: {
    title: "Verification in review",
    body: "We have your details and are checking them. Withdrawals unlock as soon as your account is verified.",
    cta: null,
  },
  REJECTED: {
    title: "Verification not approved",
    body: "We couldn't verify the details you sent. Check your personal data and save it again to resubmit.",
    cta: "Update personal data",
  },
};

/** Shown in place of the withdraw form until the account's KYC is VERIFIED (the API enforces the same). */
function VerifyFirst({ kycStatus }: { kycStatus: string }) {
  const copy = VERIFY_COPY[kycStatus] ?? {
    title: "Verify your account to withdraw",
    body: "Withdrawals are available to verified accounts only. Fill in your personal data on the Account page and save it to submit for verification.",
    cta: "Verify account",
  };
  return (
    <div className="flex flex-col gap-3 rounded border border-caution/30 bg-caution/10 p-4">
      <p className="text-sm font-semibold text-caution">{copy.title}</p>
      <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">{copy.body}</p>
      {copy.cta ? (
        <Link
          href="/account"
          className="self-start rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-ink)] phone:self-stretch phone:text-center"
        >
          {copy.cta}
        </Link>
      ) : null}
    </div>
  );
}
