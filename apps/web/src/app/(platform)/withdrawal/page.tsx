import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  formatMoney,
  listAccountsForActor,
  listWithdrawalsForActor,
  loadProfile,
  withdrawableBalance,
} from "@asm/db";
import { PAYOUT_METHOD_LABEL, isUsdtNetwork, payoutDestinationLabel } from "@asm/contracts";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { WithdrawForm, type LastPayouts } from "./WithdrawForm";
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

  // Prefill each payout method with the details the user last withdrew to
  // (rows are newest-first, so the first match per method wins).
  const lastPayouts: LastPayouts = {};
  for (const w of recent) {
    if (w.method === "BANK" && !lastPayouts.BANK && w.accountHolder && w.accountNumber && w.ifsc) {
      lastPayouts.BANK = { accountHolder: w.accountHolder, accountNumber: w.accountNumber, ifsc: w.ifsc };
    } else if (w.method === "UPI" && !lastPayouts.UPI && w.upiId) {
      lastPayouts.UPI = { upiId: w.upiId };
    } else if (w.method === "USDT" && !lastPayouts.USDT && w.usdtAddress && isUsdtNetwork(w.usdtNetwork)) {
      lastPayouts.USDT = { usdtNetwork: w.usdtNetwork, usdtAddress: w.usdtAddress };
    }
  }
  const kycName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

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
                Your deposit bonus is for trading only and can&apos;t be cashed out. Only
                your real balance above is available to withdraw.
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Withdraw</h2>
          {profile.kycStatus === "VERIFIED" ? (
            <WithdrawForm
              accountId={live.id}
              currency={live.currency}
              withdrawableMinor={balance.withdrawable}
              lastPayouts={lastPayouts}
              kycName={kycName}
            />
          ) : (
            <VerifyFirst kycStatus={profile.kycStatus} />
          )}
        </section>
      </div>

      <section className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)]">
        <h2 className="border-b border-[var(--color-rule)] px-4 py-3 text-sm font-semibold">
          Your withdrawals
        </h2>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--color-ink-2)]">
            No withdrawals yet. Your requests and their status will show here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-rule)]">
            {recent.map((w) => {
              const pill = STATUS_PILL[w.status] ?? STATUS_PILL.REQUESTED!;
              const method = PAYOUT_METHOD_LABEL[w.method as keyof typeof PAYOUT_METHOD_LABEL] ?? w.method;
              const dest = payoutDestinationLabel(w);
              return (
                <li key={w.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">{formatMoney(w.amount, w.currency)}</p>
                    <p className="truncate text-[11px] text-[var(--color-ink-2)]">
                      {method}
                      {dest ? <span className="font-mono"> · {dest}</span> : null}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-3)]">{DATE_FMT.format(w.createdAt)}</p>
                    {w.status === "REJECTED" && w.reason ? (
                      <p className="mt-1 text-[11px] text-[var(--color-down)]">
                        {w.reason} — the amount is back in your balance.
                      </p>
                    ) : null}
                  </div>
                  <span className={`flex-none rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${pill.cls}`}>
                    {pill.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: "Pending", cls: "bg-caution/15 text-caution" },
  HELD: { label: "On hold", cls: "bg-caution/15 text-caution" },
  APPROVED: { label: "Processing", cls: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]" },
  PAID: { label: "Paid", cls: "bg-[var(--color-up)]/15 text-[var(--color-up)]" },
  REJECTED: { label: "Rejected", cls: "bg-[var(--color-down)]/15 text-[var(--color-down)]" },
  CANCELLED_BY_USER: { label: "Cancelled", cls: "bg-[var(--color-tile)] text-[var(--color-ink-2)]" },
};

const VERIFY_COPY: Record<string, { title: string; body: string; cta: string | null }> = {
  PENDING: {
    title: "Verification in review",
    body: "We have your details and are checking them. Withdrawals unlock as soon as your account is verified.",
    cta: null,
  },
  REJECTED: {
    title: "Verification not approved",
    body: "We couldn't verify what you sent. Check your details, replace any unclear photo and submit again.",
    cta: "Fix and resubmit",
  },
};

/** Shown in place of the withdraw form until the account's KYC is VERIFIED (the API enforces the same). */
function VerifyFirst({ kycStatus }: { kycStatus: string }) {
  const copy = VERIFY_COPY[kycStatus] ?? {
    title: "Verify your identity to withdraw",
    body: "A one-time check before your first withdrawal: your details, a photo of your Aadhaar and PAN card, and a selfie. It takes about 2 minutes.",
    cta: "Start verification",
  };
  return (
    <div className="flex flex-col gap-3 rounded border border-caution/30 bg-caution/10 p-4">
      <p className="text-sm font-semibold text-caution">{copy.title}</p>
      <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">{copy.body}</p>
      {copy.cta ? (
        <Link
          href="/account/verify"
          className="self-start rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-ink)] phone:self-stretch phone:text-center"
        >
          {copy.cta}
        </Link>
      ) : null}
    </div>
  );
}
