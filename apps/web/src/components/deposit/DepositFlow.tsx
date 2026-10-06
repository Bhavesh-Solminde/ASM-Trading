"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS, UsdtNetwork } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";
import { UsdtAmountStep } from "@/components/deposit/UsdtAmountStep";

type Method = (typeof DEPOSIT_METHODS)[number];

/**
 * `usdtNetworks` is computed server-side from the live receiving config (only
 * networks a watcher is actually watching); an empty list hides USDT entirely.
 */
export function DepositFlow({
  usdtNetworks,
  usdtGateway,
  upiEnabled,
}: {
  usdtNetworks: UsdtNetwork[];
  /** Tatum payment gateway active (per-deposit address) vs the manual shared-address flow. */
  usdtGateway: boolean;
  /** INR (UPI) rails open — see upiDepositsEnabled(). */
  upiEnabled: boolean;
}) {
  const [method, setMethod] = useState<Method | null>(null);

  if (method === null) return <MethodPicker onPick={setMethod} usdtEnabled={usdtNetworks.length > 0} upiEnabled={upiEnabled} />;
  if (method === "USDT" && usdtNetworks.length > 0) {
    return <UsdtAmountStep networks={usdtNetworks} gateway={usdtGateway} onBack={() => setMethod(null)} />;
  }
  if (method === "USDT") return <MethodPicker onPick={setMethod} usdtEnabled={false} upiEnabled={upiEnabled} />;
  return <AmountStep method={method} onBack={() => setMethod(null)} />;
}
