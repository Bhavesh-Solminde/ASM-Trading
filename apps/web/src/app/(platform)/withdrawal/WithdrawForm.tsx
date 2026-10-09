"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PAYOUT_METHOD_LABEL,
  PayoutDetailsSchema,
  USDT_NETWORK_INFO,
  USDT_NETWORKS,
  payoutDestinationLabel,
  withdrawalLimitsMinor,
  type PayoutDetails,
  type PayoutMethod,
  type UsdtNetwork,
} from "@asm/contracts";
import { certificateHtml, type CertificateData } from "@/lib/certificate";
import { currencySymbol, formatMinor } from "@/lib/format-money";
import { IconTether } from "@/components/trade/AssetIcon";
import { usePlatform } from "@/components/shell/PlatformProvider";

/** The user's most recent details per payout method, used to prefill the form. */
export interface LastPayouts {
  BANK?: { accountHolder: string; accountNumber: string; ifsc: string };
  UPI?: { upiId: string };
  USDT?: { usdtNetwork: UsdtNetwork; usdtAddress: string };
}

interface Receipt {
  id: string;
  status: string;
  amount: number;
  payout: PayoutDetails;
  certificate: CertificateData | null;
  emailed: boolean;
}

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]";
const INPUT =
  "mt-1 w-full rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)] phone:text-base";

export function WithdrawForm({
  accountId,
  currency,
  withdrawableMinor,
  lastPayouts,
  kycName,
}: {
  accountId: string;
  currency: string;
  withdrawableMinor: number;
  lastPayouts: LastPayouts;
  /** Verified name, prefilled as the bank account holder. */
  kycName: string;
}) {
  const router = useRouter();
  const { applyBalanceUpdate } = usePlatform();
  const limits = withdrawalLimitsMinor(currency);
  const maxMinor = Math.min(limits.max, withdrawableMinor);
  const sym = currencySymbol(currency);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("BANK");
  const [accountHolder, setAccountHolder] = useState(lastPayouts.BANK?.accountHolder ?? kycName);
  const [accountNumber, setAccountNumber] = useState(lastPayouts.BANK?.accountNumber ?? "");
  const [confirmNumber, setConfirmNumber] = useState(lastPayouts.BANK?.accountNumber ?? "");
  const [ifsc, setIfsc] = useState(lastPayouts.BANK?.ifsc ?? "");
  const [upiId, setUpiId] = useState(lastPayouts.UPI?.upiId ?? "");
  const [usdtNetwork, setUsdtNetwork] = useState<UsdtNetwork>(lastPayouts.USDT?.usdtNetwork ?? "tron");
  const [usdtAddress, setUsdtAddress] = useState(lastPayouts.USDT?.usdtAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const amountMinor = Math.round((Number.parseFloat(amount) || 0) * 100);
  /** Money without a trailing ".00" — limits and chips read as "₹700", not "₹700.00". */
  const whole = (minor: number) => formatMinor(minor, currency).replace(/\.00$/, "");

  const chips = [limits.min, limits.min * 2, Math.round(limits.max / 10)].filter(
    (v, i, all) => v <= maxMinor && all.indexOf(v) === i,
  );

  function payoutDetails(): PayoutDetails | string {
    if (method === "BANK" && accountNumber.trim() !== confirmNumber.trim()) {
      return "The account numbers don't match.";
    }
    const raw =
      method === "BANK"
        ? { method, accountHolder, accountNumber, ifsc }
        : method === "UPI"
          ? { method, upiId }
          : { method, usdtNetwork, usdtAddress };
    const parsed = PayoutDetailsSchema.safeParse(raw);
    return parsed.success ? parsed.data : (parsed.error.issues[0]?.message ?? "Check the payout details.");
  }

  function validateAmount(): string | null {
    if (amountMinor <= 0) return "Enter the amount to withdraw.";
    if (amountMinor < limits.min) return `The minimum withdrawal is ${whole(limits.min)}.`;
    if (amountMinor > limits.max) return `The maximum withdrawal is ${whole(limits.max)} per request.`;
    if (amountMinor > withdrawableMinor) return "That is more than your available balance.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountError = validateAmount();
    if (amountError) return setError(amountError);
    const payout = payoutDetails();
    if (typeof payout === "string") return setError(payout);

    setBusy(true);
    try {
      const res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, amount: amountMinor, payout }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        certificate?: CertificateData;
        emailed?: boolean;
        balance?: { realBalance: number; bonusBalance: number } | null;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not request that withdrawal.");
        return;
      }
      // Debit landed server-side; push the fresh balance into the platform
      // context so the TopBar drops in the same tick as the receipt.
      if (data.balance) applyBalanceUpdate(accountId, data.balance);
      setReceipt({
        id: data.id ?? "",
        status: data.status ?? "REQUESTED",
        amount: amountMinor,
        payout,
        certificate: data.certificate ?? null,
        emailed: Boolean(data.emailed),
      });
      // Re-render the server parts (balance, history) behind the receipt.
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <WithdrawReceipt
        receipt={receipt}
        currency={currency}
        onDone={() => {
          setReceipt(null);
          setAmount("");
        }}
      />
    );
  }

  if (withdrawableMinor < limits.min) {
    return (
      <div className="flex flex-col gap-2 rounded border border-[var(--color-rule)] bg-[var(--color-tile)] p-4">
        <p className="text-sm font-semibold">Not enough to withdraw yet</p>
        <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">
          The minimum withdrawal is {whole(limits.min)}. You have{" "}
          {formatMinor(Math.max(withdrawableMinor, 0), currency)} available. Bonus funds can&apos;t be
          withdrawn.
        </p>
        <a
          href="/deposit"
          className="self-start text-xs font-bold text-[var(--color-up)] underline underline-offset-4 phone:py-2"
        >
          Make a deposit
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} onChange={() => setError(null)} noValidate className="flex flex-col gap-5">
      {/* 1 — Amount */}
      <div>
        <label htmlFor="wamount" className={LABEL}>
          Amount to withdraw
        </label>
        <div className="mt-1 flex items-center gap-2 rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-3 focus-within:border-[var(--color-brand)]">
          <span className="text-base font-semibold text-[var(--color-ink-2)]">{sym}</span>
          <input
            id="wamount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="min-w-0 flex-1 bg-transparent py-3 text-lg font-semibold tabular-nums outline-none"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {chips.map((v) => (
            <Chip key={v} onClick={() => setAmount(String(v / 100))}>
              {whole(v)}
            </Chip>
          ))}
          <Chip onClick={() => setAmount(String(Math.floor(maxMinor) / 100))}>Max</Chip>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-ink-2)]">
          Min {whole(limits.min)} · Max {whole(limits.max)} per request · Available{" "}
          <span className="font-semibold tabular-nums text-[var(--color-ink)]">
            {formatMinor(withdrawableMinor, currency)}
          </span>
        </p>
      </div>

      {/* 2 — Method */}
      <div>
        <p className={LABEL}>Receive money by</p>
        <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payout method">
          {(["BANK", "UPI", "USDT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => {
                setMethod(m);
                setError(null);
              }}
              className={`flex flex-col items-center gap-1.5 rounded border px-2 py-3 text-xs font-semibold transition-colors ${
                method === m
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-ink)]"
                  : "border-[var(--color-rule)] bg-[var(--color-tile)] text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)]"
              }`}
            >
              <MethodGlyph method={m} />
              {PAYOUT_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {/* 3 — Details */}
      <div className="flex flex-col gap-3">
        {method === "BANK" ? (
          <>
            <Field id="wholder" label="Account holder name" value={accountHolder} onChange={setAccountHolder} autoComplete="name" placeholder="As on your bank account" />
            <Field id="wacct" label="Account number" value={accountNumber} onChange={(v) => setAccountNumber(v.replace(/\D/g, ""))} inputMode="numeric" placeholder="Bank account number" />
            <Field id="wacct2" label="Confirm account number" value={confirmNumber} onChange={(v) => setConfirmNumber(v.replace(/\D/g, ""))} inputMode="numeric" placeholder="Re-enter the account number" />
            <Field id="wifsc" label="IFSC code" value={ifsc} onChange={(v) => setIfsc(v.toUpperCase().replace(/\s/g, ""))} placeholder="e.g. HDFC0001234" maxLength={11} />
          </>
        ) : method === "UPI" ? (
          <Field id="wupi" label="UPI ID" value={upiId} onChange={(v) => setUpiId(v.trim())} placeholder="name@okicici or 9876543210@ybl" autoCapitalize="none" />
        ) : (
          <>
            <div>
              <p className={LABEL}>Network</p>
              <div className="mt-1 flex gap-2 phone:flex-col">
                {USDT_NETWORKS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={usdtNetwork === n}
                    onClick={() => setUsdtNetwork(n)}
                    className={`flex-1 rounded border px-3 py-2 text-xs font-semibold phone:py-2.5 phone:text-sm ${
                      usdtNetwork === n
                        ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10"
                        : "border-[var(--color-rule)] bg-[var(--color-tile)] text-[var(--color-ink-2)]"
                    }`}
                  >
                    {USDT_NETWORK_INFO[n].shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <Field
              id="waddr"
              label={`USDT wallet address (${USDT_NETWORK_INFO[usdtNetwork].standard})`}
              value={usdtAddress}
              onChange={(v) => setUsdtAddress(v.trim())}
              placeholder={usdtNetwork === "tron" ? "T…" : "0x…"}
              autoCapitalize="none"
              mono
            />
            <p className="-mt-1 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
              Double-check the network. USDT sent to an address on the wrong network can&apos;t be recovered.
            </p>
          </>
        )}
      </div>

      {/* 4 — Summary */}
      <div className="flex flex-col gap-1.5 rounded border border-dashed border-[var(--color-rule)] p-3 text-xs">
        <div className="flex justify-between text-[var(--color-ink-2)]">
          <span>Withdrawal amount</span>
          <span className="tabular-nums">{formatMinor(amountMinor, currency)}</span>
        </div>
        <div className="flex justify-between text-[var(--color-ink-2)]">
          <span>Fee</span>
          <span className="tabular-nums">{formatMinor(0, currency)}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-[var(--color-rule)] pt-2 text-sm">
          <span className="font-semibold">You will receive</span>
          <span className="font-bold tabular-nums text-[var(--color-up)]">
            {method === "USDT"
              ? `USDT worth ${formatMinor(amountMinor, currency)}`
              : formatMinor(amountMinor, currency)}
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-ink-3)]">Processed within 5–10 hours after review.</p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-[var(--color-down)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-[var(--color-brand)] px-4 py-3 text-sm font-bold text-[var(--color-brand-ink)] disabled:opacity-60"
      >
        {busy ? "Sending request…" : "Request withdrawal"}
      </button>
    </form>
  );
}

function WithdrawReceipt({
  receipt,
  currency,
  onDone,
}: {
  receipt: Receipt;
  currency: string;
  onDone: () => void;
}) {
  const [showCert, setShowCert] = useState(false);
  const cert = receipt.certificate;
  const certDoc = cert
    ? `<!doctype html><html><head><meta charset="utf-8"><title>IndianxTrade certificate</title></head><body style="margin:0;padding:20px;background:#000;">${certificateHtml(cert)}</body></html>`
    : "";
  const held = receipt.status === "HELD";

  function downloadCertificate() {
    if (!cert) return;
    const blob = new Blob([certDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `indianxtrade-certificate-${cert.refId}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--color-up)]/15 text-[var(--color-up)]">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-base font-bold">Withdrawal requested</p>
        <p className="text-2xl font-bold tabular-nums">{formatMinor(receipt.amount, currency)}</p>
      </div>

      <dl className="grid gap-2 rounded border border-[var(--color-rule)] bg-[var(--color-tile)] p-3 text-xs">
        <Row label="Method" value={PAYOUT_METHOD_LABEL[receipt.payout.method]} />
        <Row label="To" value={payoutDestinationLabel(receipt.payout) ?? "—"} mono />
        <Row label="Status" value={held ? "On hold (first withdrawal)" : "Pending review"} />
        <Row label="Reference" value={receipt.id.slice(0, 8).toUpperCase()} mono />
      </dl>

      <p className="text-xs leading-relaxed text-[var(--color-ink-2)]">
        {held
          ? "Your first withdrawal sits on a short safety hold, then goes to review. You can cancel it from this page while the cancel window is open."
          : "Our team reviews it and sends the money within 5–10 hours. You can follow its status below."}
        {receipt.emailed ? " A certificate has been emailed to you." : ""}
      </p>

      {cert ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCert((v) => !v)}
            className="rounded border border-[var(--color-rule)] px-3 py-2 text-xs font-semibold"
          >
            {showCert ? "Hide certificate" : "View certificate"}
          </button>
          <button
            type="button"
            onClick={downloadCertificate}
            className="rounded border border-[var(--color-brand)] px-3 py-2 text-xs font-semibold text-[var(--color-brand)]"
          >
            Download certificate
          </button>
        </div>
      ) : null}
      {cert && showCert ? (
        <iframe
          title="Withdrawal certificate"
          srcDoc={certDoc}
          sandbox=""
          className="h-[360px] w-full rounded border border-[var(--color-rule)] bg-black"
        />
      ) : null}

      <button
        type="button"
        onClick={onDone}
        className="rounded bg-[var(--color-brand)] px-4 py-3 text-sm font-bold text-[var(--color-brand-ink)]"
      >
        Done
      </button>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-ink-2)]">{label}</dt>
      <dd className={`min-w-0 truncate text-right font-semibold ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-1 py-1.5 text-xs font-semibold tabular-nums hover:border-[var(--color-brand)] phone:py-2.5"
    >
      {children}
    </button>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  mono = false,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={`${INPUT} ${mono ? "font-mono text-xs phone:text-sm" : ""}`}
        {...rest}
      />
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
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M3 9.5L12 4l9 5.5" strokeLinejoin="round" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18" strokeLinecap="round" />
    </svg>
  );
}
