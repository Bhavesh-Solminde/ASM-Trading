"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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
import { certificateHtml, type CertificateData } from "@asm/mail/templates";
import { currencySymbol, formatMinor } from "@asm/client-core";
import { focusStep } from "@/lib/focus-step";
import { IconTether } from "@/components/trade/AssetIcon";
import { Icon } from "@/components/shell/Icon";
import { usePlatform } from "@/components/shell/PlatformProvider";
import { AmountField, type AmountFieldHandle } from "@/components/payments/AmountField";
import { StepHeader } from "@/components/payments/StepHeader";
import type { LastPayouts } from "@/lib/withdrawal-prefill";

/** The user's most recent details per payout method, used to prefill the form. */
export type { LastPayouts };

interface Receipt {
  id: string;
  status: string;
  amount: number;
  payout: PayoutDetails;
  certificate: CertificateData | null;
  emailed: boolean;
}

type Step = 1 | 2 | 3;
const STEP_NAME: Record<Step, string> = { 1: "Amount", 2: "Where to", 3: "Review" };

/** Which input a schema problem belongs to, so it can be shown there and focused. */
const FIELD_ID = {
  accountHolder: "wholder",
  accountNumber: "wacct",
  ifsc: "wifsc",
  upiId: "wupi",
  usdtAddress: "waddr",
} as const;

const LABEL = "text-[13px] font-semibold text-ink-2";
const INPUT =
  "mt-1.5 h-12 w-full rounded-xl bg-tile px-3.5 text-base ring-1 ring-rule placeholder:text-ink-3 focus:ring-brand aria-[invalid=true]:ring-down";
const PRIMARY =
  "h-14 w-full rounded-2xl bg-brand-fill text-base font-bold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-50";

export function WithdrawForm({
  accountId,
  currency,
  withdrawableMinor,
  lastPayouts,
  initialMethod,
  kycName,
  summary,
}: {
  accountId: string;
  currency: string;
  withdrawableMinor: number;
  /** Details of the user's latest withdrawal for each payout method, to prefill step 2. */
  lastPayouts: LastPayouts;
  /** Method of the user's most recent withdrawal; preselected on step 2. */
  initialMethod: PayoutMethod | null;
  /** Verified name, prefilled as the bank account holder. */
  kycName: string;
  /** Balance panel, shown on step 1 only. */
  summary?: ReactNode;
}) {
  const router = useRouter();
  const { applyBalanceUpdate } = usePlatform();
  const limits = withdrawalLimitsMinor(currency);
  const maxMinor = Math.min(limits.max, withdrawableMinor);
  const sym = currencySymbol(currency);

  const [step, setStep] = useState<Step>(1);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>(initialMethod ?? "BANK");
  const [accountHolder, setAccountHolder] = useState(lastPayouts.BANK?.accountHolder ?? kycName);
  const [accountNumber, setAccountNumber] = useState(lastPayouts.BANK?.accountNumber ?? "");
  // Prefilled together with the number it confirms: it is a known-good saved
  // account, and editing either field re-triggers the match check.
  const [confirmNumber, setConfirmNumber] = useState(lastPayouts.BANK?.accountNumber ?? "");
  const [ifsc, setIfsc] = useState(lastPayouts.BANK?.ifsc ?? "");
  const [upiId, setUpiId] = useState(lastPayouts.UPI?.upiId ?? "");
  const [usdtNetwork, setUsdtNetwork] = useState<UsdtNetwork>(lastPayouts.USDT?.usdtNetwork ?? "tron");
  const [usdtAddress, setUsdtAddress] = useState(lastPayouts.USDT?.usdtAddress ?? "");
  /** Problem with the amount (step 1). */
  const [amountError, setAmountError] = useState<string | null>(null);
  /** Problems with payout fields (step 2), keyed by input id; "" is a problem with no single field. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Submit problem (step 3). */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const fieldRef = useRef<AmountFieldHandle | null>(null);
  const stepLabelRef = useRef<HTMLParagraphElement | null>(null);
  const firstRender = useRef(true);

  const amountMinor = Math.round((Number.parseFloat(amount) || 0) * 100);
  /** Money without a trailing ".00" — limits and chips read as "₹700", not "₹700.00". */
  const whole = (minor: number) => formatMinor(minor, currency).replace(/\.00$/, "");

  const chips = [limits.min, limits.min * 2, Math.round(limits.max / 10)].filter(
    (v, i, all) => v <= maxMinor && all.indexOf(v) === i,
  );

  // Move focus to the step label when the step changes (not on first paint).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    focusStep(stepLabelRef.current);
  }, [step]);

  function amountProblem(minor: number): string | null {
    if (minor <= 0) return "Enter the amount to withdraw.";
    if (minor < limits.min) return `The minimum withdrawal is ${whole(limits.min)}.`;
    if (minor > limits.max) return `The maximum withdrawal is ${whole(limits.max)} per request.`;
    if (minor > withdrawableMinor) return "That is more than your available balance.";
    return null;
  }

  function setAmountValue(next: string) {
    setAmount(next);
    if (amountError) setAmountError(amountProblem(Math.round((Number.parseFloat(next) || 0) * 100)));
  }

  function toDestination(e?: React.FormEvent) {
    e?.preventDefault();
    const problem = amountProblem(amountMinor);
    if (problem) {
      setAmountError(problem);
      fieldRef.current?.focus();
      return;
    }
    setAmountError(null);
    setStep(2);
  }

  /** The payout details if valid, otherwise the first invalid field's id ("" when none) and message. */
  function checkPayout(): { ok: PayoutDetails } | { id: string; message: string } {
    const raw =
      method === "BANK"
        ? { method, accountHolder, accountNumber, ifsc }
        : method === "UPI"
          ? { method, upiId }
          : { method, usdtNetwork, usdtAddress };
    const parsed = PayoutDetailsSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = String(issue?.path[0] ?? "") as keyof typeof FIELD_ID;
      return { id: FIELD_ID[key] ?? "", message: issue?.message ?? "Check the payout details." };
    }
    if (method === "BANK" && accountNumber.trim() !== confirmNumber.trim()) {
      return { id: "wacct2", message: "The account numbers don't match." };
    }
    return { ok: parsed.data };
  }

  function toReview(e?: React.FormEvent) {
    e?.preventDefault();
    const result = checkPayout();
    if ("ok" in result) {
      setFieldErrors({});
      setStep(3);
      return;
    }
    setFieldErrors({ [result.id]: result.message });
    if (result.id) {
      const el = document.getElementById(result.id);
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    }
  }

  function clearFieldError(id: string) {
    setFieldErrors((prev) => {
      if (!(id in prev)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  }

  async function submit() {
    setError(null);
    // Re-check everything: the review step trusts earlier steps, the API does not.
    const problem = amountProblem(amountMinor);
    if (problem) {
      setStep(1);
      setAmountError(problem);
      return;
    }
    const result = checkPayout();
    if (!("ok" in result)) {
      setStep(2);
      setFieldErrors({ [result.id]: result.message });
      return;
    }
    const payout = result.ok;

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
          setStep(1);
        }}
      />
    );
  }

  if (withdrawableMinor < limits.min) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        {summary}
        <div className="flex flex-col gap-2 rounded-2xl bg-panel p-4 ring-1 ring-rule">
          <p className="text-sm font-semibold">Not enough to withdraw yet</p>
          <p className="text-xs leading-relaxed text-ink-2">
            The minimum withdrawal is {whole(limits.min)}. You have{" "}
            {formatMinor(Math.max(withdrawableMinor, 0), currency)} available. Bonus funds can&apos;t be withdrawn.
          </p>
          <Link
            href="/deposit"
            className="inline-flex min-h-11 items-center self-start text-xs font-bold text-up underline underline-offset-4"
          >
            Make a deposit
          </Link>
        </div>
      </div>
    );
  }

  let body: ReactNode;
  if (step === 1) {
    body = (
      <form onSubmit={toDestination} noValidate className="flex flex-col gap-6">
        <div className="pt-4 phone:pt-8">
          <AmountField
            id="wamount"
            label="How much do you want to withdraw?"
            symbol={sym}
            value={amount}
            onChange={setAmountValue}
            decimals
            error={amountError}
            errorId="wamount-error"
            hint={`Min ${whole(limits.min)} · Max ${whole(limits.max)} per request`}
            handle={fieldRef}
          />
        </div>

        <div className="flex gap-2" role="group" aria-label="Quick amounts">
          {chips.map((v) => (
            <Chip key={v} selected={amountMinor === v} onClick={() => setAmountValue(String(v / 100))}>
              {whole(v)}
            </Chip>
          ))}
          <Chip selected={amountMinor > 0 && amountMinor === Math.floor(maxMinor)} onClick={() => setAmountValue(String(Math.floor(maxMinor) / 100))}>
            Max
          </Chip>
        </div>

        {summary}

        <button type="submit" className={`${PRIMARY} flex items-center justify-center gap-2`}>
          Continue &middot; where to send
          <Icon name="chevron" className="size-[18px]" />
        </button>
      </form>
    );
  } else if (step === 2) {
    body = (
      <form onSubmit={toReview} noValidate className="flex flex-col gap-6">
        <div>
          <p id="wmethod-label" className={LABEL}>
            Receive money by
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="wmethod-label">
            {(["BANK", "UPI", "USDT"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => {
                  setMethod(m);
                  setFieldErrors({});
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-xs font-semibold ring-1 transition-colors motion-reduce:transition-none ${
                  method === m
                    ? "bg-brand/10 text-ink ring-brand"
                    : "bg-tile text-ink-2 ring-rule hover:ring-ink-3"
                }`}
              >
                <MethodGlyph method={m} />
                {PAYOUT_METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {method === "BANK" ? (
            <>
              <Field id="wholder" label="Account holder name" value={accountHolder} onChange={setAccountHolder} error={fieldErrors.wholder} onEdit={clearFieldError} autoComplete="name" placeholder="As on your bank account" />
              <Field id="wacct" label="Account number" value={accountNumber} onChange={(v) => setAccountNumber(v.replace(/\D/g, ""))} error={fieldErrors.wacct} onEdit={clearFieldError} inputMode="numeric" placeholder="Bank account number" />
              <Field id="wacct2" label="Confirm account number" value={confirmNumber} onChange={(v) => setConfirmNumber(v.replace(/\D/g, ""))} error={fieldErrors.wacct2} onEdit={clearFieldError} inputMode="numeric" placeholder="Re-enter the account number" />
              <Field id="wifsc" label="IFSC code" value={ifsc} onChange={(v) => setIfsc(v.toUpperCase().replace(/\s/g, ""))} error={fieldErrors.wifsc} onEdit={clearFieldError} placeholder="e.g. HDFC0001234" maxLength={11} />
            </>
          ) : method === "UPI" ? (
            <Field id="wupi" label="UPI ID" value={upiId} onChange={(v) => setUpiId(v.trim())} error={fieldErrors.wupi} onEdit={clearFieldError} placeholder="name@okicici or 9876543210@ybl" autoCapitalize="none" />
          ) : (
            <>
              <div>
                <p id="wnetwork-label" className={LABEL}>
                  Network
                </p>
                <div className="mt-1.5 flex gap-2 phone:flex-col" role="group" aria-labelledby="wnetwork-label">
                  {USDT_NETWORKS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={usdtNetwork === n}
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
                id="waddr"
                label={`USDT wallet address (${USDT_NETWORK_INFO[usdtNetwork].standard})`}
                value={usdtAddress}
                onChange={(v) => setUsdtAddress(v.trim())}
                error={fieldErrors.waddr}
                onEdit={clearFieldError}
                placeholder={usdtNetwork === "tron" ? "T…" : "0x…"}
                autoCapitalize="none"
                mono
              />
              <p className="-mt-2 text-xs leading-relaxed text-ink-2">
                Double-check the network. USDT sent to an address on the wrong network can&apos;t be recovered.
              </p>
            </>
          )}
        </div>

        {fieldErrors[""] ? (
          <p role="alert" className="text-xs text-down">
            {fieldErrors[""]}
          </p>
        ) : null}

        <button type="submit" className={`${PRIMARY} flex items-center justify-center gap-2`}>
          Review withdrawal
          <Icon name="chevron" className="size-[18px]" />
        </button>
      </form>
    );
  } else {
    const dest = destinationCard(method, { accountHolder, accountNumber, ifsc, upiId, usdtNetwork, usdtAddress });
    body = (
      <div className="flex flex-col gap-4">
        <div className="grid justify-items-center gap-1 pt-3 phone:pt-6">
          <p className="text-[13px] text-ink-2">You&apos;re withdrawing</p>
          <p className="text-5xl font-extrabold tabular-nums tracking-[-0.035em]">{whole(amountMinor)}</p>
        </div>

        <div className="overflow-hidden rounded-2xl bg-panel">
          <div className="flex items-center gap-3 p-4">
            <span className="grid size-11 flex-none place-items-center rounded-xl bg-tile text-ink">
              <MethodGlyph method={method} />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-[15px] font-bold">{dest.title}</span>
              <span className="truncate text-xs text-ink-2">{dest.detail}</span>
            </span>
            <button
              type="button"
              onClick={() => setStep(2)}
              aria-label="Change payout details"
              className="ml-auto grid h-11 flex-none place-items-center rounded-[10px] bg-tile px-3 text-[13px] font-bold text-brand hover:bg-tile-hi"
            >
              Change
            </button>
          </div>
          <div aria-hidden className="h-px bg-tile" />
          <dl className="grid gap-2.5 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">Amount</dt>
              <dd className="tabular-nums">{formatMinor(amountMinor, currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-2">Fee</dt>
              <dd className="tabular-nums">{formatMinor(0, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-dashed border-rule pt-2.5 font-extrabold">
              <dt>You receive</dt>
              <dd className="text-right tabular-nums text-up">
                {method === "USDT" ? `USDT worth ${formatMinor(amountMinor, currency)}` : formatMinor(amountMinor, currency)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex items-start gap-2.5 rounded-[14px] bg-panel p-3.5 text-[13px] leading-normal text-ink-2">
          <Icon name="clock" className="mt-px size-[18px] flex-none" />
          <p>Processed within 5–10 hours after review. You can follow every step in History.</p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-down">
            {error}
          </p>
        ) : null}

        <button type="button" disabled={busy} onClick={() => void submit()} className={PRIMARY}>
          {busy ? "Sending request…" : "Confirm withdrawal"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <StepHeader
        ref={stepLabelRef}
        title="Withdraw"
        step={step}
        stepName={STEP_NAME[step]}
        backLabel={step === 1 ? "Back to trading" : step === 2 ? "Back to amount" : "Back to payout details"}
        backHref={step === 1 ? "/trade" : undefined}
        onBack={step === 1 ? undefined : () => setStep((step - 1) as Step)}
      />
      {body}
    </div>
  );
}

/** Title and detail lines for the destination card on the review step. */
function destinationCard(
  method: PayoutMethod,
  v: {
    accountHolder: string;
    accountNumber: string;
    ifsc: string;
    upiId: string;
    usdtNetwork: UsdtNetwork;
    usdtAddress: string;
  },
): { title: string; detail: string } {
  if (method === "BANK") {
    return { title: `Bank account •••• ${v.accountNumber.trim().slice(-4)}`, detail: `${v.accountHolder.trim()} · IFSC ${v.ifsc.trim()}` };
  }
  if (method === "UPI") return { title: v.upiId.trim(), detail: "UPI" };
  const addr = v.usdtAddress.trim();
  return {
    title: `USDT (${USDT_NETWORK_INFO[v.usdtNetwork].standard})`,
    detail: `${addr.slice(0, 8)}…${addr.slice(-6)}`,
  };
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
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const cert = receipt.certificate;
  const certDoc = cert
    ? `<!doctype html><html><head><meta charset="utf-8"><title>IndianxTrade certificate</title></head><body style="margin:0;padding:20px;background:#000;">${certificateHtml(cert)}</body></html>`
    : "";
  const held = receipt.status === "HELD";
  const dest = payoutDestinationLabel(receipt.payout);
  const trackHref = receipt.id ? `/history?tx=w:${receipt.id}` : "/history?filter=withdrawals";

  useEffect(() => {
    focusStep(headingRef.current);
  }, []);

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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="flex flex-col items-center gap-3 px-4 pt-6 text-center phone:pt-10">
        <span className="grid size-[72px] place-items-center rounded-full bg-up/15 text-up">
          <Icon name="check" className="size-[34px]" strokeWidth={2.6} />
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="text-[22px] font-extrabold outline-none!">
          {held ? "Request received" : "Request sent"}
        </h2>
        <p className="text-3xl font-bold tabular-nums">{formatMinor(receipt.amount, currency)}</p>
        <p className="text-sm leading-relaxed text-ink-2">
          {held
            ? "Your first withdrawal sits on a short safety hold, then goes to review. You can cancel it from this page while the cancel window is open."
            : `To ${dest ?? PAYOUT_METHOD_LABEL[receipt.payout.method]}. We'll review it and pay it out — usually within 5–10 hours.`}
          {receipt.emailed ? " We've emailed you a confirmation. Your certificate follows once it's paid." : ""}
        </p>
      </div>

      <dl className="grid gap-2.5 rounded-2xl bg-panel p-4 text-sm">
        <Row label="Method" value={PAYOUT_METHOD_LABEL[receipt.payout.method]} />
        <Row label="To" value={dest ?? "—"} mono />
        <Row label="Status" value={held ? "On hold (first withdrawal)" : "Pending review"} />
        <Row label="Reference" value={receipt.id.slice(0, 8).toUpperCase() || "—"} mono />
      </dl>

      {cert ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCert((v) => !v)}
            aria-expanded={showCert}
            className="min-h-11 flex-1 rounded-xl bg-tile px-3 text-sm font-semibold hover:bg-tile-hi"
          >
            {showCert ? "Hide certificate" : "View certificate"}
          </button>
          <button
            type="button"
            onClick={downloadCertificate}
            className="min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold text-brand ring-1 ring-brand"
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
          className="h-[360px] w-full rounded-xl border border-rule bg-black"
        />
      ) : null}

      <div className="grid gap-2.5">
        <Link href={trackHref} className={`${PRIMARY} grid place-items-center`}>
          Track this withdrawal
        </Link>
        <button type="button" onClick={onDone} className="h-12 rounded-[14px] bg-tile text-[15px] font-semibold hover:bg-tile-hi">
          Done
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`min-w-0 text-right font-semibold ${mono ? "break-all font-mono text-[13px]" : "truncate"}`}>{value}</dd>
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-11 min-w-0 flex-1 rounded-full px-2 text-sm font-bold tabular-nums ${
        selected ? "bg-brand-fill text-white" : "bg-tile text-ink-2 hover:text-ink"
      }`}
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
  onEdit,
  error,
  mono = false,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Called on every edit so a shown error for this field can clear. */
  onEdit: (id: string) => void;
  error?: string | undefined;
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
        onChange={(e) => {
          onChange(e.target.value);
          onEdit(id);
        }}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${INPUT} ${mono ? "font-mono text-sm" : ""}`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-down">
          {error}
        </p>
      ) : null}
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
