"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEPOSIT_METHODS, UPI_METHODS, type UsdtNetwork } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";
import { UsdtAmountStep } from "@/components/deposit/UsdtAmountStep";
import { BonusPreview } from "@/components/deposit/BonusPreview";
import { formatInr, overallLimits } from "@/components/deposit/limits";
import { AmountField, type AmountFieldHandle } from "@/components/payments/AmountField";
import { StepHeader } from "@/components/payments/StepHeader";
import { SummaryCard } from "@/components/payments/SummaryCard";
import { Icon } from "@/components/shell/Icon";
import { bonusPercentForDeposit } from "@/lib/bonus";

type Method = (typeof DEPOSIT_METHODS)[number];
type Step = 1 | 2 | 3;

const UPI_SET = new Set<string>(UPI_METHODS);
const QUICK = [500, 1000, 2000, 5000];
const STEP_NAME: Record<Step, string> = { 1: "Amount", 2: "Method", 3: "Pay" };

/**
 * Three steps: amount, method, pay. The amount comes first so the bonus can be
 * shown for it and the method list can say which rails take it; the last step
 * hands the amount to the existing per-method screens, which start the deposit
 * through the same API as before.
 *
 * `usdtNetworks` is computed server-side from the live receiving config (only
 * networks a watcher is actually watching); an empty list hides USDT entirely.
 */
export function DepositFlow({
  usdtNetworks,
  gatewayNetworks,
  upiEnabled,
  completedDeposits,
}: {
  usdtNetworks: UsdtNetwork[];
  /** Networks on the Tatum gateway (per-deposit address); the rest use the manual shared-address flow. */
  gatewayNetworks: UsdtNetwork[];
  /** INR (UPI) rails open — see upiDepositsEnabled(). */
  upiEnabled: boolean;
  /** Deposits already credited — the next one's bonus tier follows from it. */
  completedDeposits: number;
}) {
  const [step, setStep] = useState<Step>(1);
  const [amount, setAmount] = useState("1000");
  const [method, setMethod] = useState<Method | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const fieldRef = useRef<AmountFieldHandle | null>(null);
  const stepLabelRef = useRef<HTMLParagraphElement | null>(null);
  const firstRender = useRef(true);

  const usdtEnabled = usdtNetworks.length > 0;
  const bonusPercent = bonusPercentForDeposit(completedDeposits + 1);

  // Bounds for step 1: the loosest limits among rails that can take a deposit
  // today. Per-method limits are applied on step 2.
  const limits = useMemo(() => {
    const usable = DEPOSIT_METHODS.filter((m) => (m === "USDT" ? usdtEnabled : upiEnabled || !UPI_SET.has(m)));
    return overallLimits(usable.length > 0 ? usable : DEPOSIT_METHODS.filter((m) => m !== "USDT" || usdtEnabled));
  }, [usdtEnabled, upiEnabled]);

  const amountInr = amount === "" ? 0 : Number(amount);

  function problem(n: number): string | null {
    if (!Number.isFinite(n) || n <= 0) return "Enter the amount to deposit.";
    if (n < limits.min) return `The minimum deposit is ${formatInr(limits.min)}.`;
    if (n > limits.max) return `The maximum deposit is ${formatInr(limits.max)} per payment.`;
    return null;
  }

  // Move focus to the step label when the step changes (not on first paint),
  // so a screen reader announces "Step 2 of 3" and keyboard users land at the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepLabelRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  function setAmountValue(next: string) {
    setAmount(next);
    // After a failed Continue, keep the message in step with what's typed.
    if (amountError) setAmountError(problem(next === "" ? 0 : Number(next)));
  }

  function toMethod(e?: React.FormEvent) {
    e?.preventDefault();
    const p = problem(amountInr);
    if (p) {
      setAmountError(p);
      fieldRef.current?.focus();
      return;
    }
    setAmountError(null);
    setStep(2);
  }

  function pickMethod(m: Method) {
    setMethod(m);
    setStep(3);
  }

  // Step 3 needs a method that can actually be paid; fall back to the list otherwise.
  const payable = method !== null && (method !== "USDT" || usdtEnabled);
  const shown: Step = step === 3 && !payable ? 2 : step;

  let body: React.ReactNode;
  if (shown === 1) {
    body = (
      <form onSubmit={toMethod} noValidate className="flex flex-col gap-6">
        <div className="pt-6 phone:pt-10">
          <AmountField
            id="deposit-amount"
            label="How much do you want to add?"
            symbol="₹"
            value={amount}
            onChange={setAmountValue}
            decimals={false}
            error={amountError}
            errorId="deposit-amount-error"
            hint={`Min ${formatInr(limits.min)} · Max ${formatInr(limits.max)} per payment`}
            handle={fieldRef}
          />
        </div>

        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
          {QUICK.map((v) => {
            const selected = amountInr === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={selected}
                onClick={() => setAmountValue(String(v))}
                className={`h-11 rounded-full text-sm font-bold tabular-nums ${
                  selected ? "bg-brand-fill text-white" : "bg-tile text-ink-2 hover:text-ink"
                }`}
              >
                {formatInr(v)}
              </button>
            );
          })}
        </div>

        {bonusPercent > 0 ? (
          <BonusPreview amountInr={Number.isFinite(amountInr) ? amountInr : 0} completedDeposits={completedDeposits} />
        ) : null}

        <div>
          <button
            type="submit"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-fill text-base font-bold text-white hover:bg-brand-fill-hi"
          >
            Continue &middot; choose method
            <Icon name="chevron" className="size-[18px]" />
          </button>
          <p className="mt-2.5 text-center text-xs text-ink-3">
            Next: {usdtEnabled ? "UPI, PhonePe, GPay, PayTM or USDT" : "UPI, PhonePe, GPay or PayTM"}
          </p>
        </div>
      </form>
    );
  } else if (shown === 2) {
    body = (
      <div className="flex flex-col gap-4">
        <SummaryCard
          rows={[
            {
              label: "Amount",
              value: formatInr(amountInr),
              change: { label: "Change amount", onClick: () => setStep(1) },
            },
          ]}
        />
        <MethodPicker onPick={pickMethod} amountInr={amountInr} usdtEnabled={usdtEnabled} upiEnabled={upiEnabled} />
      </div>
    );
  } else if (method === "USDT") {
    body = (
      <UsdtAmountStep
        networks={usdtNetworks}
        gatewayNetworks={gatewayNetworks}
        amountInr={amountInr}
        onBack={() => setStep(2)}
        onChangeAmount={() => setStep(1)}
        bonusPercent={bonusPercent}
      />
    );
  } else {
    body = (
      <AmountStep
        method={method as string}
        amountInr={amountInr}
        onBack={() => setStep(2)}
        onChangeAmount={() => setStep(1)}
        bonusPercent={bonusPercent}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <StepHeader
        ref={stepLabelRef}
        title="Deposit"
        step={shown}
        stepName={STEP_NAME[shown]}
        backLabel={shown === 1 ? "Back to trading" : shown === 2 ? "Back to amount" : "Back to payment methods"}
        backHref={shown === 1 ? "/trade" : undefined}
        onBack={shown === 1 ? undefined : () => setStep((shown - 1) as Step)}
      />
      {body}
    </div>
  );
}
