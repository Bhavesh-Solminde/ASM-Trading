"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PAYOUT_METHOD_LABEL,
  PayoutDetailsSchema,
  USDT_NETWORK_INFO,
  USDT_NETWORKS,
  type PayoutDetails,
  type PayoutMethod,
  type UsdtNetwork,
} from "@asm/contracts";
import type { ProgramActivityItem, ProgramSummary } from "@asm/db";
import { formatMinor } from "@asm/client-core";
import { IconTether } from "@/components/trade/AssetIcon";
import { Icon } from "@/components/shell/Icon";
import { usePlatform } from "@/components/shell/PlatformProvider";

// Classes mirror the withdrawal form (app/(platform)/withdrawal/WithdrawForm.tsx) and the
// affiliate dashboard cards, so this panel adds no new visual language.
const CARD = "rounded-xl border border-rule bg-panel p-5 phone:p-4";
const LABEL = "text-[13px] font-semibold text-ink-2";
const INPUT =
  "mt-1.5 h-12 w-full rounded-xl bg-tile px-3.5 text-base ring-1 ring-rule placeholder:text-ink-3 focus:ring-brand aria-[invalid=true]:ring-down";
const PRIMARY =
  "h-14 w-full rounded-2xl bg-brand-fill text-base font-bold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-50";

const inr = (minor: number) => formatMinor(minor, "INR");
const whole = (minor: number) => inr(minor).replace(/\.00$/, "");

/** "1999" / "1999.5" / "1999.50" rupees → paise; null for anything else. */
export function rupeesToPaise(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) return null;
  const [r, p = ""] = v.split(".");
  return Number(r) * 100 + Number(p.padEnd(2, "0"));
}

/** POST JSON; resolves to { ok, data } or throws on network failure. */
async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function ProgramEarningsPanel({ summary, activity }: { summary: ProgramSummary; activity: ProgramActivityItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Balances summary={summary} />
      <Requirements summary={summary} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TransferForm summary={summary} />
        <WithdrawalForm summary={summary} />
      </div>
      <History items={activity} />
    </div>
  );
}

function Balances({ summary: s }: { summary: ProgramSummary }) {
  const cards = [
    { label: "Pending", value: s.pendingMinor, note: "Available after the day closes (IST)" },
    { label: "On hold", value: s.heldMinor, note: "Under review" },
    { label: "Available", value: s.availableMinor, note: "Ready to transfer or withdraw", up: true },
    { label: "Reserved", value: s.reservedMinor, note: "In requested withdrawals" },
    { label: "Transferred", value: s.transferredMinor, note: "Moved to your trading balance" },
    { label: "Paid", value: s.paidMinor, note: "Paid out to you" },
  ];
  return (
    <section aria-labelledby="program-balances" className="flex flex-col gap-3">
      <h2 id="program-balances" className="text-sm font-bold text-ink">
        Earnings
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{c.label}</span>
            <span className={`text-xl font-bold tracking-tight tabular-nums ${c.up ? "text-up" : "text-ink"}`}>{inr(c.value)}</span>
            <span className="text-[10px] text-ink-3">{c.note}</span>
          </div>
        ))}
      </div>
      {s.isAffiliate && s.carryForwardMinor < 0 ? (
        <p className="text-xs leading-relaxed text-ink-2">
          Revenue Share carried forward: <span className="font-semibold text-ink tabular-nums">−{inr(-s.carryForwardMinor)}</span>.
          Your referrals&apos; trading made a net loss for you to share; it is offset against their future results before
          new Revenue Share is paid. Earlier payouts are never taken back.
        </p>
      ) : null}
    </section>
  );
}

/** Plain-language text for each refusal code getProgramSummary reports. */
function blockerText(code: string, s: ProgramSummary): string {
  switch (code) {
    case "account_frozen":
      return "Your account is restricted, so program money can't be moved. Contact support.";
    case "affiliate_not_active":
      return s.affiliateStatus === "SUSPENDED"
        ? "Your affiliate account is suspended. Your records stay visible, but transfers and withdrawals are paused."
        : s.affiliateStatus === "PENDING_APPROVAL"
          ? "Your affiliate account is waiting for approval. Transfers and withdrawals unlock once it is approved."
          : "Verify your email to activate your affiliate account.";
    case "kyc_required":
      return s.isAffiliate
        ? "Verify your identity before transferring or withdrawing earnings."
        : "Verify your identity before withdrawing earnings.";
    case "no_live_account":
      return "You need a live trading account to transfer earnings.";
    case "below_minimum":
      return `The minimum withdrawal is ${whole(s.terms.minWithdrawalMinor)}. You have ${inr(s.availableMinor)} available.`;
    case "insufficient_funds":
      return "Nothing available yet. Pending earnings become available after their day closes at midnight IST.";
    case "limit_day":
      return `You have used today's withdrawal limit (${s.terms.limits.day} per day).`;
    case "limit_week":
      return `You have used this week's withdrawal limit (${s.terms.limits.week} per week).`;
    case "limit_month":
      return `You have used this month's withdrawal limit (${s.terms.limits.month} per month).`;
    default:
      return "This action isn't available right now.";
  }
}

function Requirements({ summary: s }: { summary: ProgramSummary }) {
  return (
    <section aria-labelledby="program-requirements" className={CARD}>
      <h2 id="program-requirements" className="text-sm font-bold text-ink">
        Requirements
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Minimum withdrawal {whole(s.terms.minWithdrawalMinor)}. Withdrawals used: today {s.used.day}/{s.terms.limits.day}, this
        week {s.used.week}/{s.terms.limits.week}, this month {s.used.month}/{s.terms.limits.month}.
      </p>
      {s.blockers.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-caution/30 bg-caution/10 p-4">
          <ul className="flex flex-col gap-1.5">
            {s.blockers.map((code) => (
              <li key={code} className="text-xs leading-relaxed text-[var(--color-ink-2)]">
                {blockerText(code, s)}
              </li>
            ))}
          </ul>
          {s.blockers.includes("kyc_required") && s.kycStatus !== "PENDING" ? (
            <Link
              href="/account/verify"
              className="self-start rounded-lg bg-brand-fill px-4 py-2 text-sm font-semibold text-white hover:bg-brand-fill-hi phone:grid phone:h-11 phone:self-stretch phone:place-items-center phone:py-0"
            >
              Start verification
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** One idempotency key per intended action: reused when a request never got an answer, renewed after one. */
function useIdempotencyKey() {
  const key = useRef<string | null>(null);
  return {
    get: () => (key.current ??= crypto.randomUUID()),
    settle: () => {
      key.current = null;
    },
  };
}

function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? (
    <p role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
      {children}
    </p>
  ) : (
    <p role="alert" className="text-sm text-down">
      {children}
    </p>
  );
}

function TransferForm({ summary: s }: { summary: ProgramSummary }) {
  const router = useRouter();
  const { applyBalanceUpdate } = usePlatform();
  const key = useIdempotencyKey();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountMinor = rupeesToPaise(amount);
    if (!amountMinor) return setResult({ ok: false, text: "Enter the amount to transfer." });
    if (amountMinor > s.availableMinor) return setResult({ ok: false, text: "That is more than your available earnings." });
    setBusy(true);
    setResult(null);
    try {
      const { ok, data } = await postJson("/api/program/transfer", { amountMinor, idempotencyKey: key.get() });
      key.settle();
      if (!ok) return setResult({ ok: false, text: String(data.error ?? "Could not transfer that amount.") });
      const balance = data.balance as { realBalance: number; bonusBalance: number } | null;
      if (typeof data.accountId === "string" && balance) applyBalanceUpdate(data.accountId, balance);
      setAmount("");
      setResult({ ok: true, text: `${inr(amountMinor)} moved to your trading balance.` });
      router.refresh();
    } catch {
      setResult({ ok: false, text: "Network error — check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="program-transfer" className={CARD}>
      <h2 id="program-transfer" className="text-sm font-bold text-ink">
        Move to trading balance
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Instantly adds available earnings to your own live trading balance. A transfer is not a deposit and can&apos;t be
        reversed.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-4 flex flex-col gap-4">
        <AmountInput id="ptamount" value={amount} onChange={setAmount} disabled={!s.canTransfer} />
        {result ? <Notice ok={result.ok}>{result.text}</Notice> : null}
        <button type="submit" disabled={busy || !s.canTransfer} className={PRIMARY}>
          {busy ? "Transferring…" : "Transfer"}
        </button>
      </form>
    </section>
  );
}

function WithdrawalForm({ summary: s }: { summary: ProgramSummary }) {
  const router = useRouter();
  const key = useIdempotencyKey();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("BANK");
  const [accountHolder, setAccountHolder] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmNumber, setConfirmNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [usdtNetwork, setUsdtNetwork] = useState<UsdtNetwork>("tron");
  const [usdtAddress, setUsdtAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const disabled = !s.canWithdraw;

  function payout(): { ok: PayoutDetails } | { error: string } {
    const raw =
      method === "BANK"
        ? { method, accountHolder, accountNumber, ifsc }
        : method === "UPI"
          ? { method, upiId }
          : { method, usdtNetwork, usdtAddress };
    const parsed = PayoutDetailsSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the payout details." };
    if (method === "BANK" && accountNumber.trim() !== confirmNumber.trim()) return { error: "The account numbers don't match." };
    return { ok: parsed.data };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountMinor = rupeesToPaise(amount);
    if (!amountMinor) return setResult({ ok: false, text: "Enter the amount to withdraw." });
    if (amountMinor < s.terms.minWithdrawalMinor) {
      return setResult({ ok: false, text: `The minimum withdrawal is ${whole(s.terms.minWithdrawalMinor)}.` });
    }
    if (amountMinor > s.availableMinor) return setResult({ ok: false, text: "That is more than your available earnings." });
    const p = payout();
    if ("error" in p) return setResult({ ok: false, text: p.error });
    setBusy(true);
    setResult(null);
    try {
      const { ok, data } = await postJson("/api/program/withdrawals", { amountMinor, payout: p.ok, idempotencyKey: key.get() });
      key.settle();
      if (!ok) return setResult({ ok: false, text: String(data.error ?? "Could not request that withdrawal.") });
      setAmount("");
      setResult({ ok: true, text: `Withdrawal of ${inr(amountMinor)} requested. We'll review it and pay it out.` });
      router.refresh();
    } catch {
      setResult({ ok: false, text: "Network error — check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="program-withdraw" className={CARD}>
      <h2 id="program-withdraw" className="text-sm font-bold text-ink">
        Withdraw earnings
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Paid to your bank account, UPI ID or USDT wallet after review. You can cancel while it is pending.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-4 flex flex-col gap-4">
        <AmountInput id="pwamount" value={amount} onChange={setAmount} disabled={disabled} />
        <div>
          <p id="pwmethod-label" className={LABEL}>
            Receive money by
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="pwmethod-label">
            {(["BANK", "UPI", "USDT"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                disabled={disabled}
                onClick={() => setMethod(m)}
                className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-xs font-semibold ring-1 transition-colors motion-reduce:transition-none ${
                  method === m ? "bg-brand/10 text-ink ring-brand" : "bg-tile text-ink-2 ring-rule hover:ring-ink-3"
                }`}
              >
                <MethodGlyph method={m} />
                {PAYOUT_METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        {method === "BANK" ? (
          <>
            <Field id="pwholder" label="Account holder name" value={accountHolder} onChange={setAccountHolder} disabled={disabled} autoComplete="name" placeholder="As on your bank account" />
            <Field id="pwacct" label="Account number" value={accountNumber} onChange={(v) => setAccountNumber(v.replace(/\D/g, ""))} disabled={disabled} inputMode="numeric" placeholder="Bank account number" />
            <Field id="pwacct2" label="Confirm account number" value={confirmNumber} onChange={(v) => setConfirmNumber(v.replace(/\D/g, ""))} disabled={disabled} inputMode="numeric" placeholder="Re-enter the account number" />
            <Field id="pwifsc" label="IFSC code" value={ifsc} onChange={(v) => setIfsc(v.toUpperCase().replace(/\s/g, ""))} disabled={disabled} placeholder="e.g. HDFC0001234" maxLength={11} />
          </>
        ) : method === "UPI" ? (
          <Field id="pwupi" label="UPI ID" value={upiId} onChange={(v) => setUpiId(v.trim())} disabled={disabled} placeholder="name@okicici or 9876543210@ybl" autoCapitalize="none" />
        ) : (
          <>
            <div>
              <p id="pwnetwork-label" className={LABEL}>
                Network
              </p>
              <div className="mt-1.5 flex gap-2 phone:flex-col" role="group" aria-labelledby="pwnetwork-label">
                {USDT_NETWORKS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={usdtNetwork === n}
                    disabled={disabled}
                    onClick={() => setUsdtNetwork(n)}
                    className={`min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ${
                      usdtNetwork === n ? "bg-brand/10 text-ink ring-brand" : "bg-tile text-ink-2 ring-rule"
                    }`}
                  >
                    {USDT_NETWORK_INFO[n].shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <Field
              id="pwaddr"
              label={`USDT wallet address (${USDT_NETWORK_INFO[usdtNetwork].standard})`}
              value={usdtAddress}
              onChange={(v) => setUsdtAddress(v.trim())}
              disabled={disabled}
              placeholder={usdtNetwork === "tron" ? "T…" : "0x…"}
              autoCapitalize="none"
              className={`${INPUT} font-mono text-sm`}
            />
            <p className="-mt-2 text-xs leading-relaxed text-ink-2">
              Double-check the network. USDT sent to an address on the wrong network can&apos;t be recovered.
            </p>
          </>
        )}
        {result ? <Notice ok={result.ok}>{result.text}</Notice> : null}
        <button type="submit" disabled={busy || disabled} className={PRIMARY}>
          {busy ? "Sending request…" : "Request withdrawal"}
        </button>
      </form>
    </section>
  );
}

function AmountInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <Field
      id={id}
      label="Amount (₹)"
      value={value}
      onChange={(v) => onChange(v.replace(/[^\d.]/g, ""))}
      disabled={disabled}
      inputMode="decimal"
      placeholder="0.00"
      className={`${INPUT} tabular-nums`}
    />
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  className = INPUT,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} className={className} {...rest} />
    </div>
  );
}

function MethodGlyph({ method }: { method: PayoutMethod }) {
  if (method === "USDT") return <IconTether className="size-6" />;
  if (method === "UPI") {
    return (
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M10.5 8.5l3 3.5-3 3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.5 18.5h3" strokeLinecap="round" />
      </svg>
    );
  }
  return <Icon name="bank" className="size-6" />;
}

const KIND_LABEL: Record<string, string> = {
  REFERRAL_REWARD: "Referral reward",
  AFFILIATE_DEPOSIT_REWARD: "First-deposit reward",
  REVENUE_SHARE: "Revenue Share",
  ADJUSTMENT: "Adjustment",
  TRANSFER: "To trading balance",
  WITHDRAWAL: "Withdrawal",
};

const METHOD_LABEL: Record<string, string> = { ...PAYOUT_METHOD_LABEL, TRADING_ACCOUNT: "Trading balance" };

// Pill colours mirror the withdrawal page's STATUS_PILL.
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-caution/15 text-caution" },
  HELD: { label: "On hold", cls: "bg-caution/15 text-caution" },
  AVAILABLE: { label: "Available", cls: "bg-[var(--color-up)]/15 text-[var(--color-up)]" },
  VOID: { label: "Void", cls: "bg-[var(--color-tile)] text-[var(--color-ink-2)]" },
  COMPLETED: { label: "Done", cls: "bg-[var(--color-up)]/15 text-[var(--color-up)]" },
  REQUESTED: { label: "Pending", cls: "bg-caution/15 text-caution" },
  APPROVED: { label: "Processing", cls: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]" },
  PAID: { label: "Paid", cls: "bg-[var(--color-up)]/15 text-[var(--color-up)]" },
  REJECTED: { label: "Rejected", cls: "bg-[var(--color-down)]/15 text-[var(--color-down)]" },
  CANCELLED: { label: "Cancelled", cls: "bg-[var(--color-tile)] text-[var(--color-ink-2)]" },
};

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function History({ items }: { items: ProgramActivityItem[] }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setCancelling(id);
    setError(null);
    try {
      const { ok, data } = await postJson(`/api/program/withdrawals/${encodeURIComponent(id)}/cancel`);
      if (!ok) setError(String(data.error ?? "Could not cancel that withdrawal."));
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <section aria-labelledby="program-history" className="rounded-2xl bg-panel">
      <h2 id="program-history" className="border-b border-rule px-4 py-3 text-[15px] font-semibold">
        History
      </h2>
      {error ? (
        <p role="alert" className="px-4 pt-3 text-sm text-down">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-balance px-4 py-6 text-center text-xs text-ink-2">
          No earnings yet. Rewards, transfers and withdrawals will show here.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {items.map((it) => {
            const pill = STATUS_PILL[it.status] ?? { label: it.status, cls: "bg-[var(--color-tile)] text-[var(--color-ink-2)]" };
            const method = it.method ? (METHOD_LABEL[it.method] ?? it.method) : null;
            return (
              <li key={`${it.type}:${it.id}`} className="flex min-h-14 items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums">
                    {it.amountMinor < 0 ? `−${inr(-it.amountMinor)}` : inr(it.amountMinor)}
                  </p>
                  <p className="truncate text-[11px] text-ink-2">
                    {KIND_LABEL[it.kind] ?? it.kind}
                    {method ? <span> · {method}</span> : null}
                  </p>
                  <p className="text-[11px] text-ink-3">{DATE_FMT.format(new Date(it.date))}</p>
                  {it.type === "WITHDRAWAL" && it.status === "REJECTED" && it.reason ? (
                    <p className="mt-1 text-[11px] text-down">{it.reason} — the amount is back in your available earnings.</p>
                  ) : null}
                </div>
                <div className="flex flex-none flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${pill.cls}`}>
                    {pill.label}
                  </span>
                  {it.type === "WITHDRAWAL" && it.status === "REQUESTED" ? (
                    <button
                      type="button"
                      disabled={cancelling !== null}
                      onClick={() => void cancel(it.id)}
                      aria-label={`Cancel withdrawal of ${inr(it.amountMinor)}`}
                      className="grid h-11 place-items-center rounded-[10px] bg-tile px-3 text-[13px] font-bold text-brand hover:bg-tile-hi disabled:opacity-50"
                    >
                      {cancelling === it.id ? "Cancelling…" : "Cancel"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
