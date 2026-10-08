"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS, UsdtNetwork } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";
import { UsdtAmountStep } from "@/components/deposit/UsdtAmountStep";
import { DepositBonusStrip } from "@/components/deposit/DepositBonusStrip";
import { bonusPercentForDeposit } from "@/lib/bonus";

type Method = (typeof DEPOSIT_METHODS)[number];

/**
 * `usdtNetworks` is computed server-side from the live receiving config (only
 * networks a watcher is actually watching); an empty list hides USDT entirely.
 */
export function DepositFlow({
  usdtNetworks,
  usdtGateway,
  upiEnabled,
  completedDeposits,
}: {
  usdtNetworks: UsdtNetwork[];
  /** Tatum payment gateway active (per-deposit address) vs the manual shared-address flow. */
  usdtGateway: boolean;
  /** INR (UPI) rails open — see upiDepositsEnabled(). */
  upiEnabled: boolean;
  /** Deposits already credited — the next one's bonus tier follows from it. */
  completedDeposits: number;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const bonusPercent = bonusPercentForDeposit(completedDeposits + 1);

  let step: React.ReactNode;
  if (method === null) {
    step = <MethodPicker onPick={setMethod} usdtEnabled={usdtNetworks.length > 0} upiEnabled={upiEnabled} />;
  } else if (method === "USDT" && usdtNetworks.length > 0) {
    step = (
      <UsdtAmountStep
        networks={usdtNetworks}
        gateway={usdtGateway}
        onBack={() => setMethod(null)}
        bonusPercent={bonusPercent}
      />
    );
  } else if (method === "USDT") {
    step = <MethodPicker onPick={setMethod} usdtEnabled={false} upiEnabled={upiEnabled} />;
  } else {
    step = <AmountStep method={method} onBack={() => setMethod(null)} bonusPercent={bonusPercent} />;
  }

  return (
    <>
      <DepositBonusStrip completedDeposits={completedDeposits} />
      {step}
    </>
  );
}
